-- ============================================================
-- Generated content — LLM-authored copy that needs human review
-- before omni-hockey surfaces it. Generic across content types
-- (game previews now; game recaps, original news articles, ...
-- later) so they share one review/approve workflow + admin UI.
--
-- omni-agents writes + reviews; omni-hockey reads status='approved'.
-- ============================================================

CREATE TABLE generated_content (
  id            bigserial PRIMARY KEY,

  -- Discriminator: 'game_preview' now; 'game_recap' | 'news_article' | ... later.
  content_type  text NOT NULL,

  -- Review workflow. new → reviewed → approved (or rejected). omni-hockey reads
  -- only 'approved'. Regeneration resets an item to 'new' (see dedup_key).
  status        text NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'reviewed', 'approved', 'rejected')),

  league        text,                          -- 'NHL' | 'NCAA' | ...

  -- What the content is about (polymorphic): e.g. subject_type='game',
  -- subject_id = the NHL game id.
  subject_type  text,
  subject_id    text,

  -- Canonical key for upsert/regeneration, e.g. 'game_preview:nhl-2026020001'.
  -- Regenerating (fresher data) replaces body/data, bumps version, resets to 'new'.
  dedup_key     text NOT NULL UNIQUE,

  title         text,
  summary       text,
  body          text NOT NULL,

  -- Type-specific payload: teams/seos, context used, prompt_version, sources, etc.
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,

  model         text,
  version       int NOT NULL DEFAULT 1,
  generated_at  timestamptz NOT NULL DEFAULT now(),

  -- Review audit.
  reviewer      text,
  reviewed_at   timestamptz,
  review_notes  text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_generated_content_type_status ON generated_content(content_type, status);
CREATE INDEX idx_generated_content_subject ON generated_content(subject_type, subject_id);
CREATE INDEX idx_generated_content_league ON generated_content(league);

-- RLS: permissive like the other agent-owned tables. DELETE is allowed here so
-- obsolete/bad generations can be purged (content, unlike moves, is disposable).
ALTER TABLE generated_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access to generated_content" ON generated_content
  FOR SELECT USING (true);
CREATE POLICY "Allow insert to generated_content" ON generated_content
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update to generated_content" ON generated_content
  FOR UPDATE USING (true);
CREATE POLICY "Allow delete to generated_content" ON generated_content
  FOR DELETE USING (true);
