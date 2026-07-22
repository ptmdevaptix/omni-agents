import { supabase } from '../supabase';
import { dedupKey } from './normalize';
import { seasonStartDate } from './config';
import type { Confidence, Direction, MoveSighting, SourceType } from './types';

/**
 * Upsert a single roster move keyed on dedup_key (contract §3).
 *
 * The same move seen across many tweets/sources collapses to one row: on a
 * repeat sighting we append to raw.sources and bump confidence rather than
 * inserting a duplicate. Scans are serialized (GitHub Actions concurrency
 * group), so a read-modify-write is safe here.
 */

const CONFIDENCE_RANK: Record<Confidence, number> = {
  reported: 0,
  corroborated: 1,
  confirmed: 2,
};

function maxConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b;
}

export interface UpsertMoveInput {
  season: string;
  direction: Direction;
  playerName: string;
  playerId: string | null;
  teamId: string | null;
  teamSeo: string;
  fromTeamId?: string | null;
  toTeamId?: string | null;
  position?: string | null;
  classYear?: number | null;
  sourceType: SourceType;
  /** Confidence this source asserts on its own (season_diff → confirmed). */
  baseConfidence: Confidence;
  sighting: MoveSighting;
}

export type UpsertOutcome = 'inserted' | 'updated' | 'unchanged' | 'error';

export interface UpsertResult {
  outcome: UpsertOutcome;
  dedupKey: string;
  confidence?: Confidence;
  error?: string;
}

interface RawPayload {
  sources?: MoveSighting[];
  [k: string]: unknown;
}

/** Count distinct reporters/sources to decide corroboration. */
function distinctSourceCount(sources: MoveSighting[]): number {
  return new Set(sources.map((s) => s.by ?? s.ref)).size;
}

export async function upsertMove(
  input: UpsertMoveInput,
): Promise<UpsertResult> {
  const key = dedupKey({
    season: input.season,
    direction: input.direction,
    playerName: input.playerName,
    teamSeo: input.teamSeo,
  });

  const { data: existing, error: selErr } = await supabase
    .from('roster_moves')
    .select('id, confidence, player_id, team_id, raw')
    .eq('dedup_key', key)
    .maybeSingle();

  if (selErr) {
    return { outcome: 'error', dedupKey: key, error: selErr.message };
  }

  if (!existing) {
    const { error: insErr } = await supabase.from('roster_moves').insert({
      season: input.season,
      direction: input.direction,
      player_name: input.playerName,
      player_id: input.playerId,
      team_id: input.teamId,
      team_seo: input.teamSeo,
      from_team_id: input.fromTeamId ?? null,
      to_team_id: input.toTeamId ?? null,
      position: input.position ?? null,
      class_year: input.classYear ?? null,
      confidence: input.baseConfidence,
      source_type: input.sourceType,
      effective_season_start: seasonStartDate(input.season),
      raw: { sources: [input.sighting] } satisfies RawPayload,
      dedup_key: key,
    });
    if (insErr) {
      return { outcome: 'error', dedupKey: key, error: insErr.message };
    }
    return { outcome: 'inserted', dedupKey: key, confidence: input.baseConfidence };
  }

  // Merge into the existing row.
  const raw = (existing.raw as RawPayload | null) ?? {};
  const sources = Array.isArray(raw.sources) ? [...raw.sources] : [];
  const alreadySeen = sources.some((s) => s.ref === input.sighting.ref);
  if (!alreadySeen) sources.push(input.sighting);

  const current = existing.confidence as Confidence;
  let next = maxConfidence(current, input.baseConfidence);
  // Multiple independent reporters => corroborated (never downgrades confirmed).
  if (distinctSourceCount(sources) >= 2) {
    next = maxConfidence(next, 'corroborated');
  }

  const patch: Record<string, unknown> = {
    raw: { ...raw, sources },
    confidence: next,
    updated_at: new Date().toISOString(),
  };
  // Backfill resolved ids if we now know them.
  if (!existing.player_id && input.playerId) patch.player_id = input.playerId;
  if (!existing.team_id && input.teamId) patch.team_id = input.teamId;

  const nothingChanged =
    alreadySeen && next === current && !patch.player_id && !patch.team_id;
  if (nothingChanged) {
    return { outcome: 'unchanged', dedupKey: key, confidence: current };
  }

  const { error: updErr } = await supabase
    .from('roster_moves')
    .update(patch)
    .eq('id', existing.id);

  if (updErr) {
    return { outcome: 'error', dedupKey: key, error: updErr.message };
  }
  return { outcome: 'updated', dedupKey: key, confidence: next };
}
