import { generateText, Output, gateway } from 'ai';
import { z } from 'zod';
import { supabase } from '../supabase';
import { loadSystemPrompt } from './prompts';

/**
 * NHL game-preview generator. Pulls grounded facts from the public NHL API
 * (schedule + last-season results) and has the model write an opener preview
 * from ONLY those facts, then upserts into generated_content as `new` for
 * human review. Context sourcing is deliberately conservative — we don't feed
 * the noisy team-tagged articles, so the model can't invent players/injuries.
 */

export const PREVIEW_MODEL = 'anthropic/claude-sonnet-5';
const PROMPT_VERSION = 'nhl-preview-v1';
const NHL = 'https://api-web.nhle.com';

interface SchedTeam {
  abbrev: string;
  commonName?: { default: string };
  placeName?: { default: string };
  score?: number;
}
interface SchedGame {
  id: number;
  gameType: number; // 1 preseason, 2 regular, 3 playoffs
  gameDate: string;
  startTimeUTC?: string;
  venue?: { default: string };
  tvBroadcasts?: { network: string }[];
  gameState?: string; // FINAL | OFF | FUT | ...
  gameOutcome?: { lastPeriodType?: string };
  awayTeam: SchedTeam;
  homeTeam: SchedTeam;
}

async function nhlGet<T>(path: string): Promise<T> {
  const res = await fetch(`${NHL}${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OmniAgents/1.0; +https://github.com)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`NHL API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

const teamName = (t: SchedTeam) =>
  [t.placeName?.default, t.commonName?.default].filter(Boolean).join(' ') || t.abbrev;

async function seasonSchedule(abbr: string, season: string): Promise<SchedGame[]> {
  const data = await nhlGet<{ games?: SchedGame[] }>(`/v1/club-schedule-season/${abbr}/${season}`);
  return data.games ?? [];
}

const isDecided = (g: SchedGame) => g.gameState === 'FINAL' || g.gameState === 'OFF';

/** Regular-season W-L(-OTL) record for `abbr` from its season schedule. */
function regularRecord(games: SchedGame[], abbr: string) {
  let w = 0, l = 0, otl = 0;
  for (const g of games) {
    if (g.gameType !== 2 || !isDecided(g)) continue;
    const us = g.homeTeam.abbrev === abbr ? g.homeTeam : g.awayTeam;
    const them = g.homeTeam.abbrev === abbr ? g.awayTeam : g.homeTeam;
    if (us.score == null || them.score == null) continue;
    if (us.score > them.score) w++;
    else if (g.gameOutcome?.lastPeriodType && g.gameOutcome.lastPeriodType !== 'REG') otl++;
    else l++;
  }
  return { w, l, otl };
}

const ROUND_NAME = ['', 'the first round', 'the second round', 'the conference final', 'the Stanley Cup Final'];

/** How far a team went in the playoffs, in round terms (from type-3 games). */
function playoffResult(games: SchedGame[], abbr: string): string {
  const po = games.filter((g) => g.gameType === 3 && isDecided(g));
  if (po.length === 0) return 'missed the playoffs';

  // Group by opponent = one series; number of series = rounds reached.
  const series = new Map<string, SchedGame[]>();
  for (const g of po) {
    const opp = g.homeTeam.abbrev === abbr ? g.awayTeam.abbrev : g.homeTeam.abbrev;
    if (!series.has(opp)) series.set(opp, []);
    series.get(opp)!.push(g);
  }
  const roundsReached = series.size;

  // The latest series determines the outcome (won it → advanced/Cup; lost → out).
  let lastGames: SchedGame[] = [];
  let lastDate = '';
  for (const gs of series.values()) {
    const d = gs.map((x) => x.gameDate).sort().at(-1)!;
    if (d > lastDate) { lastDate = d; lastGames = gs; }
  }
  const wins = lastGames.filter((g) => {
    const us = g.homeTeam.abbrev === abbr ? g.homeTeam : g.awayTeam;
    const them = g.homeTeam.abbrev === abbr ? g.awayTeam : g.homeTeam;
    return (us.score ?? 0) > (them.score ?? 0);
  }).length;
  const wonLast = wins >= 4;
  const roundName = ROUND_NAME[roundsReached] ?? `round ${roundsReached}`;

  if (wonLast && roundsReached >= 4) return 'won the Stanley Cup';
  return `were eliminated in ${roundName}`;
}

// ---- Key players (last-season leaders still on the current roster) ----
interface SkaterStat {
  playerId: number;
  firstName?: { default: string };
  lastName?: { default: string };
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
}
interface GoalieStat {
  playerId: number;
  firstName?: { default: string };
  lastName?: { default: string };
  gamesPlayed: number;
  wins: number;
  goalsAgainstAverage: number;
  savePercentage: number;
}
const playerName = (p: { firstName?: { default: string }; lastName?: { default: string } }) =>
  [p.firstName?.default, p.lastName?.default].filter(Boolean).join(' ');

async function currentRosterIds(abbr: string): Promise<Set<number>> {
  try {
    const d = await nhlGet<{ forwards?: { id: number }[]; defensemen?: { id: number }[]; goalies?: { id: number }[] }>(
      `/v1/roster/${abbr}/current`,
    );
    const ids = new Set<number>();
    for (const grp of [d.forwards, d.defensemen, d.goalies]) for (const p of grp ?? []) ids.add(p.id);
    return ids;
  } catch {
    return new Set();
  }
}

/** Top returning skaters + primary goalie from last season, still on the roster. */
async function keyPlayers(abbr: string, lastSeason: string): Promise<string> {
  let stats: { skaters?: SkaterStat[]; goalies?: GoalieStat[] } | null = null;
  let rosterIds = new Set<number>();
  try {
    [stats, rosterIds] = await Promise.all([
      nhlGet<{ skaters?: SkaterStat[]; goalies?: GoalieStat[] }>(`/v1/club-stats/${abbr}/${lastSeason}/2`),
      currentRosterIds(abbr),
    ]);
  } catch {
    return '';
  }
  if (!stats) return '';
  const onRoster = (id: number) => rosterIds.size === 0 || rosterIds.has(id);
  const skaters = (stats.skaters ?? [])
    .filter((s) => onRoster(s.playerId))
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((s) => `${playerName(s)} (${s.goals}G-${s.assists}A-${s.points}P)`);
  const goalie = (stats.goalies ?? [])
    .filter((g) => onRoster(g.playerId))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)[0];
  const parts = [...skaters];
  if (goalie) {
    parts.push(
      `goaltender ${playerName(goalie)} (${goalie.wins}W, ${Number(goalie.goalsAgainstAverage).toFixed(2)} GAA, ${Number(goalie.savePercentage).toFixed(3)} SV%)`,
    );
  }
  return parts.join('; ');
}

export interface OpenerContext {
  gameId: number;
  date: string;
  weekday: string;
  venue: string | null;
  networks: string[];
  home: { abbr: string; name: string };
  away: { abbr: string; name: string };
  targetName: string;
  openerForBoth: boolean;
  headToHead: { date: string; line: string }[];
  seriesNote: string;
  homeSummary: string;
  awaySummary: string;
  homeKeyPlayers: string;
  awayKeyPlayers: string;
}

function summarize(name: string, sched: SchedGame[], abbr: string): string {
  const r = regularRecord(sched, abbr);
  const rec = `${r.w}-${r.l}${r.otl ? `-${r.otl}` : ''}`;
  return `${name}: ${rec} regular-season record last season; ${playoffResult(sched, abbr)}.`;
}

/** Build grounded opener context for `teamAbbr`'s first regular-season game. */
export async function buildOpenerContext(
  teamAbbr: string,
  upcomingSeason = '20262027',
  lastSeason = '20252026',
): Promise<OpenerContext> {
  const sched = await seasonSchedule(teamAbbr, upcomingSeason);
  const opener = sched.filter((g) => g.gameType === 2).sort((a, b) => a.gameDate.localeCompare(b.gameDate))[0];
  if (!opener) throw new Error(`No ${upcomingSeason} regular-season game found for ${teamAbbr}`);

  const oppAbbr = opener.homeTeam.abbrev === teamAbbr ? opener.awayTeam.abbrev : opener.homeTeam.abbrev;

  const homeAbbr = opener.homeTeam.abbrev;
  const awayAbbr = opener.awayTeam.abbrev;
  const [teamLast, oppLast, oppUpcoming, homeKeyPlayers, awayKeyPlayers] = await Promise.all([
    seasonSchedule(teamAbbr, lastSeason),
    seasonSchedule(oppAbbr, lastSeason),
    seasonSchedule(oppAbbr, upcomingSeason),
    keyPlayers(homeAbbr, lastSeason),
    keyPlayers(awayAbbr, lastSeason),
  ]);

  // Is this also the opponent's first game? (Season openers usually are, but the
  // target team's opener can be a mid-schedule game for the opponent.)
  const oppOpener = oppUpcoming.filter((g) => g.gameType === 2).sort((a, b) => a.gameDate.localeCompare(b.gameDate))[0];
  const openerForBoth = oppOpener?.id === opener.id;
  const weekday = new Date(`${opener.gameDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long' });

  // Head-to-head last season (regular season only). State an explicit winner so
  // the model never has to infer it from raw scores (it gets that wrong).
  const h2h = teamLast
    .filter((g) => g.gameType === 2 && isDecided(g) && [g.homeTeam.abbrev, g.awayTeam.abbrev].includes(oppAbbr))
    .map((g) => {
      const homeWon = g.homeTeam.score! > g.awayTeam.score!;
      const winner = homeWon ? g.homeTeam : g.awayTeam;
      const loser = homeWon ? g.awayTeam : g.homeTeam;
      const at = homeWon ? '(home)' : '(on the road)';
      return {
        date: g.gameDate,
        line: `${teamName(winner)} beat ${teamName(loser)} ${winner.score}-${loser.score} ${at}`,
        teamWon: (g.homeTeam.abbrev === teamAbbr ? homeWon : !homeWon),
      };
    });
  const teamWins = h2h.filter((x) => x.teamWon).length;
  const oppWins = h2h.length - teamWins;
  const seriesNote = h2h.length
    ? `Last season's series (regular season, ${h2h.length} games): ${teamName(opener.homeTeam.abbrev === teamAbbr ? opener.homeTeam : opener.awayTeam)} ${teamWins}, ${teamName(opener.homeTeam.abbrev === teamAbbr ? opener.awayTeam : opener.homeTeam)} ${oppWins}.`
    : 'The teams did not meet in the regular season last year.';

  return {
    gameId: opener.id,
    date: opener.gameDate,
    weekday,
    venue: opener.venue?.default ?? null,
    networks: (opener.tvBroadcasts ?? []).map((b) => b.network).filter(Boolean),
    home: { abbr: opener.homeTeam.abbrev, name: teamName(opener.homeTeam) },
    away: { abbr: opener.awayTeam.abbrev, name: teamName(opener.awayTeam) },
    targetName: teamName(opener.homeTeam.abbrev === teamAbbr ? opener.homeTeam : opener.awayTeam),
    openerForBoth,
    headToHead: h2h.map(({ date, line }) => ({ date, line })),
    seriesNote,
    homeSummary: summarize(teamName(opener.homeTeam), opener.homeTeam.abbrev === teamAbbr ? teamLast : oppLast, homeAbbr),
    awaySummary: summarize(teamName(opener.awayTeam), opener.awayTeam.abbrev === teamAbbr ? teamLast : oppLast, awayAbbr),
    homeKeyPlayers,
    awayKeyPlayers,
  };
}

const previewSchema = z.object({
  summary: z.string().describe('One-sentence hook, ~15-25 words.'),
  body: z.string().describe('The preview: 3-4 short paragraphs, engaging but factual.'),
});

export interface GeneratedPreview {
  title: string;
  summary: string;
  body: string;
  model: string;
  promptKeys: string[];
  promptVersions: Record<string, number>;
}

export async function generateOpenerPreview(ctx: OpenerContext): Promise<GeneratedPreview> {
  const facts = [
    `Matchup: ${ctx.away.name} at ${ctx.home.name}.`,
    `Date: ${ctx.weekday}, ${ctx.date}${ctx.venue ? `, at ${ctx.venue}` : ''}.`,
    ctx.openerForBoth
      ? 'This is the season opener for BOTH teams.'
      : `This is ${ctx.targetName}'s season opener; the opponent has already played earlier games this season.`,
    ctx.seriesNote,
    ctx.headToHead.length
      ? `Head-to-head games last season:\n${ctx.headToHead.map((h) => `  - ${h.date}: ${h.line}`).join('\n')}`
      : '',
    ctx.homeSummary,
    ctx.awaySummary,
    ctx.homeKeyPlayers ? `${ctx.home.name} key returning players (last season's stats): ${ctx.homeKeyPlayers}.` : '',
    ctx.awayKeyPlayers ? `${ctx.away.name} key returning players (last season's stats): ${ctx.awayKeyPlayers}.` : '',
  ].filter(Boolean).join('\n');

  const prompt = await loadSystemPrompt('game_preview.opener');

  const { output } = await generateText({
    model: gateway(PREVIEW_MODEL),
    system: prompt.system,
    output: Output.object({ schema: previewSchema }),
    prompt: `Write the game preview from these facts:\n\n${facts}`,
  });

  const prettyDate = new Date(`${ctx.date}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  return {
    title: `${ctx.away.name} at ${ctx.home.name} — ${prettyDate}`,
    summary: output?.summary ?? '',
    body: output?.body ?? '',
    model: PREVIEW_MODEL,
    promptKeys: prompt.usedKeys,
    promptVersions: prompt.versions,
  };
}

/** Upsert a preview into generated_content (regeneration bumps version + resets to 'new'). */
export async function saveGamePreview(
  ctx: OpenerContext,
  preview: GeneratedPreview,
): Promise<{ outcome: 'inserted' | 'updated'; id: number }> {
  const dedupKey = `game_preview:nhl-${ctx.gameId}`;
  const data = {
    prompt_version: PROMPT_VERSION,
    prompt_keys: preview.promptKeys,
    prompt_versions: preview.promptVersions,
    home: ctx.home,
    away: ctx.away,
    date: ctx.date,
    opener_for_both: ctx.openerForBoth,
    series_note: ctx.seriesNote,
    head_to_head: ctx.headToHead,
    sources: ['nhl-api'],
  };
  const base = {
    content_type: 'game_preview',
    league: 'NHL',
    subject_type: 'game',
    subject_id: `nhl-${ctx.gameId}`,
    title: preview.title,
    summary: preview.summary,
    body: preview.body,
    model: preview.model,
    data,
    status: 'new',
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from('generated_content')
    .select('id, version')
    .eq('dedup_key', dedupKey)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('generated_content')
      .update({ ...base, version: (existing.version ?? 1) + 1, reviewer: null, reviewed_at: null })
      .eq('id', existing.id);
    return { outcome: 'updated', id: existing.id };
  }
  const { data: inserted } = await supabase
    .from('generated_content')
    .insert({ ...base, dedup_key: dedupKey, version: 1 })
    .select('id')
    .single();
  return { outcome: 'inserted', id: inserted!.id };
}
