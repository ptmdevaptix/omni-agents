import { supabase } from './supabase';
import type { ResolvedEntities } from '@/types';

/**
 * Normalize a string for comparison: lowercase, trim, collapse whitespace.
 */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Common place name abbreviation mappings (both directions).
 * Used to match "New York Islanders" against "NY Islanders", etc.
 */
/**
 * Substitution pairs for place name normalization.
 * Each pair [a, b] means: anywhere 'a' appears, also try 'b', and vice versa.
 */
const PLACE_SUBSTITUTIONS: [string, string][] = [
  ['new york', 'ny'],
  ['saint', 'st.'],
  ['state', 'st.'],
  ['university', 'univ.'],
  ['minnesota', 'minn.'],
];

/**
 * Generate all normalized variants of a name by applying substitutions.
 * Returns the original + all variants (deduplicated).
 */
function nameVariants(name: string): string[] {
  const norm = normalize(name);
  const variants = new Set([norm]);

  for (const [a, b] of PLACE_SUBSTITUTIONS) {
    if (norm.includes(a)) {
      variants.add(norm.replace(a, b));
    }
    if (norm.includes(b)) {
      variants.add(norm.replace(b, a));
    }
  }

  // Second pass: apply substitutions to already-generated variants
  // to handle chains (e.g. "St. Cloud St." needs both st. expansions)
  const firstPass = [...variants];
  for (const v of firstPass) {
    for (const [a, b] of PLACE_SUBSTITUTIONS) {
      if (v.includes(a)) {
        variants.add(v.replace(a, b));
      }
      if (v.includes(b)) {
        variants.add(v.replace(b, a));
      }
    }
  }

  return [...variants];
}

/**
 * League priority for disambiguation — higher = preferred when ambiguous.
 * When "Rangers" appears without context, prefer NHL over OHL.
 */
const LEAGUE_PRIORITY: Record<string, number> = {
  NHL: 100,
  AHL: 90,
  OHL: 70,
  WHL: 70,
  QMJHL: 70,
  ECHL: 60,
  USHL: 50,
  NCAA: 50,
  SPHL: 40,
  NAHL: 30,
};

function getLeaguePriority(league: string): number {
  return LEAGUE_PRIORITY[league] ?? 10;
}

interface TeamRow {
  id: string;
  place_name: string;
  nickname: string;
  abbreviation: string;
  league: string;
}

/**
 * Check if a team matches a given name.
 * Returns match type for ranking: 'full' > 'place' > 'abbr' > 'nickname' > null
 *
 * Tries all abbreviation variants (e.g. "New York Rangers" matches "NY Rangers").
 */
function matchTeam(
  team: TeamRow,
  inputName: string,
): 'full' | 'place' | 'abbr' | 'nickname' | null {
  const placeName = normalize(team.place_name);
  const nickname = normalize(team.nickname);
  const abbr = normalize(team.abbreviation);

  // Full combined name (deduplicated for cases like "NY Rangers" where place contains nickname)
  const fullName = placeName.includes(nickname)
    ? placeName
    : `${placeName} ${nickname}`;

  // Generate all variants of the full name and place name too
  const fullNameVariants = nameVariants(fullName);
  const placeNameVariants = nameVariants(placeName);

  // Check input against all variants
  const inputVariants = nameVariants(inputName);

  for (const input of inputVariants) {
    if (fullNameVariants.includes(input)) return 'full';
  }

  for (const input of inputVariants) {
    if (input === abbr) return 'abbr';
  }

  for (const input of inputVariants) {
    if (placeNameVariants.includes(input)) return 'place';
  }

  for (const input of inputVariants) {
    if (input === nickname) return 'nickname';
  }

  return null;
}

const MATCH_RANK: Record<string, number> = {
  full: 100,
  abbr: 90,
  place: 80,
  nickname: 10, // Low — ambiguous, needs context to disambiguate
};

/**
 * Resolve extracted team names against the database.
 *
 * Uses a two-pass approach:
 * 1. Find all candidate matches for each name
 * 2. Disambiguate using context (league hint, peer teams, league priority)
 *
 * @param leagueHint - Optional league name from the feed association (e.g. "NHL")
 */
async function resolveTeams(
  teamNames: string[],
  leagueHint?: string,
): Promise<{ resolved: { id: string; league: string }[]; unresolved: string[] }> {
  if (teamNames.length === 0) return { resolved: [], unresolved: [] };

  const { data: teams, error } = await supabase
    .from('teams')
    .select('id, place_name, nickname, abbreviation, league');

  if (error || !teams) {
    return { resolved: [], unresolved: teamNames };
  }

  // Pass 1: find all candidates for each name
  const candidatesPerName: { name: string; candidates: { team: TeamRow; matchType: string }[] }[] = [];

  for (const name of teamNames) {
    const norm = normalize(name);
    const candidates: { team: TeamRow; matchType: string }[] = [];

    for (const team of teams) {
      const matchType = matchTeam(team, norm);
      if (matchType) {
        candidates.push({ team, matchType });
      }
    }

    candidatesPerName.push({ name, candidates });
  }

  // Pass 2: resolve unambiguous matches first to build league context
  const resolved: { id: string; league: string }[] = [];
  const unresolved: string[] = [];
  const resolvedLeagues = new Set<string>();

  if (leagueHint) {
    resolvedLeagues.add(normalize(leagueHint));
  }

  // First: resolve names with exactly one candidate or a clear best match (full/abbr)
  const deferred: typeof candidatesPerName = [];

  for (const { name, candidates } of candidatesPerName) {
    if (candidates.length === 0) {
      unresolved.push(name);
      continue;
    }

    if (candidates.length === 1) {
      const t = candidates[0].team;
      if (!resolved.some((r) => r.id === t.id)) {
        resolved.push({ id: t.id, league: t.league });
        resolvedLeagues.add(normalize(t.league));
      }
      continue;
    }

    // Multiple candidates — check if there's a clear winner by match type
    const best = candidates.sort(
      (a, b) => (MATCH_RANK[b.matchType] ?? 0) - (MATCH_RANK[a.matchType] ?? 0),
    );

    if (
      best[0].matchType !== best[1].matchType &&
      MATCH_RANK[best[0].matchType] >= 80
    ) {
      // Clear best match (e.g. full name match vs nickname match)
      const t = best[0].team;
      if (!resolved.some((r) => r.id === t.id)) {
        resolved.push({ id: t.id, league: t.league });
        resolvedLeagues.add(normalize(t.league));
      }
    } else {
      // Truly ambiguous — defer for context-aware resolution
      deferred.push({ name, candidates });
    }
  }

  // Second: resolve deferred names using accumulated context
  for (const { name, candidates } of deferred) {
    // Score each candidate
    const scored = candidates.map(({ team, matchType }) => {
      let score = MATCH_RANK[matchType] ?? 0;

      // Bonus: same league as already-resolved teams (peer context)
      if (resolvedLeagues.has(normalize(team.league))) {
        score += 50;
      }

      // Bonus: matches the feed's league hint
      if (leagueHint && normalize(team.league) === normalize(leagueHint)) {
        score += 40;
      }

      // Tiebreaker: league priority (NHL > AHL > OHL etc.)
      score += getLeaguePriority(team.league) / 10;

      return { team, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const winner = scored[0].team;
    if (!resolved.some((r) => r.id === winner.id)) {
      resolved.push({ id: winner.id, league: winner.league });
      resolvedLeagues.add(normalize(winner.league));
    }
  }

  return { resolved, unresolved };
}

/**
 * Resolve extracted player names against the database.
 * Matches against "first_name last_name".
 */
async function resolvePlayers(
  playerNames: string[],
): Promise<{ resolved: string[]; unresolved: string[] }> {
  if (playerNames.length === 0) return { resolved: [], unresolved: [] };

  const { data: players, error } = await supabase
    .from('players')
    .select('id, first_name, last_name');

  if (error || !players) {
    return { resolved: [], unresolved: playerNames };
  }

  const resolved: string[] = [];
  const unresolved: string[] = [];

  for (const name of playerNames) {
    const norm = normalize(name);
    const match = players.find((p) => {
      return normalize(`${p.first_name} ${p.last_name}`) === norm;
    });

    if (match) {
      if (!resolved.includes(match.id)) {
        resolved.push(match.id);
      }
    } else {
      unresolved.push(name);
    }
  }

  return { resolved, unresolved };
}

/**
 * Resolve extracted league names against the database.
 * Matches against canonical name or any alias.
 */
async function resolveLeagues(
  leagueNames: string[],
): Promise<{ resolved: string[]; unresolved: string[] }> {
  if (leagueNames.length === 0) return { resolved: [], unresolved: [] };

  const { data: leagues, error } = await supabase
    .from('leagues')
    .select('id, name, aliases');

  if (error || !leagues) {
    return { resolved: [], unresolved: leagueNames };
  }

  const resolved: string[] = [];
  const unresolved: string[] = [];

  for (const name of leagueNames) {
    const norm = normalize(name);
    const match = leagues.find((l) => {
      if (normalize(l.name) === norm) return true;
      return (l.aliases as string[]).some((a) => normalize(a) === norm);
    });

    if (match) {
      if (!resolved.includes(match.id)) {
        resolved.push(match.id);
      }
    } else {
      unresolved.push(name);
    }
  }

  return { resolved, unresolved };
}

/**
 * Resolve all extracted entity names to database IDs.
 * Leagues are both explicitly resolved and inferred from matched teams.
 * League IDs are expanded upward through parent_league_id so ancestors
 * are always included (e.g. OHL article also gets CHL).
 *
 * @param leagueHint - Optional league name from the feed for disambiguation
 * @param feedLeagueId - Optional league UUID from the feed to always include in tags
 */
export async function resolveEntities(
  entities: {
    players: string[];
    teams: string[];
    leagues: string[];
  },
  leagueHint?: string,
  feedLeagueId?: string,
): Promise<ResolvedEntities> {
  const [teamResult, playerResult, leagueResult] = await Promise.all([
    resolveTeams(entities.teams, leagueHint),
    resolvePlayers(entities.players),
    resolveLeagues(entities.leagues),
  ]);

  // Infer league IDs from matched teams' league text
  const teamLeagueNames = [
    ...new Set(teamResult.resolved.map((t) => t.league)),
  ];
  const inferredLeagues = await resolveLeagues(teamLeagueNames);

  // Merge explicit + inferred + feed league IDs (deduplicated)
  let allLeagueIds = [
    ...new Set([
      ...leagueResult.resolved,
      ...inferredLeagues.resolved,
      ...(feedLeagueId ? [feedLeagueId] : []),
    ]),
  ];

  // Expand league IDs to include all ancestors via parent_league_id.
  // E.g. OHL → {OHL, CHL}; Hockey East → {Hockey East, NCAA}.
  if (allLeagueIds.length > 0) {
    const { data: hier } = await supabase
      .from('leagues')
      .select('id, parent_league_id');
    const parentOf = new Map<string, string | null>(
      (hier ?? []).map((l) => [l.id, l.parent_league_id]),
    );

    const expanded = new Set(allLeagueIds);
    for (const id of allLeagueIds) {
      let cur = parentOf.get(id) ?? null;
      const guard = new Set<string>(); // cycle protection
      while (cur && !expanded.has(cur) && !guard.has(cur)) {
        guard.add(cur);
        expanded.add(cur);
        cur = parentOf.get(cur) ?? null;
      }
    }
    allLeagueIds = [...expanded];
  }

  return {
    teamIds: teamResult.resolved.map((t) => t.id),
    playerIds: playerResult.resolved,
    leagueIds: allLeagueIds,
    unresolvedTeams: teamResult.unresolved,
    unresolvedPlayers: playerResult.unresolved,
    unresolvedLeagues: leagueResult.unresolved,
  };
}
