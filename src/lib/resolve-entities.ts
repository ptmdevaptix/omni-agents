import { supabase } from './supabase';
import type { ResolvedEntities } from '@/types';

/**
 * Normalize a string for comparison: lowercase, trim, collapse whitespace.
 */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Resolve extracted team names against the database.
 * Matches against: "place_name nickname", nickname alone, or abbreviation.
 */
async function resolveTeams(
  teamNames: string[],
): Promise<{ resolved: { id: string; league: string }[]; unresolved: string[] }> {
  if (teamNames.length === 0) return { resolved: [], unresolved: [] };

  const { data: teams, error } = await supabase
    .from('teams')
    .select('id, place_name, nickname, abbreviation, league');

  if (error || !teams) {
    return { resolved: [], unresolved: teamNames };
  }

  const resolved: { id: string; league: string }[] = [];
  const unresolved: string[] = [];

  for (const name of teamNames) {
    const norm = normalize(name);
    const match = teams.find((t) => {
      const fullName = normalize(`${t.place_name} ${t.nickname}`);
      const nickname = normalize(t.nickname);
      const abbr = normalize(t.abbreviation);
      return norm === fullName || norm === nickname || norm === abbr;
    });

    if (match) {
      if (!resolved.some((r) => r.id === match.id)) {
        resolved.push({ id: match.id, league: match.league });
      }
    } else {
      unresolved.push(name);
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
 */
export async function resolveEntities(entities: {
  players: string[];
  teams: string[];
  leagues: string[];
}): Promise<ResolvedEntities> {
  const [teamResult, playerResult, leagueResult] = await Promise.all([
    resolveTeams(entities.teams),
    resolvePlayers(entities.players),
    resolveLeagues(entities.leagues),
  ]);

  // Infer league IDs from matched teams' league text
  const teamLeagueNames = [
    ...new Set(teamResult.resolved.map((t) => t.league)),
  ];
  const inferredLeagues = await resolveLeagues(teamLeagueNames);

  // Merge explicit + inferred league IDs (deduplicated)
  const allLeagueIds = [
    ...new Set([...leagueResult.resolved, ...inferredLeagues.resolved]),
  ];

  return {
    teamIds: teamResult.resolved.map((t) => t.id),
    playerIds: playerResult.resolved,
    leagueIds: allLeagueIds,
    unresolvedTeams: teamResult.unresolved,
    unresolvedPlayers: playerResult.unresolved,
    unresolvedLeagues: leagueResult.unresolved,
  };
}
