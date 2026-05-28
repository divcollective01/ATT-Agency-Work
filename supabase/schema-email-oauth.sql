-- ATT Profit Shield — Email OAuth schema additions
-- Run in the Supabase SQL editor AFTER schema-screens-567.sql.
-- Safe to re-run: uses IF NOT EXISTS and conditional constraint logic.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Widen the platform check constraint to include Google and Microsoft.
--    Uses a DO block to locate the constraint by its definition rather than
--    relying on the auto-generated name, so this is safe regardless of how
--    the constraint was named on initial creation.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.platform_connections'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%stripe%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.platform_connections DROP CONSTRAINT %I',
      v_conname
    );
  END IF;
END;
$$;

-- Recreate constraint with all supported platforms
ALTER TABLE public.platform_connections
  ADD CONSTRAINT platform_connections_platform_check
  CHECK (platform IN ('stripe', 'square', 'quickbooks', 'google', 'microsoft'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. New columns for email OAuth display metadata.
--    connected_email — the email address that was authorized (e.g. john@gmail.com)
--    connected_name  — the display name on the provider account (e.g. "John Doe")
--    Both are null for Stripe / Square connections.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.platform_connections
  ADD COLUMN IF NOT EXISTS connected_email text,
  ADD COLUMN IF NOT EXISTS connected_name  text;

-- PostgREST cache refresh
NOTIFY pgrst, 'reload schema';
