import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchAll, type Rangeable } from '@/lib/roster-moves/db';

/**
 * Duplicate-player review — omni-agents owns the verdicts, omni-hockey owns the feed.
 * See omni-hockey/docs/design/player-identity-reconciliation.md.
 *
 * One player is one page across every league, but sources key players differently and share no id, so
 * the same human can end up as two rows. omni-hockey merges the unambiguous ones unattended (identical
 * name, exact birth date, same position family). Everything below that bar lands here, because 29% of
 * player rows carry no birth date at all and can never clear it — a judgement call, not a rule.
 *
 * GET   → player_merge_candidates (read-only feed) joined to player_merge_verdicts by dedup_key.
 * PATCH → upsert player_merge_verdicts. We never write the candidate feed; omni-hockey rebuilds it
 *         nightly and may delete freely, which is exactly why verdicts live in their own table.
 */

interface CandidateRow {
  dedup_key: string;
  band: string;
  player_a: string;
  player_b: string;
  name_a: string;
  name_b: string;
  birth_a: string | null;
  birth_b: string | null;
  position_a: string | null;
  position_b: string | null;
  source_a: string | null;
  source_b: string | null;
  signals: string[] | null;
  detected_at: string;
}

interface VerdictRow {
  dedup_key: string;
  verdict: string;
  reviewer: string | null;
  notes: string | null;
  name_a: string | null;
  name_b: string | null;
  updated_at: string;
}

// Most-confident first: HIGH is one step from acting on its own, so it deserves a reviewer's
// attention before a pile of fuzzy-name proposals does.
const BAND_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

interface TeamPlayerRow {
  player_id: string;
  start_date: string | null;
  teams: { place_name: string | null; nickname: string | null } | null;
}

/**
 * Roster history per player, for the two ids in each candidate.
 *
 * Read live rather than denormalised into the candidate feed: the feed is a nightly snapshot, and a
 * reviewer deciding whether two rows are one person should see the rosters as they are now, not as
 * they were when the pair was proposed.
 *
 * Season is always shown. A club without one is misleading — two players at the same school in
 * different years were never teammates, and that reads as shared history at a glance.
 */
async function teamsFor(playerIds: string[]): Promise<Map<string, string[]>> {
  const byPlayer = new Map<string, string[]>();
  if (!playerIds.length) return byPlayer;

  // Chunked: a candidate list can carry hundreds of ids, and `in` goes into the URL.
  for (let i = 0; i < playerIds.length; i += 100) {
    const { data, error } = await supabase
      .from('team_players')
      .select('player_id, start_date, teams(place_name, nickname)')
      .in('player_id', playerIds.slice(i, i + 100));
    // Supporting detail, not the decision itself — a failure here should not empty the queue.
    if (error || !data) continue;

    for (const row of data as unknown as TeamPlayerRow[]) {
      const club = [row.teams?.place_name, row.teams?.nickname].filter(Boolean).join(' ');
      if (!club) continue;
      const season = row.start_date ? row.start_date.slice(0, 4) : '?';
      const label = `${club} ${season}`;
      const list = byPlayer.get(row.player_id) ?? [];
      if (!list.includes(label)) list.push(label);
      byPlayer.set(row.player_id, list);
    }
  }
  for (const list of byPlayer.values()) list.sort();
  return byPlayer;
}

export async function GET() {
  const [candidates, verdicts] = await Promise.all([
    fetchAll<CandidateRow>(
      () =>
        supabase
          .from('player_merge_candidates')
          .select('*')
          .order('detected_at', { ascending: false }) as unknown as Rangeable<CandidateRow>,
    ),
    fetchAll<VerdictRow>(
      () => supabase.from('player_merge_verdicts').select('*') as unknown as Rangeable<VerdictRow>,
    ),
  ]);

  const verdictByKey = new Map(verdicts.map((v) => [v.dedup_key, v]));

  const teams = await teamsFor([
    ...new Set(candidates.flatMap((c) => [c.player_a, c.player_b])),
  ]);

  const items = candidates
    .map((c) => ({
      ...c,
      verdict: verdictByKey.get(c.dedup_key) ?? null,
      teams_a: teams.get(c.player_a) ?? [],
      teams_b: teams.get(c.player_b) ?? [],
    }))
    .sort((a, b) => (BAND_ORDER[a.band] ?? 9) - (BAND_ORDER[b.band] ?? 9));

  // A judged pair is dropped from the feed by the detector, so its verdict would otherwise vanish from
  // view entirely — including the mistakes. Surface them as history, which is also the only way to
  // find and undo a wrong call.
  const judged = verdicts
    .filter((v) => !candidates.some((c) => c.dedup_key === v.dedup_key))
    .map((v) => ({ ...v, orphaned: true }));

  return Response.json({
    items,
    judged,
    counts: {
      open: items.filter((i) => !i.verdict).length,
      high: items.filter((i) => i.band === 'HIGH' && !i.verdict).length,
      medium: items.filter((i) => i.band === 'MEDIUM' && !i.verdict).length,
      low: items.filter((i) => i.band === 'LOW' && !i.verdict).length,
      judged: verdicts.length,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { dedupKey, verdict, reviewer, notes, nameA, nameB } = body;

  if (!dedupKey) {
    return Response.json({ error: 'dedupKey required' }, { status: 400 });
  }
  // Guarded rather than trusted: an unrecognised verdict would be written, then silently ignored by
  // the detector's "already judged" check, and the pair would reappear every night with no clue why.
  if (!['duplicate', 'not_duplicate', 'unsure'].includes(verdict)) {
    return Response.json({ error: `unknown verdict: ${verdict}` }, { status: 400 });
  }

  const { error } = await supabase.from('player_merge_verdicts').upsert(
    {
      dedup_key: dedupKey,
      verdict,
      reviewer: reviewer || null,
      notes: notes || null,
      // Denormalised so the verdict still reads as something human after its candidate row is gone.
      name_a: nameA ?? null,
      name_b: nameB ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'dedup_key' },
  );

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ success: true });
}

// Fields a reviewer may correct. Mirrors omni-hockey's database/create_player_overrides.sql — adding
// one here without adding it there writes a column nothing ever reads.
const OVERRIDE_FIELDS = [
  'first_name', 'last_name', 'birth_date', 'position',
  'handedness', 'height_inches', 'weight_lbs', 'origin', 'origin_country',
] as const;

const NUMERIC = new Set(['height_inches', 'weight_lbs']);

/**
 * PUT — record a correction to a player's data.
 *
 * Written to player_overrides, NEVER to players. omni-hockey's seeders regenerate player rows and
 * would clobber a manual edit; it applies these on its next detector run instead
 * (research-queue-contract.md).
 *
 * The reason this exists on the dedup page rather than somewhere else: a missing birth date is what
 * keeps a pair out of the automatic band. Supplying one converts the next run's merge from "someone
 * clicked" to "the rule matched".
 */
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { playerId, fields, reviewer, note } = body ?? {};

  if (!playerId) return Response.json({ error: 'playerId required' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  for (const f of OVERRIDE_FIELDS) {
    const v = fields?.[f];
    // Empty means "no correction", not "blank it out" — the override table reads NULL as don't-touch,
    // and a blank field must never erase good data.
    if (v === undefined || v === null || String(v).trim() === '') continue;
    patch[f] = NUMERIC.has(f) ? Number(v) : String(v).trim();
  }
  if (!Object.keys(patch).length) {
    return Response.json({ error: 'no values to save' }, { status: 400 });
  }

  const { error } = await supabase.from('player_overrides').upsert(
    {
      player_id: playerId,
      ...patch,
      reviewer: reviewer || null,
      note: note || null,
      active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'player_id' },
  );

  if (error) return Response.json({ error: error.message }, { status: 400 });
  // Applied on omni-hockey's next detector run, not instantly — worth saying so the reviewer is not
  // left wondering why the card still shows the old value.
  return Response.json({ success: true, appliesOn: 'the next nightly detector run' });
}

/** Undo a verdict — the pair returns to the queue on the detector's next run. */
export async function DELETE(request: NextRequest) {
  const dedupKey = new URL(request.url).searchParams.get('dedupKey');
  if (!dedupKey) return Response.json({ error: 'dedupKey required' }, { status: 400 });

  const { error } = await supabase.from('player_merge_verdicts').delete().eq('dedup_key', dedupKey);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true });
}
