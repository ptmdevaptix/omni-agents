-- ============================================================
-- X (Twitter) accounts to poll for NCAA roster-move reports.
-- Configurable, DB-driven list (curated commit/portal reporters).
-- Incremental polling: since_id per account keeps X API reads
-- cheap (~$0.005/read). See contract §4.
--
-- SAFE: new table only.
-- ============================================================

CREATE TABLE x_accounts (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Handle without the leading '@' (e.g. "CHN_Adam").
  handle        text NOT NULL UNIQUE,
  -- X numeric user id, resolved lazily from the handle on first poll.
  x_user_id     text,

  label         text,          -- human note: who this is / why curated
  is_active     boolean NOT NULL DEFAULT true,

  -- Incremental cursor: only fetch tweets newer than this id.
  since_id      text,
  last_polled_at timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_x_accounts_active ON x_accounts(is_active) WHERE is_active = true;

-- RLS: permissive, same as the other agent-owned tables.
ALTER TABLE x_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to x_accounts" ON x_accounts
  FOR SELECT USING (true);
CREATE POLICY "Allow insert to x_accounts" ON x_accounts
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update to x_accounts" ON x_accounts
  FOR UPDATE USING (true);

-- ============================================================
-- Seed: curated accounts go here (Phil to provide the ~15).
-- Add rows like:
--   INSERT INTO x_accounts (handle, label) VALUES
--     ('CHN_Adam', 'College Hockey News — commits/portal');
-- Left empty intentionally until the account list is finalized.
-- ============================================================
