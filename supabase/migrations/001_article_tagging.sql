-- ============================================================
-- Article Tagging Schema
-- Adds leagues table and join tables for tagging articles
-- to teams, players, and leagues.
--
-- SAFE: Does not modify existing tables (teams, players, articles).
-- ============================================================

-- Leagues with alias support and hierarchy
CREATE TABLE leagues (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  aliases text[] NOT NULL DEFAULT '{}',
  parent_league_id uuid REFERENCES leagues(id),
  country text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Article <-> Team (many-to-many)
CREATE TABLE article_teams (
  article_id bigint NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, team_id)
);

-- Article <-> Player (many-to-many)
CREATE TABLE article_players (
  article_id bigint NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, player_id)
);

-- Article <-> League (many-to-many, for league-level news without a specific team)
CREATE TABLE article_leagues (
  article_id bigint NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, league_id)
);

-- Indexes for reverse lookups (find all articles for a given entity)
CREATE INDEX idx_article_teams_team_id ON article_teams(team_id);
CREATE INDEX idx_article_players_player_id ON article_players(player_id);
CREATE INDEX idx_article_leagues_league_id ON article_leagues(league_id);

-- GIN index for fast alias searching
CREATE INDEX idx_leagues_aliases ON leagues USING gin(aliases);

-- ============================================================
-- Seed: Known leagues
-- ============================================================

-- Parent leagues first
INSERT INTO leagues (name, aliases, country) VALUES
  ('CHL', '{"Canadian Hockey League"}', 'Canada'),
  ('NCAA', '{"college hockey", "NCAA D1", "NCAA Division 1"}', 'United States');

-- Major professional
INSERT INTO leagues (name, aliases, country) VALUES
  ('NHL', '{"National Hockey League"}', 'North America'),
  ('AHL', '{"American Hockey League"}', 'North America');

-- CHL member leagues
INSERT INTO leagues (name, aliases, parent_league_id, country) VALUES
  ('OHL', '{"Ontario Hockey League"}', (SELECT id FROM leagues WHERE name = 'CHL'), 'Canada'),
  ('WHL', '{"Western Hockey League", "the Dub"}', (SELECT id FROM leagues WHERE name = 'CHL'), 'Canada'),
  ('QMJHL', '{"LHJMQ", "Quebec League", "the Q", "Quebec Major Junior Hockey League"}', (SELECT id FROM leagues WHERE name = 'CHL'), 'Canada');

-- NCAA conferences
INSERT INTO leagues (name, aliases, parent_league_id, country) VALUES
  ('Hockey East', '{}', (SELECT id FROM leagues WHERE name = 'NCAA'), 'United States'),
  ('ECAC', '{"ECAC Hockey"}', (SELECT id FROM leagues WHERE name = 'NCAA'), 'United States'),
  ('CCHA', '{"Central Collegiate Hockey Association"}', (SELECT id FROM leagues WHERE name = 'NCAA'), 'United States'),
  ('Big Ten', '{"Big 10", "B1G"}', (SELECT id FROM leagues WHERE name = 'NCAA'), 'United States'),
  ('AHA', '{"Atlantic Hockey", "Atlantic Hockey Association"}', (SELECT id FROM leagues WHERE name = 'NCAA'), 'United States'),
  ('NCHC', '{"National Collegiate Hockey Conference"}', (SELECT id FROM leagues WHERE name = 'NCAA'), 'United States');

-- Minor / junior / developmental
INSERT INTO leagues (name, aliases, country) VALUES
  ('ECHL', '{}', 'North America'),
  ('SPHL', '{"Southern Professional Hockey League"}', 'United States'),
  ('USHL', '{"United States Hockey League"}', 'United States'),
  ('USNTDP', '{"US National Team Development Program", "NTDP", "Team USA"}', 'United States'),
  ('NAHL', '{"North American Hockey League"}', 'North America');

-- International / European
INSERT INTO leagues (name, aliases, country) VALUES
  ('SHL', '{"Swedish Hockey League"}', 'Sweden'),
  ('KHL', '{"Kontinental Hockey League"}', 'Russia'),
  ('Liiga', '{"SM-liiga", "Finnish Elite League"}', 'Finland'),
  ('Czech Extraliga', '{"Extraliga", "Tipsport Extraliga"}', 'Czech Republic'),
  ('DEL', '{"Deutsche Eishockey Liga", "German Hockey League", "DHL"}', 'Germany'),
  ('National League', '{"Swiss National League", "Swiss Hockey League", "NL"}', 'Switzerland');
