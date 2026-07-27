import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchAll, type Rangeable } from '@/lib/roster-moves/db';

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
  missing_fields: string[] | null;
  prior_team: string | null;
  prior_league: string | null;
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

/** Parse 'roster_gap:{seo}:{normName}:{reason}' (or legacy 'player_research:{seo}:{norm}'). */
function parseKey(key: string): { seo: string; norm: string } {
  const parts = key.split(':');
  return { seo: parts[1] ?? '', norm: parts[2] ?? '' };
}

export async function GET() {
  // Candidates exceed PostgREST's 1000-row cap (~1.7k live) — page through all.
  const [candidates, states, bioOverrides, aliasesRes, suppsRes] = await Promise.all([
    fetchAll<CandidateRow>(
      () =>
        supabase
          .from('research_candidates')
          .select('*')
          .order('priority', { ascending: true })
          .order('player_name', { ascending: true }) as unknown as Rangeable<CandidateRow>,
    ),
    fetchAll<StateRow>(
      () => supabase.from('research_task_state').select('*') as unknown as Rangeable<StateRow>,
    ),
    fetchAll<Record<string, unknown>>(
      () => supabase.from('player_bio_overrides').select('*') as unknown as Rangeable<Record<string, unknown>>,
    ),
    supabase.from('player_aliases').select('*', { count: 'exact', head: true }),
    supabase.from('ncaa_suppressions').select('*', { count: 'exact', head: true }),
  ]);
  const stateByKey = new Map(states.map((s) => [s.dedup_key, s]));

  // Saved bio overrides keyed by player_norm + seo (team-scoped) and a global
  // (seo=null) fallback, so the resolve dialog can prefill what was saved.
  const bioByKey = new Map<string, Record<string, unknown>>();
  for (const o of bioOverrides) {
    if (o.active === false) continue;
    bioByKey.set(`${o.player_norm}::${o.seo ?? ''}`, o);
  }
  const bioFor = (norm: string, seo: string) =>
    bioByKey.get(`${norm}::${seo}`) ?? bioByKey.get(`${norm}::`) ?? null;

  const items = candidates.map((c) => {
    const state = stateByKey.get(c.dedup_key) ?? null;
    stateByKey.delete(c.dedup_key);
    return { ...c, state, bio_override: bioFor(c.norm_name, c.seo), orphaned: false };
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
      missing_fields: null,
      prior_team: null,
      prior_league: null,
      nhl_candidates: [],
      hints: {},
      detected_at: s.updated_at,
      state: s,
      bio_override: null,
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
