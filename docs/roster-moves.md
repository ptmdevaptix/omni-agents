# NCAA Roster Moves — ingestion (omni-agents side)

Implements the **write side** of the cross-app contract in
`omni-hockey/docs/design/roster-moves-contract.md`. omni-agents writes the
shared `roster_moves` table; omni-hockey reads it. The Supabase DB is the
runtime link.

## Pieces

| File | Role |
|------|------|
| `supabase/migrations/007_roster_moves.sql` | The `roster_moves` table (§3) + RLS |
| `supabase/migrations/008_x_accounts.sql` | Curated X accounts to poll, with `since_id` cursors |
| `src/lib/roster-moves/extract.ts` | Multimodal Claude extractor (text + vision), Haiku via AI Gateway |
| `src/lib/roster-moves/sources/gpl-portal.ts` | GopherPuckLive transfer-portal feed (structured JSON, no LLM) |
| `src/lib/roster-moves/scan-portal.ts` | Portal orchestrator: fetch → resolve → upsert |
| `src/lib/roster-moves/sourcing.ts` | Sourcing policy (§4): which links we may fetch |
| `src/lib/roster-moves/resolve.ts` | NCAA team + player entity resolution |
| `src/lib/roster-moves/normalize.ts` | Player-name normalizer + `dedup_key` builder |
| `src/lib/roster-moves/upsert.ts` | Dedup/upsert on `dedup_key`, confidence bump, provenance |
| `src/lib/roster-moves/sources/*` | Tweet-source adapter: live `x-api` + `fixture` |
| `src/lib/roster-moves/scan-moves.ts` | Orchestrator: poll → policy → extract → resolve → upsert |
| `src/lib/roster-moves/season-diff.ts` | Confirmed backbone (§5): diff two roster seasons |
| `scripts/scan-moves.ts` / `scripts/season-diff-moves.ts` | CLI entrypoints |

## Sources (multi-source by design)

| Source | Covers | Cost | Method |
|--------|--------|------|--------|
| **GopherPuckLive portal** (`scan:portal`) | D1 transfers (in + out) | free | structured JSON, deterministic |
| **Neutral Zone** (`scan:nz`) | commits (recruits) — the fullest source | free | deterministic table parse; Commit Year → season |
| **THN commitments** (`scan:commitments`) | commits + transfer_ins | free | deterministic parse of the live-blog `articleBody` |
| **X reports** (`scan:moves`) | pro signings, misc — what trackers miss | X API $/read | multimodal LLM extract |
| **season-diff** (`season-diff`) | confirmed backbone | free | roster-season diff |

Neutral Zone (`neutralzone.com/ncaa-commitments`) is the strongest recruit source: its
Commit Year column is the enrollment year (2026 ⇒ 2026-27), so `scan:nz` fills the current
season and could feed future ones. Destination anchors the move; non-D1 (D3) destinations
are skipped + counted (watch the skip sample for real D1 teams the resolver misses).
Reuses `source_type=commit_tracker` (disambiguated by `sighting.by=neutral_zone`).

Validation-only sources (NOT ingested): CHN rosters (`validate:chn`, see scripts/) and
collegehockeyinc/collegecommitments.com (future-year commits; its "Starting Year" can
filter CHN rosters down to true current-season arrivals).

No single source is complete: the portal misses commits and non-graduation departures
(NHL/AHL/ECHL signings); X fills those. Overlap is fine — dedup_key collapses it and
independent agreement bumps confidence.

## Running

```bash
# Transfer portal (free, no X spend) — the primary transfer source:
npm run scan:portal

# NCAA commitments + transfers from THN (free):
npm run scan:commitments

# NCAA recruit commitments from Neutral Zone (free) — fullest recruit source:
npm run scan:nz

# X-sourced layer for commits / pro signings / misc (needs X_BEARER_TOKEN + seeded x_accounts):
npm run scan:moves

# Local test with no X spend — point at a fixture instead:
ROSTER_MOVES_FIXTURE=./fixtures/roster-moves.sample.json npm run scan:moves

# Confirmed backbone once next-season rosters are seeded in team_players:
npm run season-diff
```

CI: `.github/workflows/scan-moves.yml` (manual `workflow_dispatch` only for the
pilot; a ~2×/day schedule is commented out — enable after the pilot, contract §8 Q4).

## Decisions made here (resolving the contract's open questions §8)

1. **Graduations** — NOT emitted by omni-agents. The season-diff skips departing
   seniors/grads (`class_year` 4/5); omni-hockey derives graduation rows on the
   read side. (Contract recommendation followed.)
2. **Provenance** — `raw.sources` jsonb array (a `MoveSighting` per sighting),
   not a `move_sources` child table. Matches the "append + bump confidence on
   repeat sighting" flow.
5. **Season-diff location** — lives here (omni-agents), as a script/lib that
   diffs `team_players.start_date` seasons in the shared DB.

## Contract deviations to note for omni-hockey

- **`team_seo` source.** The contract's §3 table implies a `teams.ncaa_seo`
  column; the shared DB actually stores it at `teams.external_ids->>'ncaa_seo'`.
  We denormalize from there into `roster_moves.team_seo`. When a school can't be
  resolved, `team_id` is null and `team_seo` is a slug of the reported name (so
  the row is still dedup-stable and linkable later) — read side should tolerate
  slugs that aren't real `ncaa_seo` values.

## Correctness guards worth knowing

- **Team matching is token-SET equality with abbreviation expansion**, not
  substring — the DB abbreviates place names (`Minn. Duluth`) while reporters
  write them out (`Minnesota Duluth`), and stems collide (`Minnesota` /
  `Minnesota St.` / `Minn. Duluth`). Substring matching mis-resolves these.
  Ambiguous names resolve to the slug fallback rather than a wrong school.
- **Pagination.** NCAA enrollments and the `players` table both exceed
  PostgREST's 1000-row cap; loaders page through all rows (`db.ts#fetchAll`).
  Without this the season-diff would read the truncated tail as departures.
- **Season-diff no-ops** until the new season's rosters exist in `team_players`
  (otherwise every prior-season player looks like a departure).

## Status (as of first build-out)

- Migrations 007–010 applied. `roster_moves` populated for 2026-27: portal
  (`scan:portal`) + THN commitments (`scan:commitments`) live, with cross-source
  corroboration confirmed (portal transfer_ins bumped by THN agreement).
- `x_accounts` seeded from `X_ACCOUNTS` (20 handles); `X_BEARER_TOKEN` set.

## Not done yet (needs Phil / a follow-up)

- **Schedule the free scanners** (`scan:portal`, `scan:commitments`) — a GitHub
  workflow like `scan.yml`. They're idempotent + free, so daily is fine.
- **X live scraping** — `scan:moves` is fixture-validated; Phil has config to add.
- **season-diff** — no-ops until 2026-27 rosters are seeded in `team_players`.
- **CHL/EP cross-validation** — read-only reconciliation to find coverage gaps
  (we don't source from EP; just validate against CHL data already in the DB).
- **Missing teams**: Mercyhurst (dropped D1) intentionally absent — its portal
  rows carry slug `team_seo` + null `team_id`.
