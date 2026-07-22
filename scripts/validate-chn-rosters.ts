import { config } from 'dotenv';
config({ path: '.env.local' });

import * as cheerio from 'cheerio';
import { supabase } from '../src/lib/supabase';
import { fetchAll, type Rangeable } from '../src/lib/roster-moves/db';
import { resolveNcaaTeam } from '../src/lib/roster-moves/resolve';
import { normalizePlayerName } from '../src/lib/roster-moves/normalize';
import { currentMovesSeason } from '../src/lib/roster-moves/config';

/**
 * VALIDATION ONLY (read-only; writes nothing). Compares our roster_moves
 * coverage against College Hockey News 2026-27 rosters — the external ground
 * truth. We do NOT source/ingest from CHN (it stays in BLOCKED_DOMAINS); this
 * is a reconciliation to see how close our collected moves get us and where the
 * gaps are.
 *
 * Method per team:
 *   CHN_2027   = players on CHN's 2026-27 active roster
 *   OURS_2025  = players on our 2025-26 roster (team_players)
 *   newcomers  = CHN_2027 − OURS_2025      (arrived for 2026-27)
 *   departed   = OURS_2025 − CHN_2027      (gone: grad / transfer / pro)
 * Then check how many newcomers we captured as commit/transfer_in, and how many
 * (non-graduating) departures we captured as transfer_out/pro/departure.
 */

const PREV_SEASON_START = '2025-09-01';
const DELAY_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ChnTeam {
  chnName: string;
  url: string;
}

/** Discover team → roster URL from the CHN home page. */
async function getChnTeams(): Promise<ChnTeam[]> {
  const res = await fetch('https://www.collegehockeynews.com/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OmniAgents/1.0)' },
    signal: AbortSignal.timeout(20000),
  });
  const html = await res.text();
  const seen = new Map<string, ChnTeam>();
  for (const m of html.matchAll(/\/reports\/roster\/([A-Za-z0-9-]+)\/(\d+)/g)) {
    const path = `/reports/roster/${m[1]}/${m[2]}`;
    if (!seen.has(path)) {
      seen.set(path, {
        chnName: m[1].replace(/-/g, ' '),
        url: `https://www.collegehockeynews.com${path}/20262027`,
      });
    }
  }
  return [...seen.values()];
}

/** Parse a CHN 2026-27 roster page → normalized player-name set (active roster). */
async function fetchChnRoster(url: string): Promise<Set<string>> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OmniAgents/1.0)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return new Set();
  const $ = cheerio.load(await res.text());
  const names = new Set<string>();
  // Table 0 is the active roster; its player rows have a "Last, First" Name cell.
  const table = $('table').first();
  table
    .find('tr')
    .slice(1)
    .each((_, tr) => {
      const cells = $(tr)
        .find('td')
        .map((_i, td) => $(td).text().replace(/\s+/g, ' ').trim())
        .get();
      const nameCell = cells.find((c) => c.includes(','));
      if (!nameCell) return; // position subheader row
      const [last, first] = nameCell.split(',').map((s) => s.trim());
      if (last && first) names.add(normalizePlayerName(`${first} ${last}`));
    });
  return names;
}

interface PrevRow {
  player_id: string;
  team_id: string;
  class_year: number | null;
  player: { first_name: string; last_name: string } | null;
}

async function main() {
  const season = currentMovesSeason();
  console.log(`Validating our ${season} moves vs CHN 2026-27 rosters...\n`);

  // Our 2025-26 rosters, grouped by team_id.
  const prev = await fetchAll<PrevRow>(
    () =>
      supabase
        .from('team_players')
        .select(
          'player_id, team_id, class_year, player:players(first_name, last_name)',
        )
        .eq('start_date', PREV_SEASON_START) as unknown as Rangeable<PrevRow>,
  );
  const prevByTeam = new Map<string, Map<string, number | null>>(); // teamId -> name -> class_year
  for (const r of prev) {
    if (!r.player) continue;
    const name = normalizePlayerName(`${r.player.first_name} ${r.player.last_name}`);
    if (!prevByTeam.has(r.team_id)) prevByTeam.set(r.team_id, new Map());
    prevByTeam.get(r.team_id)!.set(name, r.class_year);
  }

  // Our moves, grouped by team_seo + kind.
  const moves = await fetchAll<{
    team_seo: string;
    direction: string;
    player_name: string;
  }>(
    () =>
      supabase
        .from('roster_moves')
        .select('team_seo, direction, player_name')
        .eq('season', season) as unknown as Rangeable<{
        team_seo: string;
        direction: string;
        player_name: string;
      }>,
  );
  const IN = new Set(['commit', 'transfer_in']);
  const OUT = new Set(['transfer_out', 'pro_signing', 'departure']);
  const addsBySeo = new Map<string, Set<string>>();
  const dropsBySeo = new Map<string, Set<string>>();
  for (const m of moves) {
    const bucket = IN.has(m.direction)
      ? addsBySeo
      : OUT.has(m.direction)
        ? dropsBySeo
        : null;
    if (!bucket) continue;
    if (!bucket.has(m.team_seo)) bucket.set(m.team_seo, new Set());
    bucket.get(m.team_seo)!.add(normalizePlayerName(m.player_name));
  }

  const chnTeams = await getChnTeams();
  console.log(`CHN teams found: ${chnTeams.length}\n`);

  let tNewcomers = 0,
    tNewCaught = 0,
    tDepNonGrad = 0,
    tDepCaught = 0,
    teamsChecked = 0;
  const worstGaps: { team: string; missed: string[] }[] = [];

  for (const t of chnTeams) {
    const resolved = await resolveNcaaTeam(t.chnName);
    if (!resolved?.teamId) continue; // not in our DB (e.g. Alaska ambiguity, D3)
    const prevRoster = prevByTeam.get(resolved.teamId);
    if (!prevRoster) continue;

    const chn = await fetchChnRoster(t.url);
    await sleep(DELAY_MS);
    if (chn.size === 0) continue; // roster not posted / fetch failed
    teamsChecked++;

    const prevNames = new Set(prevRoster.keys());
    const newcomers = [...chn].filter((n) => !prevNames.has(n));
    const departed = [...prevNames].filter((n) => !chn.has(n));
    // Graduations = departed players who were Sr/Gr — we don't capture those.
    const depNonGrad = departed.filter((n) => {
      const cy = prevRoster.get(n);
      return !(cy === 4 || cy === 5);
    });

    const ourAdds = addsBySeo.get(resolved.teamSeo) ?? new Set();
    const ourDrops = dropsBySeo.get(resolved.teamSeo) ?? new Set();
    const newCaught = newcomers.filter((n) => ourAdds.has(n));
    const depCaught = depNonGrad.filter((n) => ourDrops.has(n));

    tNewcomers += newcomers.length;
    tNewCaught += newCaught.length;
    tDepNonGrad += depNonGrad.length;
    tDepCaught += depCaught.length;

    const missed = newcomers.filter((n) => !ourAdds.has(n));
    if (missed.length > 0) worstGaps.push({ team: t.chnName, missed });
  }

  const pct = (a: number, b: number) => (b === 0 ? '—' : `${((a / b) * 100).toFixed(0)}%`);
  console.log('════════ COVERAGE vs CHN 2026-27 ════════');
  console.log(`Teams checked: ${teamsChecked}`);
  console.log(
    `Newcomers (recruits + transfers-in) captured: ${tNewCaught}/${tNewcomers} (${pct(tNewCaught, tNewcomers)})`,
  );
  console.log(
    `Non-graduation departures captured:           ${tDepCaught}/${tDepNonGrad} (${pct(tDepCaught, tDepNonGrad)})`,
  );
  console.log(
    `\n(Graduations excluded — owned by omni-hockey read side. Departures are\n expected low until X pro-signings + season-diff are on.)`,
  );

  worstGaps.sort((a, b) => b.missed.length - a.missed.length);
  console.log('\n──── Biggest newcomer gaps (where to look) ────');
  for (const g of worstGaps.slice(0, 12)) {
    console.log(`  ${g.team} (+${g.missed.length}): ${g.missed.slice(0, 6).join(', ')}${g.missed.length > 6 ? ' …' : ''}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
