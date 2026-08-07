import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  planOpenerTargets,
  regenerateOpener,
  regenerateGameForRow,
} from '@/lib/content/nhl-preview';

/**
 * Regenerate game-preview content (used after tweaking prompts).
 *   GET               → the "regenerate all" work list (one entry per unique game).
 *   POST { target }   → regenerate that team's opener (used by the batch loop).
 *   POST { id }       → regenerate one existing content row in place.
 * The client drives the batch (one POST per entry) so it can show progress.
 */

export const maxDuration = 60;

export async function GET() {
  const plan = await planOpenerTargets();
  return Response.json({ plan });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { target?: string; id?: number };

  if (typeof body.target === 'string' && body.target) {
    try {
      const r = await regenerateOpener(body.target.toUpperCase());
      return Response.json({ ok: true, ...r });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  if (typeof body.id === 'number') {
    const { data: row } = await supabase
      .from('generated_content')
      .select('subject_id, data')
      .eq('id', body.id)
      .maybeSingle();
    if (!row) return Response.json({ error: 'row not found' }, { status: 404 });

    const gameId = Number(String(row.subject_id ?? '').replace(/^nhl-/, ''));
    const d = row.data as { home?: { abbr?: string }; away?: { abbr?: string } };
    const home = d?.home?.abbr ?? '';
    const away = d?.away?.abbr ?? '';
    if (!gameId || (!home && !away)) {
      return Response.json({ error: 'row is missing game/team info to regenerate' }, { status: 400 });
    }
    try {
      const r = await regenerateGameForRow(gameId, home, away);
      return Response.json({ ok: true, ...r });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  return Response.json({ error: 'target or id required' }, { status: 400 });
}
