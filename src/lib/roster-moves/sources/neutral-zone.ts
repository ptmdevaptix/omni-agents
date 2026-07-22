import * as cheerio from 'cheerio';

/**
 * Neutral Zone NCAA commitments tracker.
 *
 * A public, server-rendered table (Name, Current Team, League, Pos,
 * Commitment=destination, Commit Year, Date Reported). "Commit Year" is the
 * enrollment year — 2026 ⇒ the 2026-27 season — so one feed covers the current
 * and future recruiting classes. Parsed deterministically (no LLM).
 *
 * Note: Neutral Zone is a scouting site; this is its public commitments list
 * (factual commit data), not gated scouting content.
 */

export const NEUTRAL_ZONE_URL = 'https://neutralzone.com/ncaa-commitments/';

export interface NzCommitment {
  playerName: string;
  /** Junior/USHL/Europe club or another NCAA school. */
  currentTeam: string;
  league: string;
  position: 'F' | 'D' | 'G' | null;
  /** Destination school as written. */
  destName: string;
  /** Enrollment year, e.g. "2026" (⇒ 2026-27). */
  commitYear: string;
  dateReported: string;
}

function mapPosition(pos: string): 'F' | 'D' | 'G' | null {
  const p = pos.trim().toUpperCase();
  if (p === 'D') return 'D';
  if (p === 'G') return 'G';
  if (['F', 'LW', 'RW', 'C', 'LW/RW', 'W'].includes(p)) return 'F';
  return null;
}

/** Parse the commitments table from the page HTML. */
export function parseNeutralZone(html: string): NzCommitment[] {
  const $ = cheerio.load(html);
  // The first (largest) table is the master list of all commitments.
  const table = $('table').first();
  const heads = table
    .find('tr')
    .first()
    .find('th, td')
    .map((_, c) => $(c).text().replace(/\s+/g, ' ').trim())
    .get();
  const idx: Record<string, number> = {};
  heads.forEach((h, i) => (idx[h] = i));
  const col = (cells: string[], key: string) => {
    const i = idx[key];
    return i === undefined ? '' : (cells[i] ?? '').trim();
  };

  const out: NzCommitment[] = [];
  table
    .find('tr')
    .slice(1)
    .each((_, tr) => {
      const cells = $(tr)
        .find('td')
        .map((_i, td) => $(td).text().replace(/\s+/g, ' ').trim())
        .get();
      const name = col(cells, 'Name');
      const dest = col(cells, 'Commitment');
      if (!name || !dest) return;
      out.push({
        playerName: name,
        currentTeam: col(cells, 'Current Team'),
        league: col(cells, 'League'),
        position: mapPosition(col(cells, 'P')),
        destName: dest,
        commitYear: col(cells, 'Commit Year'),
        dateReported: col(cells, 'Date Reported'),
      });
    });
  return out;
}

export async function fetchNeutralZone(
  url: string = NEUTRAL_ZONE_URL,
): Promise<NzCommitment[]> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OmniAgents/1.0; +https://github.com)',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Neutral Zone fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  return parseNeutralZone(await res.text());
}

/** Enrollment year for a "YYYY-YY" season (e.g. "2026-27" → "2026"). */
export function commitYearForSeason(season: string): string | null {
  const m = season.match(/^(\d{4})-\d{2}$/);
  return m ? m[1] : null;
}
