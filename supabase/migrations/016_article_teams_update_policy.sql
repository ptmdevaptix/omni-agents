-- ============================================================
-- article_teams previously had only SELECT + INSERT policies (tags
-- were only ever inserted). Relevance backfill/rescoring needs to
-- UPDATE existing rows; without an UPDATE policy those updates
-- silently affect 0 rows under RLS. Add a permissive UPDATE policy
-- (consistent with the app's single-writer, permissive-RLS model).
-- ============================================================

DROP POLICY IF EXISTS "at_update" ON article_teams;
CREATE POLICY "at_update" ON article_teams FOR UPDATE USING (true) WITH CHECK (true);
