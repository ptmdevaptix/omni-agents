/**
 * Roster-moves pipeline configuration.
 */

/**
 * The season roster moves are FOR (e.g. "2026-27"). During the 2026 offseason
 * that's 2026-27. Override with ROSTER_MOVES_SEASON if needed.
 */
export function currentMovesSeason(): string {
  return process.env.ROSTER_MOVES_SEASON ?? '2026-27';
}

/**
 * "{startYear}-09-01" — matches omni-hockey's team_players.start_date season
 * key. Derived from the leading year of a "YYYY-YY" season string.
 */
export function seasonStartDate(season: string): string | null {
  const m = season.match(/^(\d{4})-\d{2}$/);
  if (!m) return null;
  return `${m[1]}-09-01`;
}

/** The season a team_players.start_date belongs to, e.g. 2025-09-01 → "2025-26". */
export function seasonFromStartDate(startDate: string): string | null {
  const m = startDate.match(/^(\d{4})-/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = String((start + 1) % 100).padStart(2, '0');
  return `${start}-${end}`;
}
