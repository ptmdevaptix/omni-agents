-- ============================================================
-- Article Feeds
-- Manageable table of RSS/Atom feeds mapped to sources,
-- with optional league/team auto-tagging.
--
-- SAFE: Does not modify existing tables.
-- ============================================================

CREATE TABLE article_feeds (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id bigint NOT NULL REFERENCES article_sources(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL UNIQUE,
  feed_type text NOT NULL DEFAULT 'rss',
  league_id uuid REFERENCES leagues(id) ON DELETE SET NULL,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  fetch_interval_minutes integer NOT NULL DEFAULT 60,
  last_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_article_feeds_source_id ON article_feeds(source_id);
CREATE INDEX idx_article_feeds_active ON article_feeds(is_active) WHERE is_active = true;

-- ============================================================
-- Seed: Article Sources
-- Insert sources only if they don't already exist.
-- ============================================================

INSERT INTO article_sources (name, short_name, homepage_url) VALUES
  ('ESPN',                'ESPN',   'https://www.espn.com'),
  ('USCHO',              'USCHO',  'https://www.uscho.com'),
  ('College Hockey News', 'CHN',    'https://www.collegehockeynews.com'),
  ('The Hockey Writers',  'THW',    'https://thehockeywriters.com'),
  ('New York Times',      'NYT',    'https://www.nytimes.com'),
  ('NCAA',               'NCAA',   'https://www.ncaa.com'),
  ('The Hockey News',     'THN',    'https://thehockeynews.com'),
  ('NHL.com',            'NHL',    'https://www.nhl.com'),
  ('Our Sports Central',  'OSC',    'https://www.oursportscentral.com'),
  ('PuckPedia',          'PP',     'https://puckpedia.com')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Seed: Feeds
-- ============================================================

-- Helper: get source_id by name
-- ESPN
INSERT INTO article_feeds (source_id, name, url, league_id) VALUES
  ((SELECT id FROM article_sources WHERE name = 'ESPN'),
   'ESPN NHL',
   'https://www.espn.com/espn/rss/nhl/news',
   (SELECT id FROM leagues WHERE name = 'NHL'));

-- USCHO
INSERT INTO article_feeds (source_id, name, url) VALUES
  ((SELECT id FROM article_sources WHERE name = 'USCHO'),
   'USCHO General',
   'https://www.uscho.com/feed');

INSERT INTO article_feeds (source_id, name, url, league_id) VALUES
  ((SELECT id FROM article_sources WHERE name = 'USCHO'),
   'USCHO D1 Mens',
   'https://www.uscho.com/news/mens-di-college-hockey/feed/',
   (SELECT id FROM leagues WHERE name = 'NCAA'));

-- College Hockey News
INSERT INTO article_feeds (source_id, name, url, league_id) VALUES
  ((SELECT id FROM article_sources WHERE name = 'College Hockey News'),
   'CHN General',
   'https://www.collegehockeynews.com/news/rss',
   (SELECT id FROM leagues WHERE name = 'NCAA'));

-- The Hockey Writers
INSERT INTO article_feeds (source_id, name, url) VALUES
  ((SELECT id FROM article_sources WHERE name = 'The Hockey Writers'),
   'THW General',
   'https://thehockeywriters.com/feed');

INSERT INTO article_feeds (source_id, name, url) VALUES
  ((SELECT id FROM article_sources WHERE name = 'The Hockey Writers'),
   'THW Prospects',
   'https://thehockeywriters.com/category/prospects/feed');

-- New York Times
INSERT INTO article_feeds (source_id, name, url) VALUES
  ((SELECT id FROM article_sources WHERE name = 'New York Times'),
   'NYT Hockey',
   'https://rss.nytimes.com/services/xml/rss/nyt/Hockey.xml');

-- NCAA
INSERT INTO article_feeds (source_id, name, url, league_id) VALUES
  ((SELECT id FROM article_sources WHERE name = 'NCAA'),
   'NCAA D1 Mens Hockey',
   'https://www.ncaa.com/news/icehockey-men/d1/rss.xml',
   (SELECT id FROM leagues WHERE name = 'NCAA'));

-- The Hockey News
INSERT INTO article_feeds (source_id, name, url) VALUES
  ((SELECT id FROM article_sources WHERE name = 'The Hockey News'),
   'THN Home',
   'https://thehockeynews.com/rss/THNHOME/full');

-- PuckPedia (podcast feed)
INSERT INTO article_feeds (source_id, name, url, feed_type) VALUES
  ((SELECT id FROM article_sources WHERE name = 'PuckPedia'),
   'PuckPedia Podcast',
   'https://feeds.simplecast.com/wmcKMqG2',
   'podcast');

-- Our Sports Central — league-specific feeds
INSERT INTO article_feeds (source_id, name, url) VALUES
  ((SELECT id FROM article_sources WHERE name = 'Our Sports Central'),
   'OSC Hockey General',
   'https://www.oursportscentral.com/feeds/Hockey.xml');

INSERT INTO article_feeds (source_id, name, url, league_id) VALUES
  ((SELECT id FROM article_sources WHERE name = 'Our Sports Central'),
   'OSC Junior Hockey',
   'https://www.oursportscentral.com/feeds/sv27.xml',
   (SELECT id FROM leagues WHERE name = 'CHL')),
  ((SELECT id FROM article_sources WHERE name = 'Our Sports Central'),
   'OSC OHL',
   'https://www.oursportscentral.com/feeds/l111.xml',
   (SELECT id FROM leagues WHERE name = 'OHL')),
  ((SELECT id FROM article_sources WHERE name = 'Our Sports Central'),
   'OSC QMJHL',
   'https://www.oursportscentral.com/feeds/l112.xml',
   (SELECT id FROM leagues WHERE name = 'QMJHL')),
  ((SELECT id FROM article_sources WHERE name = 'Our Sports Central'),
   'OSC WHL',
   'https://www.oursportscentral.com/feeds/l113.xml',
   (SELECT id FROM leagues WHERE name = 'WHL')),
  ((SELECT id FROM article_sources WHERE name = 'Our Sports Central'),
   'OSC USHL',
   'https://www.oursportscentral.com/feeds/l110.xml',
   (SELECT id FROM leagues WHERE name = 'USHL')),
  ((SELECT id FROM article_sources WHERE name = 'Our Sports Central'),
   'OSC NAHL',
   'https://www.oursportscentral.com/feeds/l114.xml',
   (SELECT id FROM leagues WHERE name = 'NAHL')),
  ((SELECT id FROM article_sources WHERE name = 'Our Sports Central'),
   'OSC AHL',
   'https://www.oursportscentral.com/feeds/l17.xml',
   (SELECT id FROM leagues WHERE name = 'AHL')),
  ((SELECT id FROM article_sources WHERE name = 'Our Sports Central'),
   'OSC ECHL',
   'https://www.oursportscentral.com/feeds/l18.xml',
   (SELECT id FROM leagues WHERE name = 'ECHL')),
  ((SELECT id FROM article_sources WHERE name = 'Our Sports Central'),
   'OSC SPHL',
   'https://www.oursportscentral.com/feeds/l104.xml',
   (SELECT id FROM leagues WHERE name = 'SPHL'));
