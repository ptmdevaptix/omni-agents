import {
  fetchNeutralZone,
  commitYearForSeason,
} from './sources/neutral-zone';
import { resolveNcaaTeam, resolvePlayerId } from './resolve';
import { upsertMove } from './upsert';
import { currentMovesSeason } from './config';
import type { MoveSighting } from './types';

/**
 * Ingest Neutral Zone NCAA commitments into roster_moves for the current
 * season (by Commit Year). Destination anchors the move: rows whose school
 * isn't one of our D1 teams (D3/other) are skipped and counted — not written
 * as slugs — since the destination is the whole point of a commit.
 *
 * commit (junior/USHL/Europe origin) or transfer_in (NCAA origin). Shares the
 * commit_tracker source_type with THN (disambiguated by sighting.by), so a
 * commit both sources report collapses and corroborates.
 */

export interface ScanNzResult {
  season: string;
  commitYear: string | null;
  entriesForSeason: number;
  commits: number;
  transfersIn: number;
  inserted: number;
  updated: number;
  skippedNonD1: number;
  skippedSample: string[];
  errors: string[];
}

export async function scanNeutralZone(): Promise<ScanNzResult> {
  const season = currentMovesSeason();
  const commitYear = commitYearForSeason(season);
  const result: ScanNzResult = {
    season,
    commitYear,
    entriesForSeason: 0,
    commits: 0,
    transfersIn: 0,
    inserted: 0,
    updated: 0,
    skippedNonD1: 0,
    skippedSample: [],
    errors: [],
  };
  if (!commitYear) {
    result.errors.push(`Cannot derive commit year from season "${season}"`);
    return result;
  }

  let all;
  try {
    all = await fetchNeutralZone();
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }

  const forSeason = all.filter((e) => e.commitYear === commitYear);
  result.entriesForSeason = forSeason.length;
  const skipped = new Set<string>();

  for (const e of forSeason) {
    try {
      const dest = await resolveNcaaTeam(e.destName);
      // Destination must be one of our D1 teams — otherwise out of scope.
      if (!dest?.teamId) {
        result.skippedNonD1++;
        skipped.add(e.destName);
        continue;
      }

      const [origin, playerId] = await Promise.all([
        resolveNcaaTeam(e.currentTeam),
        resolvePlayerId(e.playerName),
      ]);
      const isTransfer = Boolean(origin?.teamId);
      const direction = isTransfer ? 'transfer_in' : 'commit';
      if (isTransfer) result.transfersIn++;
      else result.commits++;

      const sighting: MoveSighting = {
        sourceType: 'commit_tracker',
        ref: `neutral-zone:${e.playerName}|${dest.teamSeo}`,
        by: 'neutral_zone',
        note: isTransfer
          ? undefined
          : `from ${e.currentTeam}${e.league ? ` (${e.league})` : ''}`,
        seenAt: e.dateReported
          ? `${e.dateReported}T00:00:00Z`
          : new Date().toISOString(),
      };

      const up = await upsertMove({
        season,
        direction,
        playerName: e.playerName,
        playerId,
        teamId: dest.teamId,
        teamSeo: dest.teamSeo,
        fromTeamId: isTransfer ? origin!.teamId : null,
        toTeamId: dest.teamId,
        position: e.position,
        sourceType: 'commit_tracker',
        baseConfidence: 'reported',
        sighting,
      });

      if (up.outcome === 'inserted') result.inserted++;
      else if (up.outcome === 'updated') result.updated++;
      if (up.outcome === 'error' && up.error) {
        result.errors.push(`${up.dedupKey}: ${up.error}`);
      }
    } catch (err) {
      result.errors.push(
        `${e.playerName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  result.skippedSample = [...skipped].sort().slice(0, 15);
  return result;
}
