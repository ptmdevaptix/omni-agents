import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * Research queue — omni-agents owns the management UI + workflow state.
 * See omni-hockey/docs/design/research-queue-contract.md.
 *
 * GET  → research_candidates (read-only feed, omni-hockey writes) merged with
 *        research_task_state (our workflow state) by dedup_key. Includes
 *        "orphaned" state rows whose candidate disappeared from the feed
 *        (auto-resolved upstream — shown, not hidden).
 * PATCH → upsert research_task_state (status / assignee / notes).
 */

interface CandidateRow {
  dedup_key: string;
  reason: string;
  priority: number;
  seo: string;
  team_name: string | null;
  player_name: string;
  norm_name: string;
  season: string;
  source: string;
  position: string | null;
  class_year: number | null;
  nhl_candidates: unknown;
  hints: unknown;
  detected_at: string;
}

interface StateRow {
  dedup_key: string;
  status: string;
  assignee: string | null;
  notes: string | null;
  resolution: unknown;
  updated_at: string;
  resolved_at: string | null;
}

/** Parse 'player_research:{seo}:{normName}' for display of orphaned state rows. */
function parseKey(key: string): { seo: string; norm: string } {
  const parts = key.split(':');
  return { seo: parts[1] ?? '', norm: parts.slice(2).join(':') };
}

export async function GET() {
  const [candsRes, statesRes, aliasesRes, suppsRes] = await Promise.all([
    supabase
      .from('research_candidates')
      .select('*')
      .order('priority', { ascending: true })
      .order('player_name', { ascending: true }),
    supabase.from('research_task_state').select('*'),
    supabase.from('player_aliases').select('*', { count: 'exact', head: true }),
    supabase.from('ncaa_suppressions').select('*', { count: 'exact', head: true }),
  ]);

  if (candsRes.error) {
    return Response.json({ error: candsRes.error.message }, { status: 500 });
  }

  const candidates = (candsRes.data ?? []) as CandidateRow[];
  const states = (statesRes.data ?? []) as StateRow[];
  const stateByKey = new Map(states.map((s) => [s.dedup_key, s]));

  const items = candidates.map((c) => {
    const state = stateByKey.get(c.dedup_key) ?? null;
    stateByKey.delete(c.dedup_key);
    return { ...c, state, orphaned: false };
  });

  // Remaining state rows have no candidate → auto-resolved upstream. Surface them.
  for (const s of stateByKey.values()) {
    const { seo, norm } = parseKey(s.dedup_key);
    items.push({
      dedup_key: s.dedup_key,
      reason: 'resolved_upstream',
      priority: 9,
      seo,
      team_name: null,
      player_name: norm,
      norm_name: norm,
      season: '',
      source: '',
      position: null,
      class_year: null,
      nhl_candidates: [],
      hints: {},
      detected_at: s.updated_at,
      state: s,
      orphaned: true,
    });
  }

  const reasons = [...new Set(candidates.map((c) => c.reason))].sort();
  const seos = [...new Set(candidates.map((c) => c.seo))].sort();

  return Response.json({
    items,
    reasons,
    seos,
    counts: {
      candidates: candidates.length,
      open: items.filter(
        (i) => !i.orphaned && (!i.state || ['open', 'in_progress'].includes(i.state.status)),
      ).length,
      aliases: aliasesRes.count ?? 0,
      suppressions: suppsRes.count ?? 0,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { dedupKey, status, assignee, notes } = body;
  if (!dedupKey) {
    return Response.json({ error: 'dedupKey required' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { dedup_key: dedupKey, updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (assignee !== undefined) patch.assignee = assignee || null;
  if (notes !== undefined) patch.notes = notes || null;

  const { error } = await supabase
    .from('research_task_state')
    .upsert(patch, { onConflict: 'dedup_key' });

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ success: true });
}
