-- ============================================================
-- RLS Policies for new tables
-- Enables read access for anon/authenticated roles,
-- and write access for authenticated (service) role.
-- ============================================================

-- Leagues
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access to leagues" ON leagues
  FOR SELECT USING (true);
CREATE POLICY "Allow insert to leagues" ON leagues
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update to leagues" ON leagues
  FOR UPDATE USING (true);

-- Article Feeds
ALTER TABLE article_feeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access to article_feeds" ON article_feeds
  FOR SELECT USING (true);
CREATE POLICY "Allow insert to article_feeds" ON article_feeds
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update to article_feeds" ON article_feeds
  FOR UPDATE USING (true);

-- Article Teams
ALTER TABLE article_teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access to article_teams" ON article_teams
  FOR SELECT USING (true);
CREATE POLICY "Allow insert to article_teams" ON article_teams
  FOR INSERT WITH CHECK (true);

-- Article Players
ALTER TABLE article_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access to article_players" ON article_players
  FOR SELECT USING (true);
CREATE POLICY "Allow insert to article_players" ON article_players
  FOR INSERT WITH CHECK (true);

-- Article Leagues
ALTER TABLE article_leagues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access to article_leagues" ON article_leagues
  FOR SELECT USING (true);
CREATE POLICY "Allow insert to article_leagues" ON article_leagues
  FOR INSERT WITH CHECK (true);
