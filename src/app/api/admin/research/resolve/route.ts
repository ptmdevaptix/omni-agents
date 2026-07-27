import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchAll, type Rangeable } from '@/lib/roster-moves/db';
import { resolveAnyTeam } from '@/lib/roster-moves/resolve';

/**
 * Resolve a research item: write the durable override that applies the fix
 * (omni-hockey pipelines read these), then mark the task resolved with an
 * audit trail. See research-queue-contract.md §4 + addendum 2026-07-26b.
 *
 * kind:
 *   'alias'    → player_aliases       (link: nhl_id best, else canonical spelling)
 *   'bio'      → player_bio_overrides  (fill missing position/height/weight/birthdate/hometown)
 *   'suppress' → ncaa_suppressions     (remove player from roster + Changes)
 *                + best-effort flag of the matching incoming roster_moves as suppressed
 *   'note'     → no override — just record the resolution
 *
 * Some override tables land via omni-hockey's cutover (player_bio_overrides,
 * roster_moves.suppressed): writes to those fail gracefully until they exist.
 */

/** Replicates omni-hockey's normName so roster_moves rows match the feed's norm_name. */
function hockeyNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { dedupKey, kind } = body;
  if (!dedupKey || !kind) {
    return Response.json({ error: 'dedupKey and kind required' }, { status: 400 });
  }

  let resolution: Record<string, unknown>;

  if (kind === 'alias') {
    const { seo, nhlId, canonicalName, note } = body;
    // aliasNorm = this item's own spelling (Link); aliasName = one OR MORE
    // (comma-separated) other/duplicate spellings to merge into this player.
    const norms = body.aliasNorm
      ? [String(body.aliasNorm)]
      : [
          ...new Set(
            String(body.aliasName || '')
              .split(',')
              .map((s) => hockeyNorm(s))
              .filter(Boolean),
          ),
        ];
    if (norms.length === 0 || (!nhlId && !canonicalName)) {
      return Response.json(
        { error: 'alias needs a spelling and one of nhlId / canonicalName' },
        { status: 400 },
      );
    }
    const rows = norms.map((alias_norm) => ({
      alias_norm,
      seo: seo || null,
      nhl_id: nhlId || null,
      canonical_name: canonicalName || null,
      note: note || null,
      active: true,
    }));
    const { error } = await supabase.from('player_aliases').upsert(rows, { onConflict: 'alias_norm,seo' });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    resolution = { type: 'alias', alias_norms: norms, seo: seo || null, nhl_id: nhlId || null, canonical_name: canonicalName || null };
  } else if (kind === 'bio') {
    const { playerNorm, seo } = body;
    if (!playerNorm) {
      return Response.json({ error: 'bio needs playerNorm' }, { status: 400 });
    }
    // Only include fields the human actually supplied (partial fill/merge).
    const row: Record<string, unknown> = {
      player_norm: playerNorm,
      seo: seo || null,
      active: true,
      updated_at: new Date().toISOString(),
    };
    const map: Record<string, string> = {
      position: 'position',
      classYear: 'class_year',
      heightInches: 'height_inches',
      weightLbs: 'weight_lbs',
      birthDate: 'birth_date',
      hometown: 'hometown',
      originCountry: 'origin_country',
      priorTeam: 'prior_team',
      priorLeague: 'prior_league',
      nhlId: 'nhl_id',
      note: 'note',
    };
    const fields: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(map)) {
      if (body[k] !== undefined && body[k] !== '' && body[k] !== null) {
        row[col] = body[k];
        fields[col] = body[k];
      }
    }
    // Best-effort: if the prior team is one we know (NCAA or CHL/junior in our
    // DB), link it; unknown teams (BCHL/Euro) stay as free text only.
    let priorTeamMatch: string | null = null;
    if (typeof body.priorTeam === 'string' && body.priorTeam.trim()) {
      const t = await resolveAnyTeam(body.priorTeam);
      if (t) {
        row.prior_team_id = t.teamId;
        fields.prior_team_id = t.teamId;
        priorTeamMatch = t.placeName;
      }
    }

    // Cutover resilience: player_bio_overrides may not have every column yet
    // (class_year / prior_team*). Drop whichever column the DB reports missing
    // and retry, so the remaining fields still save.
    const missingColumn = (msg: string): string | null => {
      const m1 = msg.match(/Could not find the '([a-z_]+)' column/i);
      if (m1) return m1[1];
      const m2 = msg.match(/column ["']?[a-z_]*\.?([a-z_]+)["']? does not exist/i);
      return m2 ? m2[1] : null;
    };
    const deferred: string[] = [];
    let error = (await supabase.from('player_bio_overrides').upsert(row, { onConflict: 'player_norm,seo' })).error;
    for (let i = 0; error && i < 6; i++) {
      const col = missingColumn(error.message);
      if (!col || !(col in row)) break;
      delete row[col];
      delete fields[col];
      deferred.push(col);
      error = (await supabase.from('player_bio_overrides').upsert(row, { onConflict: 'player_norm,seo' })).error;
    }
    if (error) {
      return Response.json(
        { error: `${error.message} (player_bio_overrides may not exist yet — omni-hockey cutover)` },
        { status: 400 },
      );
    }
    resolution = {
      type: 'bio',
      player_norm: playerNorm,
      seo: seo || null,
      fields,
      ...(priorTeamMatch && { prior_team_matched: priorTeamMatch }),
      ...(deferred.length > 0 && { deferred_columns: deferred }),
    };
  } else if (kind === 'suppress') {
    const { seo, playerNorm, playerName, reason } = body;
    if (!seo || !playerNorm) {
      return Response.json({ error: 'suppress needs seo and playerNorm' }, { status: 400 });
    }
    const { error } = await supabase.from('ncaa_suppressions').upsert(
      { seo, player_norm: playerNorm, reason: reason || null, active: true },
      { onConflict: 'seo,player_norm' },
    );
    if (error) return Response.json({ error: error.message }, { status: 400 });

    // Best-effort: also flag the matching incoming move(s) as suppressed so the
    // Changes delta drops them. Non-fatal (column arrives via omni-hockey cutover).
    let movesFlagged = 0;
    try {
      const target = hockeyNorm(playerName || playerNorm);
      const moves = await fetchAll<{ id: number; player_name: string; direction: string }>(
        () =>
          supabase
            .from('roster_moves')
            .select('id, player_name, direction')
            .eq('team_seo', seo)
            .in('direction', ['commit', 'transfer_in']) as unknown as Rangeable<{
            id: number;
            player_name: string;
            direction: string;
          }>,
      );
      const ids = moves.filter((m) => hockeyNorm(m.player_name) === target).map((m) => m.id);
      if (ids.length > 0) {
        const { error: upErr } = await supabase
          .from('roster_moves')
          .update({ suppressed: true })
          .in('id', ids);
        if (!upErr) movesFlagged = ids.length;
      }
    } catch {
      // roster_moves.suppressed not present yet — ncaa_suppressions still hides them.
    }
    resolution = { type: 'suppress', seo, player_norm: playerNorm, reason: reason || null, moves_flagged: movesFlagged };
  } else if (kind === 'note') {
    resolution = { type: 'note', note: body.note || null };
  } else {
    return Response.json({ error: `unknown kind "${kind}"` }, { status: 400 });
  }

  // finalize=false → a partial "save": the override is written, but the item
  // stays in the queue (in_progress) until all data is in / it's approved.
  const finalize = body.finalize !== false;
  const now = new Date().toISOString();
  const statePatch: Record<string, unknown> = {
    dedup_key: dedupKey,
    status: finalize ? 'resolved' : 'in_progress',
    resolution,
    updated_at: now,
  };
  if (finalize) statePatch.resolved_at = now;

  const { error: stateErr } = await supabase
    .from('research_task_state')
    .upsert(statePatch, { onConflict: 'dedup_key' });
  if (stateErr) return Response.json({ error: stateErr.message }, { status: 400 });

  return Response.json({ success: true, resolution, finalized: finalize });
}
