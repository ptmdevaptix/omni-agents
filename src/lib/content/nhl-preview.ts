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

  // Didn't win the Cup → they lost their last series. Name who eliminated them
  // and the series length (games), per the caller's requirement.
  const oppSide = lastGames[0].homeTeam.abbrev === abbr ? lastGames[0].awayTeam : lastGames[0].homeTeam;
  return `were eliminated by the ${teamName(oppSide)} in ${lastGames.length} games in ${roundName}`;
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

interface RosterPlayer { id: number }
async function currentRoster(abbr: string): Promise<RosterPlayer[]> {
  try {
    const d = await nhlGet<{ forwards?: RosterPlayer[]; defensemen?: RosterPlayer[]; goalies?: RosterPlayer[] }>(
      `/v1/roster/${abbr}/current`,
    );
    return [...(d.forwards ?? []), ...(d.defensemen ?? []), ...(d.goalies ?? [])];
  } catch {
    return [];
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

interface Newcomer {
  name: string;
  pos: string;
  priorTeam?: string;   // NHL team he played for LAST season (current identity), if any
  priorPoints?: number;
  priorLeague?: string; // league he played in last season when it wasn't the NHL (e.g. 'AHL')
  debut: boolean;
  overall?: number;
}

/**
 * Enrich a newcomer from their player landing: where he actually played LAST
 * season (an NHL team only if he was in the NHL that season — never a stale or
 * since-relocated franchise from an earlier year), NHL debut, draft.
 */
async function enrichNewcomer(id: number, lastSeason: string): Promise<Newcomer | null> {
  try {
    const l = await nhlGet<{
      firstName?: { default: string };
      lastName?: { default: string };
      position?: string;
      draftDetails?: { year: number; overallPick: number };
      careerTotals?: { regularSeason?: { gamesPlayed?: number } };
      seasonTotals?: {
        leagueAbbrev?: string; gameTypeId?: number; season?: number; points?: number;
        teamCommonName?: { default: string };
      }[];
    }>(`/v1/player/${id}/landing`);
    // Only consider rows from the season immediately prior — never fall back to
    // an older NHL row (that surfaced players "from" teams they left years ago,
    // including franchises that have since relocated).
    const lastRows = (l.seasonTotals ?? []).filter((s) => s.season === Number(lastSeason) && s.gameTypeId === 2);
    const nhlLast = lastRows.find((s) => s.leagueAbbrev === 'NHL');
    return {
      name: playerName(l),
      pos: l.position ?? '',
      priorTeam: nhlLast?.teamCommonName?.default,
      priorPoints: nhlLast?.points,
      priorLeague: !nhlLast ? lastRows.find((s) => s.leagueAbbrev)?.leagueAbbrev : undefined,
      debut: (l.careerTotals?.regularSeason?.gamesPlayed ?? 0) === 0,
      overall: l.draftDetails?.overallPick,
    };
  } catch {
    return null;
  }
}

function fmtNewcomer(n: Newcomer): string {
  const q: string[] = [];
  if (n.debut) {
    q.push(n.overall && n.overall <= 10 ? `${ordinal(n.overall)} overall pick making his NHL debut` : 'making his NHL debut');
  } else if (n.priorTeam) {
    q.push(`from the ${n.priorTeam}`);
    if (n.priorPoints != null && n.priorPoints > 0) q.push(`${n.priorPoints} points last season`);
  } else if (n.priorLeague) {
    q.push(`spent last season in the ${n.priorLeague}`);
  }
  return `${n.name} (${n.pos})${q.length ? ` — ${q.join(', ')}` : ''}`;
}

// ---- Recent draft (high picks) + signing status from capspace ----
interface DraftPick { overall: number; team: string; name: string; pos: string; club?: string; league?: string; signed?: boolean; aav?: string; }

const capNorm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

interface CapPlayer { name?: string; signed?: boolean; aavLabel?: string }

/** Signing status per player from cached capspace-org data (whether a pick is on an NHL ELC). */
async function capspaceSigned(teamAbbr: string): Promise<Map<string, CapPlayer>> {
  try {
    const { data } = await supabase
      .from('api_cache')
      .select('data')
      .eq('key', `capspace-org-${teamAbbr.toLowerCase()}`)
      .maybeSingle();
    const players = ((data?.data as { players?: CapPlayer[] } | null)?.players) ?? [];
    return new Map(players.filter((p) => p.name).map((p) => [capNorm(p.name!), p]));
  } catch {
    return new Map();
  }
}

const strOrDefault = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : (v as { default?: string })?.default;

/** Top picks (overall <= max) from a draft year, for the given teams. */
async function topDraftPicks(draftYear: string, teams: Set<string>, maxOverall = 15): Promise<DraftPick[]> {
  try {
    const d = await nhlGet<{
      picks?: {
        overallPick: number; teamAbbrev: string; positionCode?: string;
        firstName?: { default: string }; lastName?: { default: string };
        amateurClubName?: unknown; amateurLeague?: unknown;
      }[];
    }>(`/v1/draft/picks/${draftYear}/all`);
    return (d.picks ?? [])
      .filter((p) => p.overallPick <= maxOverall && teams.has(p.teamAbbrev))
      .map((p) => ({
        overall: p.overallPick,
        team: p.teamAbbrev,
        name: [p.firstName?.default, p.lastName?.default].filter(Boolean).join(' '),
        pos: p.positionCode ?? '',
        club: strOrDefault(p.amateurClubName),
        league: strOrDefault(p.amateurLeague),
      }));
  } catch {
    return [];
  }
}

// Signed non-Euro (CHL/NCAA/US-junior) picks can't be assigned to the AHL and
// can't return to junior/college — NHL debut expected. Signed Euro picks may
// open in the AHL. Unsigned picks aren't assumed to play. Computed here (not by
// the model) so the fact states the conclusion directly.
const EURO_LEAGUES = /SHL|LIIGA|KHL|MHL|VHL|ALLSVENSKAN|NL$|DEL|EXTRALIGA|CZECH|SWISS|INTERNATIONAL|EURO/i;

function fmtPick(p: DraftPick): string {
  const from = p.club ? `, from ${p.club}${p.league ? ` (${p.league})` : ''}` : '';
  let note: string;
  if (p.signed !== true) {
    note = 'NOT signed to an NHL contract — do not assume an NHL debut; unsigned picks usually return to junior, college, or their European club';
  } else if (p.league && EURO_LEAGUES.test(p.league)) {
    note = `signed to an NHL entry-level contract${p.aav ? ` (${p.aav} AAV)` : ''}; coming from Europe he could open in the AHL, so an NHL debut is likely but not certain`;
  } else {
    note = `signed to an NHL entry-level contract${p.aav ? ` (${p.aav} AAV)` : ''}; as a North American junior/college player he cannot be assigned to the AHL or return to junior/college, so his NHL debut is expected barring injury or a healthy scratch`;
  }
  return `${p.name} (${ordinal(p.overall)} overall${p.pos ? `, ${p.pos}` : ''}${from}) — ${note}`;
}

export interface TeamContext {
  keyPlayers: string;
  newcomers: Newcomer[];
  departures: string;
  goaltending: string;
}

/** Returning leaders + offseason additions (enriched) + notable departures. */
async function teamContext(abbr: string, lastSeason: string): Promise<TeamContext> {
  let stats: { skaters?: SkaterStat[]; goalies?: GoalieStat[] } | null = null;
  let roster: RosterPlayer[] = [];
  try {
    [stats, roster] = await Promise.all([
      nhlGet<{ skaters?: SkaterStat[]; goalies?: GoalieStat[] }>(`/v1/club-stats/${abbr}/${lastSeason}/2`),
      currentRoster(abbr),
    ]);
  } catch {
    return { keyPlayers: '', newcomers: [], departures: '', goaltending: '' };
  }
  const rosterIds = new Set(roster.map((p) => p.id));
  const lastIds = new Set([...(stats?.skaters ?? []), ...(stats?.goalies ?? [])].map((s) => s.playerId));
  const haveRoster = rosterIds.size > 0;
  const onRoster = (id: number) => !haveRoster || rosterIds.has(id);

  // Enrich offseason additions. Keep the full list so we can pull out an added
  // goaltender for the goaltending summary and keep the additions line skaters.
  let enriched: Newcomer[] = [];
  if (haveRoster) {
    const newIds = roster.filter((p) => !lastIds.has(p.id)).slice(0, 16).map((p) => p.id);
    enriched = (await Promise.all(newIds.map((id) => enrichNewcomer(id, lastSeason))))
      .filter((n): n is Newcomer => !!n)
      // Drop minor-league/depth pickups (played last season in the AHL/ECHL and
      // not making an NHL debut) — they're not roster storylines for a preview.
      .filter((n) => !(n.priorLeague && /^(AHL|ECHL)$/i.test(n.priorLeague) && !n.debut));
    enriched.sort((a, b) => {
      const rank = (n: Newcomer) => (n.pos === 'G' ? 3 : 0) + (n.debut ? 2 : 0) + (n.priorPoints ?? 0) / 200;
      return rank(b) - rank(a);
    });
  }
  const addedGoalie = enriched.find((n) => n.pos === 'G') ?? null;
  const newcomers = enriched.filter((n) => n.pos !== 'G').slice(0, 4);

  // Returning skater leaders (goaltending handled separately, below).
  const keySk = (stats?.skaters ?? [])
    .filter((s) => onRoster(s.playerId))
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((s) => `${playerName(s)} (${s.goals}G-${s.assists}A-${s.points}P)`);

  // Goaltending, stated explicitly so the preview never mistakes a backup
  // signing for a new #1: does last season's most-used goalie return (he's still
  // the starter; any arrival is only depth), or did he leave (the crease opens
  // for an arrival)?
  const goaliesByGp = (stats?.goalies ?? []).slice().sort((a, b) => b.gamesPlayed - a.gamesPlayed);
  const topG = goaliesByGp[0] ?? null;
  const topGReturns = topG ? onRoster(topG.playerId) : false;
  let goaltending = '';
  if (topG && topGReturns) {
    goaltending = `${playerName(topG)} (${topG.wins} wins, ${Number(topG.savePercentage).toFixed(3)} SV% last season) returns as the starter`;
    goaltending += addedGoalie
      ? `; ${addedGoalie.name} was signed only as backup depth behind him — he does NOT take over the crease.`
      : '.';
  } else if (topG && !topGReturns) {
    goaltending = addedGoalie
      ? `Last season's most-used goaltender, ${playerName(topG)}, is gone; ${addedGoalie.name} was brought in and is expected to take over the crease.`
      : `Last season's most-used goaltender, ${playerName(topG)}, is gone, leaving the starting job unsettled.`;
  }

  // Notable skater departures (goalies are covered by the goaltending line).
  const departures = haveRoster
    ? (stats?.skaters ?? [])
        .filter((s) => !rosterIds.has(s.playerId) && s.points >= 15)
        .sort((a, b) => b.points - a.points)
        .slice(0, 3)
        .map((s) => `${playerName(s)} (${s.points} pts)`)
    : [];

  return {
    keyPlayers: keySk.join('; '),
    newcomers,
    departures: departures.join('; '),
    goaltending,
  };
}

export interface OpenerContext {
  gameId: number;
  date: string;
  startTimeUTC: string | null;
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
  homeGoaltending: string;
  awayGoaltending: string;
  homeAdditions: string;
  awayAdditions: string;
  homeDepartures: string;
  awayDepartures: string;
  homeDraftPicks: string;
  awayDraftPicks: string;
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
  const draftYear = upcomingSeason.slice(0, 4); // 2026-27 season ⇒ 2026 draft
  const [teamLast, oppLast, oppUpcoming, homeTeamCtx, awayTeamCtx, draftPicks, homeCap, awayCap] = await Promise.all([
    seasonSchedule(teamAbbr, lastSeason),
    seasonSchedule(oppAbbr, lastSeason),
    seasonSchedule(oppAbbr, upcomingSeason),
    teamContext(homeAbbr, lastSeason),
    teamContext(awayAbbr, lastSeason),
    topDraftPicks(draftYear, new Set([homeAbbr, awayAbbr])),
    capspaceSigned(homeAbbr),
    capspaceSigned(awayAbbr),
  ]);
  // Attach signing status (from capspace) and drop picks already on the roster
  // (covered by additions as a debut).
  const enrich = (p: DraftPick, cap: Map<string, CapPlayer>): DraftPick => {
    const c = cap.get(capNorm(p.name));
    return { ...p, signed: c?.signed, aav: c?.aavLabel };
  };
  const homePicks = draftPicks
    .filter((p) => p.team === homeAbbr && !homeTeamCtx.newcomers.some((n) => n.name === p.name))
    .map((p) => enrich(p, homeCap));
  const awayPicks = draftPicks
    .filter((p) => p.team === awayAbbr && !awayTeamCtx.newcomers.some((n) => n.name === p.name))
    .map((p) => enrich(p, awayCap));

  // Is this also the opponent's first game? (Season openers usually are, but the
  // target team's opener can be a mid-schedule game for the opponent.)
  const oppOpener = oppUpcoming.filter((g) => g.gameType === 2).sort((a, b) => a.gameDate.localeCompare(b.gameDate))[0];
  const openerForBoth = oppOpener?.id === opener.id;
  const targetIsHome = opener.homeTeam.abbrev === teamAbbr;
  const weekday = new Date(`${opener.gameDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long' });

  // Debut framing is only valid for the team whose opener this is. When it's a
  // one-sided opener, the opponent has already played games, so any rookie debut
  // has already happened — drop the opponent's draft picks entirely and strip
  // debut newcomers from the opponent's additions.
  const homePicksShown = openerForBoth || targetIsHome ? homePicks : [];
  const awayPicksShown = openerForBoth || !targetIsHome ? awayPicks : [];
  const fmtAdds = (list: Newcomer[], suppressDebuts: boolean) =>
    (suppressDebuts ? list.filter((n) => !n.debut) : list).map(fmtNewcomer).join('; ');
  const homeAdditions = fmtAdds(homeTeamCtx.newcomers, !openerForBoth && !targetIsHome);
  const awayAdditions = fmtAdds(awayTeamCtx.newcomers, !openerForBoth && targetIsHome);

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
    startTimeUTC: opener.startTimeUTC ?? null,
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
    homeKeyPlayers: homeTeamCtx.keyPlayers,
    awayKeyPlayers: awayTeamCtx.keyPlayers,
    homeGoaltending: homeTeamCtx.goaltending,
    awayGoaltending: awayTeamCtx.goaltending,
    homeAdditions,
    awayAdditions,
    homeDepartures: homeTeamCtx.departures,
    awayDepartures: awayTeamCtx.departures,
    homeDraftPicks: homePicksShown.map(fmtPick).join('; '),
    awayDraftPicks: awayPicksShown.map(fmtPick).join('; '),
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
    ctx.homeGoaltending ? `${ctx.home.name} goaltending: ${ctx.homeGoaltending}` : '',
    ctx.awayGoaltending ? `${ctx.away.name} goaltending: ${ctx.awayGoaltending}` : '',
    ctx.homeAdditions ? `${ctx.home.name} offseason additions: ${ctx.homeAdditions}.` : '',
    ctx.awayAdditions ? `${ctx.away.name} offseason additions: ${ctx.awayAdditions}.` : '',
    ctx.homeDepartures ? `${ctx.home.name} notable departures: ${ctx.homeDepartures}.` : '',
    ctx.awayDepartures ? `${ctx.away.name} notable departures: ${ctx.awayDepartures}.` : '',
    ctx.homeDraftPicks ? `${ctx.home.name} recent top draft pick(s): ${ctx.homeDraftPicks}.` : '',
    ctx.awayDraftPicks ? `${ctx.away.name} recent top draft pick(s): ${ctx.awayDraftPicks}.` : '',
  ].filter(Boolean).join('\n');

  const prompt = await loadSystemPrompt('game_preview.opener');

  // The model occasionally returns a malformed object (e.g. wrapped in a
  // "parameters" envelope) that fails schema validation. Retry a few times.
  let output: { summary: string; body: string } | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await generateText({
        model: gateway(PREVIEW_MODEL),
        system: prompt.system,
        output: Output.object({ schema: previewSchema }),
        prompt: `Write the game preview from these facts:\n\n${facts}`,
      });
      if (res.output?.summary && res.output?.body) {
        output = res.output;
        break;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (!output) throw lastErr ?? new Error('generation produced no valid object after retries');

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
    start_time_utc: ctx.startTimeUTC,
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

// ---- Batch/UI regeneration helpers ----

/** Current 32 NHL franchises (abbrevs). */
export const NHL_TEAMS = [
  'ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET',
  'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NJD', 'NSH', 'NYI', 'NYR', 'OTT',
  'PHI', 'PIT', 'SJS', 'SEA', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK',
  'WPG', 'WSH',
];

export interface OpenerPlanEntry {
  gameId: number;
  target: string; // team POV to build the preview from
  home: string;
  away: string;
}

/**
 * Each team's first upcoming regular-season game, deduped by game id (shared
 * openers appear once). `target` is the POV team to build from. This is the work
 * list for a "regenerate all" run.
 */
export async function planOpenerTargets(season = '20262027'): Promise<OpenerPlanEntry[]> {
  const byGame = new Map<number, OpenerPlanEntry>();
  for (const abbr of NHL_TEAMS) {
    try {
      const sched = await seasonSchedule(abbr, season);
      const opener = sched
        .filter((g) => g.gameType === 2)
        .sort((a, b) => a.gameDate.localeCompare(b.gameDate))[0];
      if (!opener || byGame.has(opener.id)) continue;
      byGame.set(opener.id, {
        gameId: opener.id,
        target: abbr,
        home: opener.homeTeam.abbrev,
        away: opener.awayTeam.abbrev,
      });
    } catch {
      // skip a team whose schedule can't be fetched
    }
  }
  return [...byGame.values()];
}

/** Build → generate → save an opener preview for a team's opener. */
export async function regenerateOpener(
  teamAbbr: string,
): Promise<{ gameId: number; id: number; title: string; outcome: 'inserted' | 'updated' }> {
  const ctx = await buildOpenerContext(teamAbbr);
  const preview = await generateOpenerPreview(ctx);
  const res = await saveGamePreview(ctx, preview);
  return { gameId: ctx.gameId, id: res.id, title: preview.title, outcome: res.outcome };
}

/**
 * Regenerate the preview for one existing game_preview row, picking whichever of
 * its two teams actually has this game as its opener as the POV.
 */
export async function regenerateGameForRow(
  gameId: number,
  homeAbbr: string,
  awayAbbr: string,
): Promise<{ id: number; title: string }> {
  for (const abbr of [homeAbbr, awayAbbr].filter(Boolean)) {
    const ctx = await buildOpenerContext(abbr);
    if (ctx.gameId === gameId) {
      const preview = await generateOpenerPreview(ctx);
      const res = await saveGamePreview(ctx, preview);
      return { id: res.id, title: preview.title };
    }
  }
  throw new Error(`Could not resolve a POV team whose opener is game ${gameId}`);
}
