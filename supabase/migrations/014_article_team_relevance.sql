-- ============================================================
-- Per-article team-association relevance (0-100): how central a
-- team is to an article. Lets the read side hide weak/incidental
-- associations (e.g. a player's former team mentioned in passing)
-- below a display threshold. Nullable: legacy rows are unscored
-- until backfilled and should be treated as visible.
-- ============================================================

ALTER TABLE article_teams ADD COLUMN IF NOT EXISTS relevance smallint;
