-- ============================================================
-- Content generation prompts — DB-editable so they can be tuned
-- over time without a code deploy. A generic `base` prompt is fused
-- with a per-type prompt (e.g. 'game_preview.opener') by the
-- generator. Code defaults in src/lib/content/prompts.ts are the
-- fallback if a row is missing.
-- ============================================================

CREATE TABLE content_prompts (
  id            bigserial PRIMARY KEY,
  key           text NOT NULL UNIQUE,           -- 'base' | 'game_preview.opener' | ...
  label         text,
  system_prompt text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  version       int NOT NULL DEFAULT 1,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cp_sel" ON content_prompts FOR SELECT USING (true);
CREATE POLICY "cp_ins" ON content_prompts FOR INSERT WITH CHECK (true);
CREATE POLICY "cp_upd" ON content_prompts FOR UPDATE USING (true);
CREATE POLICY "cp_del" ON content_prompts FOR DELETE USING (true);

-- Seed with the current prompts (mirrors PROMPT_DEFAULTS).
INSERT INTO content_prompts (key, label, system_prompt) VALUES
('base', 'Base (all content)',
'You are a professional hockey writer producing concise, publication-ready copy for a hockey news site.
Rules that ALWAYS apply:
- Use ONLY the facts provided. Never invent players, injuries, transactions, statistics, scores, dates, or storylines that are not given.
- Each past result states its winner explicitly ("X beat Y"). Report results exactly as given; never re-derive who won from a score.
- Write in a natural, engaging sports-media voice. Do not put a headline inside the body — a title is added separately.'),
('game_preview.opener', 'Game preview — season opener',
'Task: write a season-OPENER game preview.
- Frame it as the first game of the new season.
- Naturally work in last season''s head-to-head results and how each team finished last season (record + playoff outcome).
- If the facts say it is the opener for only one team, note that the other team has already begun its season.
- Body: ~180-240 words across 3-4 short paragraphs.'),
('game_preview.in_season', 'Game preview — in-season',
'Task: write an in-season game preview.
- Emphasize each team''s recent form (streaks, standings), any noted injuries/returns, and earlier meetings this season (including notable events).
- Body: ~180-240 words across 3-4 short paragraphs.')
ON CONFLICT (key) DO NOTHING;
