/**
 * Name normalization for dedup keys and player matching.
 *
 * The dedup_key collapses the same move seen across many tweets/sources into
 * one row, so this must be stable: "José Martínez Jr." and "Jose Martinez"
 * should normalize alike. Kept intentionally close to the general
 * lowercase/trim/collapse used by resolve-entities, plus diacritic and
 * suffix stripping that matters for reported player names.
 */

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/**
 * Normalize a player name for comparison and dedup.
 * - strips diacritics (é → e)
 * - lowercases, removes punctuation, collapses whitespace
 * - drops trailing generational suffixes (Jr, III, ...)
 */
export function normalizePlayerName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[.,'’`]/g, '') // drop apostrophes/periods within names
    .replace(/[^a-z0-9]+/g, ' ') // any other punctuation → space
    .trim()
    .replace(/\s+/g, ' ');

  const parts = base.split(' ').filter(Boolean);
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(' ');
}

/**
 * Build the canonical dedup key for a roster move.
 * `${season}|${direction}|${normalizedPlayerName}|${team_seo}`
 */
export function dedupKey(parts: {
  season: string;
  direction: string;
  playerName: string;
  teamSeo: string;
}): string {
  return [
    parts.season,
    parts.direction,
    normalizePlayerName(parts.playerName),
    parts.teamSeo,
  ].join('|');
}
