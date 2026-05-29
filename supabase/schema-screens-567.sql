-- ATT Profit Shield — Schema additions for Screens 5, 6, 7
-- Run after schema.sql in the Supabase SQL editor.
-- Safe to re-run: uses IF NOT EXISTS and ON CONFLICT guards throughout.

-- ─────────────────────────────────────────────────────────────────────────────
-- Screen 05: surcharge_mappings
-- Per-material surcharge settings and billing platform mappings.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.surcharge_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  material_id uuid references public.material_costs(id) on delete cascade,
  material_name text not null,
  fred_code text,
  fred_label text,
  billing_label text not null,
  surcharge_enabled boolean not null default true,
  mapped_platform text check (mapped_platform in ('stripe', 'square', 'quickbooks')),
  last_fred_pct numeric(7,3),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists surcharge_mappings_user_idx
  on public.surcharge_mappings (user_id);

alter table public.surcharge_mappings enable row level security;

drop policy if exists "user owns surcharge_mappings" on public.surcharge_mappings;
create policy "user owns surcharge_mappings" on public.surcharge_mappings
  for all
  using (user_id in (select id from public.users where auth_user_id = auth.uid()))
  with check (user_id in (select id from public.users where auth_user_id = auth.uid()));

drop trigger if exists surcharge_mappings_touch on public.surcharge_mappings;
create trigger surcharge_mappings_touch before update on public.surcharge_mappings
  for each row execute function public.touch_updated_at();

-- Platform connection status. Holds the AES-GCM ciphertext of the per-user
-- OAuth access/refresh tokens for Stripe Connect and Square. The decryption
-- key (ENCRYPTION_MASTER_KEY) lives only in the server runtime — the database
-- never sees plaintext credentials. `key_hint` retains the legacy display
-- snippet used in the connection panel UI.
create table if not exists public.platform_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  platform text not null check (platform in ('stripe', 'square', 'quickbooks')),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  key_hint text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  encryption_iv text,
  stripe_user_id text,
  square_merchant_id text,
  token_expires_at timestamptz,
  scope text,
  connected_at timestamptz,
  last_sync_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

-- Backfill columns on existing installs that pre-date the OAuth refactor.
alter table public.platform_connections
  add column if not exists encrypted_access_token text;
alter table public.platform_connections
  add column if not exists encrypted_refresh_token text;
alter table public.platform_connections
  add column if not exists encryption_iv text;
alter table public.platform_connections
  add column if not exists stripe_user_id text;
alter table public.platform_connections
  add column if not exists square_merchant_id text;
alter table public.platform_connections
  add column if not exists token_expires_at timestamptz;
alter table public.platform_connections
  add column if not exists scope text;

create index if not exists platform_connections_user_idx
  on public.platform_connections (user_id);
create index if not exists platform_connections_stripe_user_idx
  on public.platform_connections (stripe_user_id)
  where stripe_user_id is not null;
create index if not exists platform_connections_square_merchant_idx
  on public.platform_connections (square_merchant_id)
  where square_merchant_id is not null;

alter table public.platform_connections enable row level security;

drop policy if exists "user owns platform_connections" on public.platform_connections;
create policy "user owns platform_connections" on public.platform_connections
  for all
  using (user_id in (select id from public.users where auth_user_id = auth.uid()))
  with check (user_id in (select id from public.users where auth_user_id = auth.uid()));

drop trigger if exists platform_connections_touch on public.platform_connections;
create trigger platform_connections_touch before update on public.platform_connections
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Screen 06: vendor_anomalies
-- Persisted vendor price hike flags with full negotiation workflow state.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.vendor_anomalies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  vendor_name text not null,
  material text not null,
  unit text not null default 'unit',
  contact_name text,
  contact_email text,
  baseline_unit_cost numeric(12,4) not null,
  quoted_unit_cost numeric(12,4) not null,
  quantity numeric(12,2) not null default 1,
  fred_code text not null,
  fred_label text not null,
  fred_ppi_yoy_pct numeric(7,3) not null,
  date_quoted date not null default current_date,
  status text not null default 'flagged' check (status in ('flagged', 'in-progress', 'resolved')),
  notes text,
  email_template_override text,
  flagged_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_anomalies_user_idx
  on public.vendor_anomalies (user_id, created_at desc);
create index if not exists vendor_anomalies_status_idx
  on public.vendor_anomalies (user_id, status);

alter table public.vendor_anomalies enable row level security;

drop policy if exists "user owns vendor_anomalies" on public.vendor_anomalies;
create policy "user owns vendor_anomalies" on public.vendor_anomalies
  for all
  using (user_id in (select id from public.users where auth_user_id = auth.uid()))
  with check (user_id in (select id from public.users where auth_user_id = auth.uid()));

drop trigger if exists vendor_anomalies_touch on public.vendor_anomalies;
create trigger vendor_anomalies_touch before update on public.vendor_anomalies
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Screen 07: yield_entries + yield_entry_audit
-- Delivery quantity variance tracking with full audit trail.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.yield_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  material text not null,
  unit text not null default 'unit',
  invoice_date date not null,
  vendor_name text not null default '',
  stated_qty numeric(14,4) not null,
  actual_qty numeric(14,4) not null,
  invoiced_unit_cost numeric(12,4) not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists yield_entries_user_idx
  on public.yield_entries (user_id, invoice_date desc);
create index if not exists yield_entries_vendor_idx
  on public.yield_entries (user_id, vendor_name);

alter table public.yield_entries enable row level security;

drop policy if exists "user owns yield_entries" on public.yield_entries;
create policy "user owns yield_entries" on public.yield_entries
  for all
  using (user_id in (select id from public.users where auth_user_id = auth.uid()))
  with check (user_id in (select id from public.users where auth_user_id = auth.uid()));

drop trigger if exists yield_entries_touch on public.yield_entries;
create trigger yield_entries_touch before update on public.yield_entries
  for each row execute function public.touch_updated_at();

-- Audit trail for all yield_entry changes.
-- entry_id is intentionally a bare uuid (no FK) — the AFTER DELETE trigger below
-- inserts an audit row referencing the just-deleted yield_entries.id, which a
-- FK with `on delete cascade` would reject (and a non-cascade FK would still
-- reject at insert time). Audit rows must outlive their parents anyway.
create table if not exists public.yield_entry_audit (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now()
);

-- Forward-fix for installs that already ran the prior schema where entry_id
-- carried a FK to yield_entries(id) — the AFTER DELETE trigger below would
-- violate it on every DELETE. Idempotent on fresh installs.
alter table public.yield_entry_audit
  drop constraint if exists yield_entry_audit_entry_id_fkey;

create index if not exists yield_entry_audit_entry_idx
  on public.yield_entry_audit (entry_id, changed_at desc);

alter table public.yield_entry_audit enable row level security;

drop policy if exists "user reads own yield audit" on public.yield_entry_audit;
create policy "user reads own yield audit" on public.yield_entry_audit
  for select
  using (user_id in (select id from public.users where auth_user_id = auth.uid()));

-- Audit trigger function
create or replace function public.audit_yield_entry()
returns trigger language plpgsql security definer as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from public.users where auth_user_id = auth.uid();
  if TG_OP = 'INSERT' then
    insert into public.yield_entry_audit (entry_id, user_id, action, old_data, new_data)
    values (new.id, coalesce(v_user_id, new.user_id), 'insert', null, row_to_json(new)::jsonb);
    return new;
  elsif TG_OP = 'UPDATE' then
    insert into public.yield_entry_audit (entry_id, user_id, action, old_data, new_data)
    values (new.id, coalesce(v_user_id, new.user_id), 'update', row_to_json(old)::jsonb, row_to_json(new)::jsonb);
    return new;
  elsif TG_OP = 'DELETE' then
    insert into public.yield_entry_audit (entry_id, user_id, action, old_data, new_data)
    values (old.id, coalesce(v_user_id, old.user_id), 'delete', row_to_json(old)::jsonb, null);
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists yield_entries_audit_trigger on public.yield_entries;
create trigger yield_entries_audit_trigger
  after insert or update or delete on public.yield_entries
  for each row execute function public.audit_yield_entry();
