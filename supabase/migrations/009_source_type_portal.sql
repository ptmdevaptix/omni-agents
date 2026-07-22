-- ============================================================
-- Add 'portal' to roster_moves.source_type.
-- The GopherPuckLive transfer-portal tracker is a distinct source
-- (structured, deterministic) from x_report / season_diff.
-- Contract addition — note for omni-hockey's read side.
-- ============================================================

ALTER TABLE roster_moves DROP CONSTRAINT IF EXISTS roster_moves_source_type_check;
ALTER TABLE roster_moves ADD CONSTRAINT roster_moves_source_type_check
  CHECK (source_type IN ('x_report', 'season_diff', 'official_roster', 'manual', 'portal'));
