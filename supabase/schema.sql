-- ATT Profit Shield — Supabase schema
-- Run in the Supabase SQL editor after creating the project.

create extension if not exists "pgcrypto";

-- 1. users
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  business_name text not null,
  industry text,
  target_margin_pct numeric(5,2) not null default 30.00,
  base_currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. expenses (Plaid bucketed feed)
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plaid_transaction_id text unique,
  bucket text not null,
  merchant text,
  description text,
  amount_cents bigint not null,
  currency text not null default 'USD',
  occurred_on date not null,
  ingested_at timestamptz not null default now()
);
create index if not exists expenses_user_bucket_idx
  on public.expenses (user_id, bucket, occurred_on desc);

-- 3. material_costs — hybrid FRED / Custom override model
create table if not exists public.material_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  unit text not null default 'unit',
  quantity numeric(12,4) not null default 1,
  baseline_cost numeric(12,4) not null,
  baseline_set_at date not null default current_date,
  tracking_mode text not null default 'fred' check (tracking_mode in ('fred', 'custom')),
  fred_ppi_code text,
  custom_volatility_pct numeric(7,3),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enforce NOT NULL on user_id for existing installs that may have been
-- created before this constraint was added. Rows with null user_id are
-- orphaned and safe to delete (they can't be accessed via RLS anyway).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'expenses'
      and column_name = 'user_id' and is_nullable = 'YES'
  ) then
    delete from public.expenses where user_id is null;
    alter table public.expenses alter column user_id set not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'material_costs'
      and column_name = 'user_id' and is_nullable = 'YES'
  ) then
    delete from public.material_costs where user_id is null;
    alter table public.material_costs alter column user_id set not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'predictive_snapshots'
      and column_name = 'user_id' and is_nullable = 'YES'
  ) then
    delete from public.predictive_snapshots where user_id is null;
    alter table public.predictive_snapshots alter column user_id set not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'predictive_snapshots'
      and column_name = 'material_id' and is_nullable = 'YES'
  ) then
    delete from public.predictive_snapshots where material_id is null;
    alter table public.predictive_snapshots alter column material_id set not null;
  end if;
end $$;

-- Backfill new columns on existing installs
alter table public.material_costs
  add column if not exists quantity numeric(12,4) not null default 1;
alter table public.material_costs
  add column if not exists tracking_mode text not null default 'fred';
alter table public.material_costs
  add column if not exists custom_volatility_pct numeric(7,3);
alter table public.material_costs
  alter column fred_ppi_code drop not null;

-- Re-apply check after potential type drift
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'material_costs_tracking_mode_check'
  ) then
    alter table public.material_costs
      add constraint material_costs_tracking_mode_check
      check (tracking_mode in ('fred', 'custom'));
  end if;
end $$;

create index if not exists material_costs_user_idx on public.material_costs (user_id);
create index if not exists material_costs_created_idx
  on public.material_costs (created_at desc);

-- 4. predictive_snapshots
create table if not exists public.predictive_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  material_id uuid not null references public.material_costs(id) on delete cascade,
  horizon_days int not null check (horizon_days in (30, 60, 90)),
  projected_unit_cost numeric(12,4) not null,
  projected_delta_pct numeric(6,3) not null,
  vendor_slope_component numeric(6,3),
  fred_acceleration_component numeric(6,3),
  required_price_lift_pct numeric(6,3),
  computed_at timestamptz not null default now()
);
create index if not exists predictive_snapshots_user_idx
  on public.predictive_snapshots (user_id, computed_at desc);

-- 5. merchant_category_overrides
create table if not exists public.merchant_category_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_name text,
  description_pattern text,
  custom_bucket text not null,
  created_at timestamptz not null default now()
);

create index if not exists merchant_category_overrides_user_merchant_idx
  on public.merchant_category_overrides (user_id, merchant_name);
create index if not exists merchant_category_overrides_user_description_idx
  on public.merchant_category_overrides (user_id, description_pattern);

-- Ensure at most one override per (user, merchant_name) and one per
-- (user, description_pattern). These partial unique indexes mirror the
-- delete-then-insert upsert pattern in actions.ts and prevent duplicates
-- from concurrent requests.
create unique index if not exists merchant_category_overrides_user_merchant_uniq
  on public.merchant_category_overrides (user_id, merchant_name)
  where merchant_name is not null;
create unique index if not exists merchant_category_overrides_user_desc_uniq
  on public.merchant_category_overrides (user_id, description_pattern)
  where description_pattern is not null;

-- Auto-insert a public.users profile whenever auth creates a new user
-- (including anonymous sign-ins). Without this trigger, anonymous users
-- have no matching public.users row, so every user_id FK lookup in the
-- sync route and material actions returns null and silently skips persistence.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (auth_user_id, business_name)
  values (new.id, coalesce(new.email, 'Anonymous'))
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Auto-update timestamps
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_touch on public.users;
create trigger users_touch before update on public.users
  for each row execute function public.touch_updated_at();

drop trigger if exists material_costs_touch on public.material_costs;
create trigger material_costs_touch before update on public.material_costs
  for each row execute function public.touch_updated_at();

-- Row Level Security
alter table public.users enable row level security;
alter table public.expenses enable row level security;
alter table public.material_costs enable row level security;
alter table public.predictive_snapshots enable row level security;
alter table public.merchant_category_overrides enable row level security;

create policy "user reads own profile" on public.users
  for select using (auth_user_id = auth.uid());
create policy "user updates own profile" on public.users
  for update using (auth_user_id = auth.uid());
create policy "user inserts own profile" on public.users
  for insert with check (auth_user_id = auth.uid());

create policy "user owns expenses" on public.expenses
  for all
  using (user_id in (select id from public.users where auth_user_id = auth.uid()))
  with check (user_id in (select id from public.users where auth_user_id = auth.uid()));

create policy "user owns forecasts" on public.predictive_snapshots
  for all
  using (user_id in (select id from public.users where auth_user_id = auth.uid()))
  with check (user_id in (select id from public.users where auth_user_id = auth.uid()));

drop policy if exists "user reads own merchant category overrides"
  on public.merchant_category_overrides;
drop policy if exists "user inserts own merchant category overrides"
  on public.merchant_category_overrides;
drop policy if exists "user updates own merchant category overrides"
  on public.merchant_category_overrides;
drop policy if exists "user deletes own merchant category overrides"
  on public.merchant_category_overrides;

create policy "user reads own merchant category overrides"
  on public.merchant_category_overrides
  for select using (user_id = auth.uid());
create policy "user inserts own merchant category overrides"
  on public.merchant_category_overrides
  for insert with check (user_id = auth.uid());
create policy "user updates own merchant category overrides"
  on public.merchant_category_overrides
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user deletes own merchant category overrides"
  on public.merchant_category_overrides
  for delete using (user_id = auth.uid());

-- Drop the previous prototype anon policies (these allowed cross-tenant reads
-- and were the source of the material_costs shared-state leak).
drop policy if exists "prototype: anon read materials"   on public.material_costs;
drop policy if exists "prototype: anon insert materials" on public.material_costs;
drop policy if exists "prototype: anon update materials" on public.material_costs;
drop policy if exists "prototype: anon delete materials" on public.material_costs;

-- Strict per-user ownership policy. Mirrors "user owns expenses": all SELECT /
-- INSERT / UPDATE / DELETE operations are gated on the material's user_id
-- matching the internal public.users row whose auth_user_id is the caller.
drop policy if exists "user owns materials" on public.material_costs;
create policy "user owns materials" on public.material_costs
  for all
  using (user_id in (select id from public.users where auth_user_id = auth.uid()))
  with check (user_id in (select id from public.users where auth_user_id = auth.uid()));
