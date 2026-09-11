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

  const items = candidates
    .map((c) => ({ ...c, verdict: verdictByKey.get(c.dedup_key) ?? null }))
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

/** Undo a verdict — the pair returns to the queue on the detector's next run. */
export async function DELETE(request: NextRequest) {
  const dedupKey = new URL(request.url).searchParams.get('dedupKey');
  if (!dedupKey) return Response.json({ error: 'dedupKey required' }, { status: 400 });

  const { error } = await supabase.from('player_merge_verdicts').delete().eq('dedup_key', dedupKey);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true });
}
