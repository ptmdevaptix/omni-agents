-- ============================================================
-- roster_moves.suppressed — durable "this move is wrong / should
-- not appear" flag (research-queue addendum 2026-07-26b, part B).
--
-- SAFE + additive: default false, NOT NULL. Existing rows get false;
-- the scanners never write this column, so `upsertMove` preserves a
-- true value across re-sightings automatically (a source can't
-- resurrect a manually-suppressed move).
--
-- omni-hockey read side: exclude `suppressed = true` from the
-- upcoming-season roster delta + Changes view.
-- ============================================================

ALTER TABLE roster_moves
  ADD COLUMN IF NOT EXISTS suppressed boolean NOT NULL DEFAULT false;

-- Small partial index for the read-side filter (few suppressed rows expected).
CREATE INDEX IF NOT EXISTS idx_roster_moves_suppressed
  ON roster_moves(team_seo, season) WHERE suppressed = true;
