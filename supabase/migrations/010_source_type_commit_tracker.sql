-- ============================================================
-- Add 'commit_tracker' to roster_moves.source_type.
-- The THN NCAA commitments live blog is a distinct web tracker
-- (deterministic parse) — commits + transfer_ins.
-- Contract addition — note for omni-hockey's read side.
-- ============================================================

ALTER TABLE roster_moves DROP CONSTRAINT IF EXISTS roster_moves_source_type_check;
ALTER TABLE roster_moves ADD CONSTRAINT roster_moves_source_type_check
  CHECK (source_type IN ('x_report', 'season_diff', 'official_roster', 'manual', 'portal', 'commit_tracker'));
