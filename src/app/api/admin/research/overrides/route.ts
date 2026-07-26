import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * Manage the durable override tables directly (view / toggle active / add
 * manual entries), independent of the queue. omni-hockey reads these:
 *   player_aliases     → the NHL-id resolver
 *   ncaa_suppressions  → roster + Changes routes
 */

export async function GET() {
  const [aliases, suppressions] = await Promise.all([
    supabase.from('player_aliases').select('*').order('id', { ascending: false }),
    supabase.from('ncaa_suppressions').select('*').order('id', { ascending: false }),
  ]);
  if (aliases.error) return Response.json({ error: aliases.error.message }, { status: 500 });
  if (suppressions.error) return Response.json({ error: suppressions.error.message }, { status: 500 });
  return Response.json({ aliases: aliases.data ?? [], suppressions: suppressions.data ?? [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { table } = body;

  if (table === 'player_aliases') {
    const { error } = await supabase.from('player_aliases').upsert(
      {
        alias_norm: body.aliasNorm,
        seo: body.seo || null,
        nhl_id: body.nhlId || null,
        canonical_name: body.canonicalName || null,
        note: body.note || null,
        active: true,
      },
      { onConflict: 'alias_norm,seo' },
    );
    if (error) return Response.json({ error: error.message }, { status: 400 });
  } else if (table === 'ncaa_suppressions') {
    const { error } = await supabase.from('ncaa_suppressions').upsert(
      { seo: body.seo, player_norm: body.playerNorm, reason: body.reason || null, active: true },
      { onConflict: 'seo,player_norm' },
    );
    if (error) return Response.json({ error: error.message }, { status: 400 });
  } else {
    return Response.json({ error: 'unknown table' }, { status: 400 });
  }
  return Response.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { table, id, active } = body;
  if (!['player_aliases', 'ncaa_suppressions'].includes(table) || id === undefined) {
    return Response.json({ error: 'table and id required' }, { status: 400 });
  }
  const { error } = await supabase.from(table).update({ active }).eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true });
}
