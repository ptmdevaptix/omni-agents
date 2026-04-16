-- ============================================================
-- Article Metadata
-- Adds relevance scoring, categorization, and time sensitivity
-- fields to the articles table.
-- ============================================================

-- Category: what type of article
-- e.g. trade, signing, game-recap, game-preview, injury, prospect,
--      draft, league-news, opinion, profile, ranking, schedule, other
ALTER TABLE articles ADD COLUMN category text;

-- Relevance score: 0-100, how important/notable is this article
ALTER TABLE articles ADD COLUMN relevance_score integer;

-- Time sensitivity: how the article's value changes over time
-- evergreen: stays relevant indefinitely
-- time-sensitive: about an upcoming event, decays after event_date
-- post-event: about something that just happened, decays gradually
ALTER TABLE articles ADD COLUMN time_sensitivity text;

-- Event date: for time-sensitive or post-event articles,
-- the date of the related event (game date, deadline, etc.)
ALTER TABLE articles ADD COLUMN event_date date;

-- Whether the agent successfully read the full article content
-- (vs. only having the RSS snippet to work with)
ALTER TABLE articles ADD COLUMN full_content_used boolean NOT NULL DEFAULT false;

-- Index for app-side queries that sort/filter by relevance
CREATE INDEX idx_articles_relevance ON articles(relevance_score DESC NULLS LAST);
CREATE INDEX idx_articles_category ON articles(category) WHERE category IS NOT NULL;
CREATE INDEX idx_articles_event_date ON articles(event_date) WHERE event_date IS NOT NULL;
