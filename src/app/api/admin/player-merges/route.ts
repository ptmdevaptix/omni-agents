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
  jersey_number: number | null;
  teams: { place_name: string | null; nickname: string | null } | null;
}

/**
 * A jersey in the 100s or 200s is a camp/tryout NUMBER. That is all it says.
 *
 * Worth surfacing, because it explains discrepancies that otherwise look like bad data: Jac Carli
 * appears on La Ronge's 2025 roster at #123 while Elite Prospects has him with Castlegar that season
 * — he attended the camp, did not stick, and played elsewhere.
 *
 * But it does NOT mean the player was only a camp invitee. Jack Johnson wears #129 on our Navan Grads
 * row and went on to play 44 games for that club. The number is a fact about the roster we captured;
 * his status is an inference we cannot make from it, so the label describes the number and stops
 * there.
 */
const CAMP_JERSEY = 100;

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
      .select('player_id, start_date, jersey_number, teams(place_name, nickname)')
      .in('player_id', playerIds.slice(i, i + 100));
    // Supporting detail, not the decision itself — a failure here should not empty the queue.
    if (error || !data) continue;

    for (const row of data as unknown as TeamPlayerRow[]) {
      const club = [row.teams?.place_name, row.teams?.nickname].filter(Boolean).join(' ');
      if (!club) continue;
      const season = row.start_date ? row.start_date.slice(0, 4) : '?';
      const camp = row.jersey_number != null && row.jersey_number >= CAMP_JERSEY;
      const num = row.jersey_number != null ? ` #${row.jersey_number}` : '';
      const label = `${club} ${season}${num}${camp ? ' (camp number)' : ''}`;
      const list = byPlayer.get(row.player_id) ?? [];
      if (!list.includes(label)) list.push(label);
      byPlayer.set(row.player_id, list);
    }
  }
  for (const list of byPlayer.values()) list.sort();
  return byPlayer;
}

/**
 * Hometown per player, read live for the same reason team history is: the feed is a nightly snapshot
 * and a reviewer should see the row as it stands now, including any correction typed on this page.
 *
 * It earns its place — Ryan Miller's two rows read "Medicine Hat, AB, CAN" and "Medicine Hat, AB",
 * which settles the pair on sight, and the card was not showing it.
 */
async function originsFor(playerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < playerIds.length; i += 100) {
    const { data, error } = await supabase
      .from('players')
      .select('id, origin, origin_country')
      .in('id', playerIds.slice(i, i + 100));
    if (error || !data) continue;
    for (const p of data as { id: string; origin: string | null; origin_country: string | null }[]) {
      // Country only when it adds something the town string does not already carry.
      const parts = [p.origin, p.origin_country].filter(Boolean) as string[];
      const label = parts.length === 2 && parts[0].toUpperCase().includes(parts[1].toUpperCase())
        ? parts[0] : parts.join(', ');
      if (label) out.set(p.id, label);
    }
  }
  return out;
}

/**
 * Player search, for merging a pair the detector never proposed.
 *
 * The bands reject some pairs outright — conflicting position families, conflicting birth dates — and
 * that is right at scale but leaves no way to overrule a rule when a human knows better. Jack Johnson
 * is the case: three rows, and the two carrying positions (D and F) are disqualified against each
 * other, so no amount of judging the offered pairs will ever surface them together.
 *
 * Rules handle volume; this handles the exceptions.
 */
const fold = (s?: string | null) =>
  (s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * How well a row matches what was typed, lower being better.
 *
 * Without this, searching "Ryan Lin" returned forty rows and not one of them was Ryan Lin: every
 * word is matched as a substring, so "Lin" pulls in Collins, Lindgren and Bolin, and an arbitrary
 * forty of those came back in whatever order the database chose. The player you are looking for has
 * to be at the top, or a manual merge is impossible for anyone whose surname is short.
 */
function searchRank(row: { first_name: string | null; last_name: string | null }, term: string): number {
  const q = fold(term);
  const first = fold(row.first_name), last = fold(row.last_name);
  const full = `${first} ${last}`.trim();
  if (full === q) return 0;
  if (last === q) return 1;
  if (q.includes(' ')) {
    const [qf, ...rest] = q.split(/\s+/);
    const ql = rest.join(' ');
    if (first.startsWith(qf) && last === ql) return 2;
    if (first.startsWith(qf) && last.startsWith(ql)) return 3;
  }
  if (last.startsWith(q)) return 4;
  if (first === q || first.startsWith(q)) return 5;
  if (last.includes(q) || first.includes(q)) return 6;
  return 7;
}

async function searchPlayers(q: string) {
  const term = q.trim();
  if (term.length < 2) return [];

  // Match either name part, so "johnson" and "jack johnson" both work.
  const words = term.split(/\s+/).filter(Boolean);
  const ors = words.flatMap((w) => [`first_name.ilike.%${w}%`, `last_name.ilike.%${w}%`]).join(',');

  // Fetched wide and ranked here, then trimmed. The limit used to be applied by the DATABASE, which
  // meant the cut was made before anything knew which rows were relevant.
  const { data, error } = await supabase
    .from('players')
    .select('id, slug, first_name, last_name, birth_date, position, origin, external_ids')
    .is('merged_into', null)          // a tombstone is already merged; offering it would be a loop
    .or(ors)
    .limit(400);
  if (error || !data) return [];

  type Row = {
    id: string; slug: string | null; first_name: string | null; last_name: string | null;
    birth_date: string | null; position: string | null; origin: string | null;
    external_ids: Record<string, unknown> | null;
  };
  // Rank first, THEN trim — and keep exact-name matches together at the top, which is what makes
  // two rows for one player visible side by side instead of pages apart.
  const ranked = (data as Row[])
    .sort((a, b) =>
      searchRank(a, term) - searchRank(b, term)
      || `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`))
    .slice(0, 40);

  const ids = ranked.map((p) => p.id);
  const teams = await teamsFor(ids);

  return ranked.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: [p.first_name, p.last_name].filter(Boolean).join(' '),
    birth_date: p.birth_date,
    position: p.position,
    origin: p.origin,
    source: Object.keys(p.external_ids ?? {}).sort().join('+') || 'no external id',
    teams: teams.get(p.id) ?? [],
  }));
}

/**
 * NHL affiliation per player: the club that holds him, and how.
 *
 * Without this the card shows "none recorded" for an NHL-sourced row, because team_players only
 * holds LEAGUE roster memberships and an NHL row has none. Technically true and badly misleading —
 * Evan Jardine reads as having no team while being a Columbus pick (2026, 121st). For a reviewer
 * deciding whether two rows are one player, "held by CBJ" is among the most useful facts available.
 *
 * Queried separately from the hometown lookup on purpose: these columns arrive with a migration that
 * may not have run yet, and folding them into that select would take the hometown down with them.
 */
async function nhlAffiliationFor(playerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < playerIds.length; i += 100) {
    const { data, error } = await supabase
      .from('players')
      .select('id, nhl_team, draft_year, draft_round, draft_overall, draft_team')
      .in('id', playerIds.slice(i, i + 100));
    if (error || !data) continue;   // pre-migration, or a transient failure: show nothing, break nothing

    for (const p of data as {
      id: string; nhl_team: string | null; draft_year: number | null;
      draft_round: number | null; draft_overall: number | null; draft_team: string | null;
    }[]) {
      // Two separate facts, stated separately. Who drafted him never changes; who holds his rights
      // does, and they are often different clubs — Calum Ritchie was Colorado's pick and is New
      // York's player. Collapsing them into one phrase loses whichever half is currently true.
      const parts: string[] = [];
      if (p.draft_year) {
        const bits = [p.draft_year, p.draft_round ? `round ${p.draft_round}` : null,
                      p.draft_overall ? `pick ${p.draft_overall}` : null].filter(Boolean);
        parts.push(`drafted by ${p.draft_team ?? '?'} (${bits.join(', ')})`);
      }
      if (p.nhl_team) parts.push(`rights held by ${p.nhl_team}`);
      if (parts.length) out.set(p.id, parts.join(' · '));
    }
  }
  return out;
}

/**
 * Where a player was read from, when we could not link the club.
 *
 * Its OWN query, on purpose. `unlinked_club` arrives with a migration that may not have run yet, and
 * PostgREST fails the whole select on an unknown column — so folding this into the hometown lookup
 * would take hometown down with it on every card until the migration landed. Separate, a missing
 * column costs only this line.
 */
async function unlinkedClubFor(playerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < playerIds.length; i += 100) {
    const { data, error } = await supabase
      .from('players')
      .select('id, unlinked_club')
      .in('id', playerIds.slice(i, i + 100));
    if (error || !data) continue;   // pre-migration: show nothing, break nothing
    for (const p of data as { id: string; unlinked_club: string | null }[]) {
      if (p.unlinked_club) out.set(p.id, p.unlinked_club);
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  // Search mode — used by the manual-merge panel, not the queue.
  const q = new URL(request.url).searchParams.get('q');
  if (q !== null) return Response.json({ results: await searchPlayers(q) });

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

  const ids = [...new Set(candidates.flatMap((c) => [c.player_a, c.player_b]))];
  const [teams, origins, nhl, unlinked] = await Promise.all([
    teamsFor(ids), originsFor(ids), nhlAffiliationFor(ids), unlinkedClubFor(ids),
  ]);

  const items = candidates
    .map((c) => ({
      ...c,
      verdict: verdictByKey.get(c.dedup_key) ?? null,
      // A club we could not link is appended to the roster list, tagged, so the card shows where the
      // player was read from instead of claiming he has no history.
      teams_a: [...(teams.get(c.player_a) ?? []),
                ...(unlinked.has(c.player_a) ? [`${unlinked.get(c.player_a)} — club not in our data`] : [])],
      teams_b: [...(teams.get(c.player_b) ?? []),
                ...(unlinked.has(c.player_b) ? [`${unlinked.get(c.player_b)} — club not in our data`] : [])],
      origin_a: origins.get(c.player_a) ?? null,
      origin_b: origins.get(c.player_b) ?? null,
      nhl_a: nhl.get(c.player_a) ?? null,
      nhl_b: nhl.get(c.player_b) ?? null,
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
