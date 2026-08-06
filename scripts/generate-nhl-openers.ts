import { config } from 'dotenv';
config({ path: '.env.local' });

import {
  buildOpenerContext,
  generateOpenerPreview,
  saveGamePreview,
} from '../src/lib/content/nhl-preview';

/**
 * Generate season-opener previews for EVERY NHL team's first game, saved to
 * generated_content (status=new) for review. Usage:
 *   npm run gen:nhl-openers            # all teams (deduped by game)
 *   npm run gen:nhl-openers -- --dry   # list the unique opener games, generate nothing
 *
 * Shared openers (both teams open against each other) are the same game, so we
 * dedupe by game id first and generate ONE preview per unique game — the row is
 * keyed by game id (dedup_key game_preview:nhl-<id>) either way.
 */

const SEASON = '20262027';
// Current 32 NHL franchises. If one 404s (e.g. an abbrev changed), it's logged
// and skipped rather than aborting the run.
const TEAMS = [
  'ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET',
  'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NJD', 'NSH', 'NYI', 'NYR', 'OTT',
  'PHI', 'PIT', 'SJS', 'SEA', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK',
  'WPG', 'WSH',
];

interface SchedGame {
  id: number;
  gameType: number;
  gameDate: string;
  awayTeam: { abbrev: string };
  homeTeam: { abbrev: string };
}

/** First regular-season (gameType 2) game id for a team, or null. */
async function openerGameId(abbr: string): Promise<number | null> {
  const res = await fetch(`https://api-web.nhle.com/v1/club-schedule-season/${abbr}/${SEASON}`);
  if (!res.ok) {
    console.warn(`  ! ${abbr}: schedule fetch ${res.status} — skipping`);
    return null;
  }
  const data = (await res.json()) as { games?: SchedGame[] };
  const opener = (data.games ?? [])
    .filter((g) => g.gameType === 2)
    .sort((a, b) => a.gameDate.localeCompare(b.gameDate))[0];
  return opener?.id ?? null;
}

async function main() {
  const dry = process.argv.includes('--dry');

  // 1. Cheap pass: map each unique opener game id → the team to use as POV.
  //    First team seen wins; for a shared opener either POV is equivalent.
  console.log(`Collecting opener games for ${TEAMS.length} teams (${SEASON})...`);
  const gameTarget = new Map<number, string>();
  for (const t of TEAMS) {
    const id = await openerGameId(t);
    if (id == null) continue;
    if (!gameTarget.has(id)) gameTarget.set(id, t);
  }
  console.log(`\n${gameTarget.size} unique opener games from ${TEAMS.length} teams.\n`);

  if (dry) {
    for (const [gameId, target] of gameTarget) console.log(`  game ${gameId} — POV ${target}`);
    return;
  }

  // 2. Generate one preview per unique game.
  const results: { gameId: number; matchup: string; outcome: string; id?: number; error?: string }[] = [];
  let n = 0;
  for (const [gameId, target] of gameTarget) {
    n += 1;
    const tag = `[${n}/${gameTarget.size}]`;
    try {
      const ctx = await buildOpenerContext(target);
      const matchup = `${ctx.away.name} @ ${ctx.home.name} (${ctx.date})`;
      console.log(`${tag} ${matchup} — game ${ctx.gameId}${ctx.gameId !== gameId ? ` (note: ${gameId})` : ''}`);
      const preview = await generateOpenerPreview(ctx);
      const res = await saveGamePreview(ctx, preview);
      console.log(`      ${res.outcome} id=${res.id} — "${preview.title}"`);
      results.push({ gameId: ctx.gameId, matchup, outcome: res.outcome, id: res.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} game ${gameId} (${target}) FAILED: ${msg}`);
      results.push({ gameId, matchup: `POV ${target}`, outcome: 'error', error: msg });
    }
  }

  // 3. Summary.
  const ok = results.filter((r) => r.outcome !== 'error');
  const failed = results.filter((r) => r.outcome === 'error');
  console.log(`\n=== Done: ${ok.length} saved, ${failed.length} failed ===`);
  for (const f of failed) console.log(`  FAILED game ${f.gameId}: ${f.error}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
