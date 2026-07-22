import {
  fetchPortalEntries,
  portalDateToIso,
  isProDestination,
  type PortalEntry,
} from './sources/gpl-portal';
import { resolveNcaaTeam, resolvePlayerId } from './resolve';
import { upsertMove, type UpsertOutcome } from './upsert';
import { currentMovesSeason } from './config';
import type { MoveSighting } from './types';

/**
 * Ingest the GopherPuckLive D1 men transfer portal into roster_moves.
 *
 * Each entry → a transfer_out from the origin school; when a destination is
 * committed, also a transfer_in to that school. Deterministic (no LLM) and
 * idempotent via dedup_key, so it's safe to run on a schedule.
 *
 * Confidence is `reported`: the portal is a single (strong) source. It gets
 * upgraded to corroborated/confirmed when X or the season-diff agree.
 */

export interface ScanPortalResult {
  lastUpdated: string | null;
  entries: number;
  movesEmitted: number;
  inserted: number;
  updated: number;
  unresolvedOrigins: string[];
  errors: string[];
}

function sightingFor(entry: PortalEntry, extraNote?: string): MoveSighting {
  const notes: string[] = [];
  if (entry.gradTransfer) notes.push('grad transfer');
  if (entry.eligibilityYears) notes.push(`${entry.eligibilityYears} yr elig`);
  if (entry.noContact) notes.push('no-contact');
  if (extraNote) notes.push(extraNote);
  return {
    sourceType: 'portal',
    ref: `gpl-portal:${entry.urlText || entry.name}`,
    by: 'gpl_portal',
    note: notes.join('; ') || undefined,
    seenAt: portalDateToIso(entry.date) ?? new Date().toISOString(),
  };
}

export async function scanPortal(): Promise<ScanPortalResult> {
  const season = currentMovesSeason();
  const result: ScanPortalResult = {
    lastUpdated: null,
    entries: 0,
    movesEmitted: 0,
    inserted: 0,
    updated: 0,
    unresolvedOrigins: [],
    errors: [],
  };

  let fetched;
  try {
    fetched = await fetchPortalEntries();
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
  result.lastUpdated = fetched.lastUpdated;
  result.entries = fetched.entries.length;

  const unresolved = new Set<string>();

  for (const entry of fetched.entries) {
    try {
      const [origin, dest, playerId] = await Promise.all([
        resolveNcaaTeam(entry.school),
        entry.transferedTo ? resolveNcaaTeam(entry.transferedTo) : Promise.resolve(null),
        resolvePlayerId(entry.name),
      ]);
      if (!origin) continue;
      if (!origin.teamId) unresolved.add(entry.school);

      // A destination only counts as a transfer when it's a real NCAA team.
      // "SIGNED PRO (...)" is a pro signing; D3/USports/ACHA destinations are
      // out of scope — capture their text in the note but don't fabricate a
      // transfer_in to a school we don't track.
      const pro = isProDestination(entry.transferedTo);
      const realDest = dest?.teamId ? dest : null;
      const unlinkedDest =
        entry.transferedTo && !realDest && !pro ? entry.transferedTo : undefined;
      const extraNote = pro
        ? `signed pro: ${entry.transferedTo}`
        : unlinkedDest
          ? `to (untracked): ${unlinkedDest}`
          : undefined;
      const sighting = sightingFor(entry, extraNote);

      // Outbound: player leaving the origin school.
      result.movesEmitted++;
      const out = await upsertMove({
        season,
        direction: pro ? 'pro_signing' : 'transfer_out',
        playerName: entry.name,
        playerId,
        teamId: origin.teamId,
        teamSeo: origin.teamSeo,
        fromTeamId: origin.teamId,
        toTeamId: realDest?.teamId ?? null,
        position: entry.position,
        sourceType: 'portal',
        baseConfidence: 'reported',
        sighting,
      });
      tally(result, out.outcome);
      if (out.outcome === 'error' && out.error) {
        result.errors.push(`${out.dedupKey}: ${out.error}`);
      }

      // Inbound: only when the destination is a real NCAA team we track.
      if (realDest?.teamSeo) {
        result.movesEmitted++;
        const inbound = await upsertMove({
          season,
          direction: 'transfer_in',
          playerName: entry.name,
          playerId,
          teamId: realDest.teamId,
          teamSeo: realDest.teamSeo,
          fromTeamId: origin.teamId,
          toTeamId: realDest.teamId,
          position: entry.position,
          sourceType: 'portal',
          baseConfidence: 'reported',
          sighting,
        });
        tally(result, inbound.outcome);
        if (inbound.outcome === 'error' && inbound.error) {
          result.errors.push(`transfer_in ${entry.name}: ${inbound.error}`);
        }
      }
    } catch (err) {
      result.errors.push(
        `${entry.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  result.unresolvedOrigins = [...unresolved].sort();
  return result;
}

function tally(result: ScanPortalResult, outcome: UpsertOutcome): void {
  if (outcome === 'inserted') result.inserted++;
  else if (outcome === 'updated') result.updated++;
}
