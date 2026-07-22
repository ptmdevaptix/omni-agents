import { fetchCommitments } from './sources/thn-commitments';
import { resolveNcaaTeam, resolvePlayerId } from './resolve';
import { upsertMove } from './upsert';
import { currentMovesSeason } from './config';
import type { MoveSighting } from './types';

/**
 * Ingest the THN NCAA commitments tracker into roster_moves.
 *
 * Each entry → a commit (origin is a junior/USHL/Europe club) or a transfer_in
 * (origin is another NCAA D1 school). Deterministic parse, idempotent upsert.
 * A transfer_in here shares its dedup_key with the portal's transfer_in for the
 * same player+school, so the two sources corroborate (confidence bump).
 *
 * Confidence is `reported` (single source); corroboration/season-diff upgrade it.
 */

export interface ScanCommitmentsResult {
  lastModified: string | null;
  entries: number;
  commits: number;
  transfersIn: number;
  inserted: number;
  updated: number;
  unresolvedDestinations: string[];
  errors: string[];
}

export async function scanCommitments(): Promise<ScanCommitmentsResult> {
  const season = currentMovesSeason();
  const result: ScanCommitmentsResult = {
    lastModified: null,
    entries: 0,
    commits: 0,
    transfersIn: 0,
    inserted: 0,
    updated: 0,
    unresolvedDestinations: [],
    errors: [],
  };

  let doc;
  try {
    doc = await fetchCommitments();
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
  result.lastModified = doc.lastModified;
  result.entries = doc.entries.length;
  const seenAt = doc.lastModified ?? new Date().toISOString();
  const unresolvedDest = new Set<string>();

  for (const entry of doc.entries) {
    try {
      const [prev, playerId] = await Promise.all([
        resolveNcaaTeam(entry.prevTeamName),
        resolvePlayerId(entry.playerName),
      ]);

      // NCAA-D1 origin ⇒ transfer_in; anything else ⇒ commit.
      const isTransfer = Boolean(prev?.teamId);
      const direction = isTransfer ? 'transfer_in' : 'commit';
      if (isTransfer) result.transfersIn++;
      else result.commits++;
      if (!entry.destTeam.teamId) unresolvedDest.add(entry.destTeamName);

      const sighting: MoveSighting = {
        sourceType: 'commit_tracker',
        ref: entry.sourceUrl ?? `thn:${entry.playerName}|${entry.destTeam.teamSeo}`,
        by: 'thn_tracker',
        note: isTransfer ? undefined : `from ${entry.prevTeamName}`,
        seenAt,
      };

      const up = await upsertMove({
        season,
        direction,
        playerName: entry.playerName,
        playerId,
        teamId: entry.destTeam.teamId,
        teamSeo: entry.destTeam.teamSeo,
        fromTeamId: isTransfer ? prev!.teamId : null,
        toTeamId: entry.destTeam.teamId,
        position: entry.position,
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
        `${entry.playerName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  result.unresolvedDestinations = [...unresolvedDest].sort();
  return result;
}
