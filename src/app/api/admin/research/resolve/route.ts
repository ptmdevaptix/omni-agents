import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * Resolve a research item: write the durable override that actually applies the
 * fix (omni-hockey pipelines read these), then mark the task resolved with an
 * audit trail. See research-queue-contract.md §4.
 *
 * kind:
 *   'alias'    → player_aliases  (nhl_id best, else canonical_name spelling)
 *   'suppress' → ncaa_suppressions (player not attending / left)
 *   'note'     → no override (e.g. missing_bio) — just record the resolution
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { dedupKey, kind } = body;
  if (!dedupKey || !kind) {
    return Response.json({ error: 'dedupKey and kind required' }, { status: 400 });
  }

  let resolution: Record<string, unknown>;

  if (kind === 'alias') {
    const { aliasNorm, seo, nhlId, canonicalName, note } = body;
    if (!aliasNorm || (!nhlId && !canonicalName)) {
      return Response.json(
        { error: 'alias needs aliasNorm and one of nhlId / canonicalName' },
        { status: 400 },
      );
    }
    const { error } = await supabase.from('player_aliases').upsert(
      {
        alias_norm: aliasNorm,
        seo: seo || null,
        nhl_id: nhlId || null,
        canonical_name: canonicalName || null,
        note: note || null,
        active: true,
      },
      { onConflict: 'alias_norm,seo' },
    );
    if (error) return Response.json({ error: error.message }, { status: 400 });
    resolution = { type: 'alias', alias_norm: aliasNorm, seo: seo || null, nhl_id: nhlId || null, canonical_name: canonicalName || null };
  } else if (kind === 'suppress') {
    const { seo, playerNorm, reason } = body;
    if (!seo || !playerNorm) {
      return Response.json({ error: 'suppress needs seo and playerNorm' }, { status: 400 });
    }
    const { error } = await supabase.from('ncaa_suppressions').upsert(
      { seo, player_norm: playerNorm, reason: reason || null, active: true },
      { onConflict: 'seo,player_norm' },
    );
    if (error) return Response.json({ error: error.message }, { status: 400 });
    resolution = { type: 'suppress', seo, player_norm: playerNorm, reason: reason || null };
  } else if (kind === 'note') {
    resolution = { type: 'note', note: body.note || null };
  } else {
    return Response.json({ error: `unknown kind "${kind}"` }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error: stateErr } = await supabase.from('research_task_state').upsert(
    {
      dedup_key: dedupKey,
      status: 'resolved',
      resolution,
      resolved_at: now,
      updated_at: now,
    },
    { onConflict: 'dedup_key' },
  );
  if (stateErr) return Response.json({ error: stateErr.message }, { status: 400 });

  return Response.json({ success: true, resolution });
}
