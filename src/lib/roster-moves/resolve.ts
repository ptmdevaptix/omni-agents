import { supabase } from '../supabase';
import { fetchAll, type Rangeable } from './db';
import { normalizePlayerName } from './normalize';

/**
 * Entity resolution for roster moves.
 *
 * Teams resolve cleanly (NCAA schools have a stable ncaa_seo); reported player
 * names are messy and incoming recruits may not have a players row yet, so
 * players resolve to id-or-null and get linked later by the season-diff pass
 * (contract §7).
 *
 * Team matching is by canonical token-SET equality, not substring: the DB
 * stores abbreviated place names ("Minn. Duluth", "Northern Mich.") while
 * reporters write them out ("Minnesota Duluth"), and several schools share a
 * stem ("Minnesota" / "Minnesota St." / "Minn. Duluth"). Substring matching
 * mis-resolves those; token-set equality after abbreviation expansion does not.
 */

/**
 * Canonical token rewrites applied to BOTH stored names and reported input, so
 * "Minnesota" ↔ "Minn.", "State" ↔ "St.", etc. collapse. Empty string drops
 * the token (generic words like "University").
 */
const TOKEN_MAP: Record<string, string> = {
  state: 'st',
  saint: 'st',
  university: '',
  univ: '',
  of: '',
  the: '',
  minnesota: 'minn',
  michigan: 'mich',
  nebraska: 'neb',
  alaska: 'alas',
  massachusetts: 'mass',
  umass: 'mass',
  connecticut: 'conn',
  uconn: 'conn',
  institute: 'inst',
};

/** Turn a name into a canonical token-set signature (sorted, deduped). */
function signature(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[().,'’`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((t) => (t in TOKEN_MAP ? TOKEN_MAP[t] : t))
    .filter(Boolean);
  return [...new Set(tokens)].sort().join(' ');
}

/** Signatures a reported name might take (with and without a parenthetical). */
function inputSignatures(name: string): string[] {
  const sigs = new Set<string>();
  const full = signature(name);
  if (full) sigs.add(full);
  const noParen = name.replace(/\([^)]*\)/g, ' ').trim();
  if (noParen && noParen !== name) {
    const s = signature(noParen);
    if (s) sigs.add(s);
  }
  return [...sigs];
}

const AMBIGUOUS = Symbol('ambiguous');
interface NcaaIndex {
  sigToTeam: Map<string, string | typeof AMBIGUOUS>;
  seoById: Map<string, string>;
  /** Per-team place/seo token sets, for the subset-match fallback. */
  teamTokens: Array<{ id: string; tokens: Set<string> }>;
}

let ncaaIndexCache: NcaaIndex | null = null;

interface PlayerRow {
  id: string;
  key: string; // normalized "first last"
}
let playersCache: PlayerRow[] | null = null;

async function loadNcaaIndex(): Promise<NcaaIndex> {
  if (ncaaIndexCache) return ncaaIndexCache;

  const { data, error } = await supabase
    .from('teams')
    .select('id, place_name, nickname, abbreviation, external_ids')
    .eq('league', 'NCAA');

  const sigToTeam = new Map<string, string | typeof AMBIGUOUS>();
  const seoById = new Map<string, string>();
  const teamTokens: Array<{ id: string; tokens: Set<string> }> = [];
  if (error || !data) {
    ncaaIndexCache = { sigToTeam, seoById, teamTokens };
    return ncaaIndexCache;
  }

  // Nicknames are only usable if globally unique (many schools are "Bulldogs").
  const nicknameCounts = new Map<string, number>();
  for (const t of data) {
    const n = (t.nickname as string)?.toLowerCase().trim();
    if (n) nicknameCounts.set(n, (nicknameCounts.get(n) ?? 0) + 1);
  }

  const add = (sig: string, teamId: string) => {
    if (!sig) return;
    const cur = sigToTeam.get(sig);
    if (cur === undefined) sigToTeam.set(sig, teamId);
    else if (cur !== teamId) sigToTeam.set(sig, AMBIGUOUS);
  };

  for (const t of data) {
    const seo = (t.external_ids as { ncaa_seo?: string } | null)?.ncaa_seo;
    if (!seo) continue;
    const id = t.id as string;
    seoById.set(id, seo);

    const place = t.place_name as string;
    const nickname = t.nickname as string;
    const abbr = t.abbreviation as string;

    add(signature(place), id);
    add(signature(`${place} ${nickname}`), id);
    add(signature(seo.replace(/-/g, ' ')), id);
    add(signature(abbr), id);
    // Paren-stripped place ("Miami (OH)" → "Miami").
    for (const s of inputSignatures(place)) add(s, id);
    // Unique nickname only.
    if (nicknameCounts.get(nickname.toLowerCase().trim()) === 1) {
      add(signature(nickname), id);
    }

    // Place + seo tokens (no nickname) for the subset-match fallback.
    const tokens = new Set<string>([
      ...signature(place).split(' '),
      ...signature(seo.replace(/-/g, ' ')).split(' '),
    ]);
    tokens.delete('');
    teamTokens.push({ id, tokens });
  }

  ncaaIndexCache = { sigToTeam, seoById, teamTokens };
  return ncaaIndexCache;
}

interface PlayerNameRow {
  id: string;
  first_name: string;
  last_name: string;
}

async function loadPlayers(): Promise<PlayerRow[]> {
  if (playersCache) return playersCache;
  // Players exceed PostgREST's 1000-row cap — page through all of them so
  // name matching doesn't silently miss the tail.
  const rows = await fetchAll<PlayerNameRow>(
    () =>
      supabase
        .from('players')
        .select('id, first_name, last_name') as unknown as Rangeable<PlayerNameRow>,
  );
  playersCache = rows.map((p) => ({
    id: p.id,
    key: normalizePlayerName(`${p.first_name} ${p.last_name}`),
  }));
  return playersCache;
}

export interface ResolvedTeam {
  teamId: string | null;
  /** Always present: real ncaa_seo when matched, else a slug of the raw name. */
  teamSeo: string;
}

/**
 * Resolve a reported NCAA school name to { teamId, teamSeo }.
 * On no (or ambiguous) match, teamId is null and teamSeo is a normalized slug
 * of the raw name, so the dedup_key stays stable and a human / the season-diff
 * can link it later (better an unresolved row than a WRONG school).
 */
export async function resolveNcaaTeam(
  teamName: string | null | undefined,
): Promise<ResolvedTeam | null> {
  if (!teamName || !teamName.trim()) return null;
  const { sigToTeam, seoById, teamTokens } = await loadNcaaIndex();

  for (const sig of inputSignatures(teamName)) {
    const hit = sigToTeam.get(sig);
    if (hit && hit !== AMBIGUOUS) {
      return { teamId: hit, teamSeo: seoById.get(hit)! };
    }
  }

  // Subset fallback: input tokens ⊂ exactly one team (e.g. "Lake Superior" →
  // "Lake Superior St."). Skipped when ambiguous ("Alaska" ⊂ two teams).
  const inTokens = signature(teamName).split(' ').filter(Boolean);
  if (inTokens.length > 0) {
    let match: string | null = null;
    let count = 0;
    for (const t of teamTokens) {
      if (inTokens.every((tok) => t.tokens.has(tok))) {
        count++;
        match = t.id;
        if (count > 1) break;
      }
    }
    if (count === 1 && match) {
      return { teamId: match, teamSeo: seoById.get(match)! };
    }
  }

  return {
    teamId: null,
    teamSeo: teamName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  };
}

/** Resolve a reported player name to a players.id, or null if unknown. */
export async function resolvePlayerId(
  playerName: string,
): Promise<string | null> {
  const players = await loadPlayers();
  const key = normalizePlayerName(playerName);
  const match = players.find((p) => p.key === key);
  return match ? match.id : null;
}

/** Reset caches (tests / long-lived processes). */
export function resetResolveCaches(): void {
  ncaaIndexCache = null;
  playersCache = null;
}
