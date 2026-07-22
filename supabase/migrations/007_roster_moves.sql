-- ============================================================
-- Roster Moves (NCAA offseason player movement)
-- Cross-app contract table: omni-agents WRITES (X reports +
-- season-diff), omni-hockey READS (Roster "Changes" view).
-- See docs/design/roster-moves-contract.md (omni-hockey repo).
--
-- SAFE: new table only; references existing players/teams.
-- ============================================================

CREATE TABLE roster_moves (
  id            bigserial PRIMARY KEY,

  -- Season the move is FOR, e.g. "2026-27".
  season        text NOT NULL,

  -- What kind of move this is.
  direction     text NOT NULL CHECK (direction IN (
                  'commit', 'transfer_in', 'transfer_out',
                  'departure', 'pro_signing', 'graduation')),

  -- Player, as reported (raw) and resolved when we can match them.
  player_name   text NOT NULL,
  player_id     uuid REFERENCES players(id) ON DELETE SET NULL,

  -- The NCAA school this move is ABOUT (the one gaining/losing the player).
  -- team_seo denormalizes teams.external_ids->>'ncaa_seo' for cheap read-side
  -- filtering (omni-hockey queries by seo, not uuid).
  team_id       uuid REFERENCES teams(id) ON DELETE SET NULL,
  team_seo      text,

  -- Transfer endpoints (nullable; only meaningful for transfers).
  from_team_id  uuid REFERENCES teams(id) ON DELETE SET NULL,
  to_team_id    uuid REFERENCES teams(id) ON DELETE SET NULL,

  position      text,           -- F / D / G if known
  class_year    int,            -- 1..5 if known

  confidence    text NOT NULL DEFAULT 'reported' CHECK (confidence IN (
                  'reported', 'corroborated', 'confirmed')),
  source_type   text NOT NULL CHECK (source_type IN (
                  'x_report', 'season_diff', 'official_roster', 'manual')),

  reported_at            timestamptz NOT NULL DEFAULT now(),
  -- "{startYear}-09-01" — matches omni-hockey's team_players.start_date season key.
  effective_season_start date,

  -- Extractor payload: source urls, tweet ids, image refs, model, sightings.
  -- NOT verbatim tweet content (see contract §4 sourcing policy).
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Canonical collapse key: same move from many sightings => one row.
  -- ${season}|${direction}|${normalizedPlayerName}|${team_seo}
  dedup_key     text NOT NULL UNIQUE,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Read-side access patterns (omni-hockey filters by seo + season).
CREATE INDEX idx_roster_moves_team_season ON roster_moves(team_seo, season);
CREATE INDEX idx_roster_moves_season_direction ON roster_moves(season, direction);
CREATE INDEX idx_roster_moves_player_id ON roster_moves(player_id);

-- ============================================================
-- RLS: open reads (anon) + open writes, matching the news tables.
-- omni-agents writes with the anon key; policies are permissive
-- (cf. 003_rls_policies.sql / 005_scan_runs.sql).
-- ============================================================
ALTER TABLE roster_moves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to roster_moves" ON roster_moves
  FOR SELECT USING (true);
CREATE POLICY "Allow insert to roster_moves" ON roster_moves
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update to roster_moves" ON roster_moves
  FOR UPDATE USING (true);
