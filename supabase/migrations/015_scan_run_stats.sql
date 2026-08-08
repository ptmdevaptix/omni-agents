-- ============================================================
-- Extra scan_runs stats so the admin can track scan performance
-- over time: how many feeds a run scanned and how many errored.
-- (articles found/saved/skipped, duration_ms, and timestamps
-- already exist.) Nullable; legacy rows stay null.
-- ============================================================

ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS feeds_scanned int;
ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS error_count int;
