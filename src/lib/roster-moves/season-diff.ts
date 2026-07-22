import { supabase } from '../supabase';
import { fetchAll } from './db';
import { upsertMove, type UpsertOutcome } from './upsert';
import {
  currentMovesSeason,
  seasonStartDate,
  seasonFromStartDate,
} from './config';
import type { Direction, MoveSighting } from './types';

/**
 * Season-diff pass (contract §5) — the confirmed backbone.
 *
 * Diffs omni-hockey's two NCAA roster seasons (team_players.start_date) once
 * the new season's rosters are posted:
 *   - on a prev roster, not on the same team's new roster → departure
 *     (or transfer_out if found on another team's new roster)
 *   - new name on a new roster → commit (or transfer_in if on a prev roster)
 *
 * Writes source_type=season_diff / confidence=confirmed, upserting on the same
 * dedup_key so an earlier x_report gets UPGRADED to confirmed.
 *
 * Graduations are intentionally NOT emitted: a departing senior/grad is owned
 * by omni-hockey's read-side derivation from class_year (contract §6/§8 Q1).
 */

const SENIOR_OR_GRAD = new Set([4, 5]);

export interface SeasonDiffResult {
  prevSeason: string;
  currentSeason: string;
  ran: boolean;
  note?: string;
  inserted: number;
  updated: number;
  byDirection: Record<Direction, number>;
  errors: string[];
}

interface Enrollment {
  playerId: string;
  teamId: string;
  teamSeo: string;
  playerName: string;
  classYear: number | null;
}

function prevSeasonOf(season: string): string | null {
  const m = season.match(/^(\d{4})-\d{2}$/);
  if (!m) return null;
  return seasonFromStartDate(`${Number(m[1]) - 1}-09-01`);
}

interface EnrollmentRow {
  player_id: string;
  team_id: string;
  class_year: number | null;
  team: { external_ids: { ncaa_seo?: string } | null } | null;
  player: { first_name: string; last_name: string } | null;
}

/** Load ALL NCAA enrollments for a given season (start_date), paged. */
async function loadEnrollments(startDate: string): Promise<Enrollment[]> {
  const rows = await fetchAll<EnrollmentRow>(
    () =>
      supabase
        .from('team_players')
        .select(
          'player_id, team_id, class_year, team:teams!inner(league, external_ids), player:players(first_name, last_name)',
        )
        .eq('start_date', startDate)
        .eq('team.league', 'NCAA') as unknown as import('./db').Rangeable<EnrollmentRow>,
  );

  const out: Enrollment[] = [];
  for (const row of rows) {
    const seo = row.team?.external_ids?.ncaa_seo;
    if (!seo || !row.player) continue;
    out.push({
      playerId: row.player_id,
      teamId: row.team_id,
      teamSeo: seo,
      playerName: `${row.player.first_name} ${row.player.last_name}`,
      classYear: row.class_year,
    });
  }
  return out;
}

function emptyByDirection(): Record<Direction, number> {
  return {
    commit: 0,
    transfer_in: 0,
    transfer_out: 0,
    departure: 0,
    pro_signing: 0,
    graduation: 0,
  };
}

export async function seasonDiff(): Promise<SeasonDiffResult> {
  const currentSeason = currentMovesSeason();
  const prevSeason = prevSeasonOf(currentSeason);
  const result: SeasonDiffResult = {
    prevSeason: prevSeason ?? '(unknown)',
    currentSeason,
    ran: false,
    inserted: 0,
    updated: 0,
    byDirection: emptyByDirection(),
    errors: [],
  };

  const currentStart = seasonStartDate(currentSeason);
  const prevStart = prevSeason ? seasonStartDate(prevSeason) : null;
  if (!currentStart || !prevStart) {
    result.note = 'Could not derive season start dates.';
    return result;
  }

  const [prev, current] = await Promise.all([
    loadEnrollments(prevStart),
    loadEnrollments(currentStart),
  ]);

  // Critical guard: if the new season isn't seeded yet, EVERY prev player would
  // look like a departure. Bail out instead of writing garbage.
  if (current.length === 0) {
    result.note = `New-season rosters (${currentSeason}) not seeded yet — nothing to diff.`;
    return result;
  }
  if (prev.length === 0) {
    result.note = `Prev-season rosters (${prevSeason}) missing — nothing to diff.`;
    return result;
  }

  result.ran = true;

  // Indexes.
  const prevTeamOf = new Map<string, Enrollment>();
  const currentTeamOf = new Map<string, Enrollment>();
  const prevSameTeam = new Set<string>(); // `${playerId}|${teamId}`
  const currentSameTeam = new Set<string>();
  for (const e of prev) {
    prevTeamOf.set(e.playerId, e);
    prevSameTeam.add(`${e.playerId}|${e.teamId}`);
  }
  for (const e of current) {
    currentTeamOf.set(e.playerId, e);
    currentSameTeam.add(`${e.playerId}|${e.teamId}`);
  }

  const seenAt = new Date().toISOString();
  const emit = async (
    direction: Direction,
    e: Enrollment,
    opts: {
      classYear: number | null;
      fromTeamId?: string | null;
      toTeamId?: string | null;
    },
  ) => {
    const sighting: MoveSighting = {
      sourceType: 'season_diff',
      ref: `season-diff:${prevSeason}->${currentSeason}`,
      by: 'season-diff',
      seenAt,
    };
    const up = await upsertMove({
      season: currentSeason,
      direction,
      playerName: e.playerName,
      playerId: e.playerId,
      teamId: e.teamId,
      teamSeo: e.teamSeo,
      fromTeamId: opts.fromTeamId ?? null,
      toTeamId: opts.toTeamId ?? null,
      classYear: opts.classYear,
      sourceType: 'season_diff',
      baseConfidence: 'confirmed',
      sighting,
    });
    applyOutcome(result, direction, up.outcome);
    if (up.outcome === 'error' && up.error) {
      result.errors.push(`${direction} ${e.playerName}: ${up.error}`);
    }
  };

  // Outgoing: on a prev roster, gone from that same team now.
  for (const e of prev) {
    if (currentSameTeam.has(`${e.playerId}|${e.teamId}`)) continue; // returning
    const elsewhere = currentTeamOf.get(e.playerId);
    if (elsewhere) {
      // Transferred to another NCAA school.
      await emit('transfer_out', e, {
        classYear: e.classYear,
        fromTeamId: e.teamId,
        toTeamId: elsewhere.teamId,
      });
    } else {
      // Left NCAA entirely. Seniors/grads are graduations (read-side owns).
      if (e.classYear !== null && SENIOR_OR_GRAD.has(e.classYear)) continue;
      await emit('departure', e, { classYear: e.classYear });
    }
  }

  // Incoming: on a new roster, new to that team.
  for (const e of current) {
    if (prevSameTeam.has(`${e.playerId}|${e.teamId}`)) continue; // returning
    const before = prevTeamOf.get(e.playerId);
    if (before) {
      // Transfer in from another NCAA school.
      await emit('transfer_in', e, {
        classYear: e.classYear,
        fromTeamId: before.teamId,
        toTeamId: e.teamId,
      });
    } else {
      // Brand-new to NCAA → commit.
      await emit('commit', e, { classYear: e.classYear, toTeamId: e.teamId });
    }
  }

  return result;
}

function applyOutcome(
  result: SeasonDiffResult,
  direction: Direction,
  outcome: UpsertOutcome,
): void {
  if (outcome === 'inserted') {
    result.inserted++;
    result.byDirection[direction]++;
  } else if (outcome === 'updated') {
    result.updated++;
    result.byDirection[direction]++;
  }
}
