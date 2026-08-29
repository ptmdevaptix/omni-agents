import { generateText, Output, gateway } from 'ai';
import { z } from 'zod';
import { supabase } from './supabase';
import { fetchFeed } from './rss';
import { readArticle } from './article-reader';
import { resolveEntities } from './resolve-entities';

const topicGateSchema = z.object({
  // Asked first: a one-line justification measurably steadies the verdict on
  // borderline headlines, and costs a sentence per item.
  reason: z.string().describe('One sentence: what sport, if any, this is about.'),
  isOtherSport: z
    .boolean()
    .describe(
      'True ONLY when the article is clearly about a sport other than ice hockey — football, basketball, baseball, soccer, motorsport, cricket, rugby — or is clearly not sports content at all. If the sport is ambiguous, or you are unsure, answer false.',
    ),
});

/**
 * Cheap first-pass topic gate, run on the RSS title/snippet alone.
 *
 * A feed's league label is not a promise about its items: some nominally
 * single-sport feeds (notably Yahoo's NHL feed) actually serve the publisher's
 * general sports wire. Rejecting here, before readArticle, avoids fetching and
 * fully analyzing every NFL item on every scan.
 *
 * Deliberately asks the exclusion question rather than "is this hockey?" — the
 * inclusion form rejects real junior/college/minor-league hockey whose club
 * nicknames it doesn't recognize. Rejects only on a confident "other sport",
 * and fails open if the gate itself errors.
 */
/**
 * The opening lines of a story, for the gate to judge on.
 *
 * Some feeds carry no <description> at all, so the whole article body is the
 * only text available; sending all of it on every item is waste. A news lede
 * names its subject, so the first few sentences decide the sport as well as the
 * full text would.
 */
function lede(text: string | undefined, max = 400): string {
  if (!text) return '';
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  // Prefer a sentence end, then a word boundary, over cutting mid-word.
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (stop > max * 0.4) return head.slice(0, stop + 1);
  const space = head.lastIndexOf(' ');
  return (space > 0 ? head.slice(0, space) : head) + '…';
}

/** A headline is SHOUTING if it has real letters and none of them are lowercase. */
function isAllCaps(title: string): boolean {
  return title.length > 12 && /[A-Z]{3}/.test(title) && !/[a-z]/.test(title);
}

// Words a headline leaves lowercase unless they open or close it.
const MINOR_WORDS = new Set(['a','an','and','as','at','but','by','for','from','in','nor','of','on','or','the','to','v','vs','with']);
// Left uppercase wherever they appear.
const ACRONYMS = new Set(['AHL','NHL','ECHL','OHL','WHL','QMJHL','USHL','NCAA','PWHL','KHL','GM','PTO','OT','TV','MVP','IR','II','III','IV','USA','U18','U20','CHL','NAHL','SPHL','LNAH','ATO','SPC','WJC']);

/**
 * Restore normal capitalisation to a SHOUTED headline.
 *
 * The model does this better — it knows "MCDAVID" is McDavid — so this only runs
 * when the model's answer can't be trusted to be a pure re-casing.
 */
function toHeadlineCase(title: string): string {
  const words = title.split(/(\s+)/);
  let wordIndex = -1;
  const total = words.filter((w) => w.trim()).length;
  return words
    .map((token) => {
      if (!token.trim()) return token;
      wordIndex++;
      const bare = token.replace(/[^A-Za-z]/g, '');
      if (ACRONYMS.has(bare)) return token;
      const lower = token.toLowerCase();
      if (wordIndex > 0 && wordIndex < total - 1 && MINOR_WORDS.has(lower.replace(/[^a-z]/g, ''))) {
        return lower;
      }
      // Capitalise after a space, a hyphen, a slash and an apostrophe that starts a
      // name ("O'BRIEN" → "O'Brien"), but not a possessive ("PATS'" → "Pats'").
      return lower.replace(/(^|[-/]|(?<=^[a-z])')([a-z])/g, (_, pre: string, ch: string) => pre + ch.toUpperCase());
    })
    .join('');
}

/**
 * The headline as readers should see it.
 *
 * Two problems, one answer: the QMJHL's club sites publish in French, and several
 * AHL and CHL clubs shout their headlines in capitals. The analysis call already
 * reads the article, so it returns the English headline for free.
 *
 * An English article normally keeps the publisher's exact words — asking a model
 * to echo a headline back is a rewrite waiting to happen. The exception is a
 * SHOUTED headline, and even then the model's version is accepted only if it
 * differs from the original by capitalisation alone; anything else falls back to
 * the deterministic re-caser.
 */
export function displayTitle(original: string, language?: string, suggested?: string): string {
  const proposed = suggested?.trim();
  const isEnglish = !language || language.toLowerCase().startsWith('en');

  if (!isEnglish && proposed) return proposed;
  if (!isAllCaps(original)) return original;
  if (proposed && proposed.toLowerCase() === original.toLowerCase()) return proposed;
  return toHeadlineCase(original);
}

export async function isHockeyItem(title: string, excerpt?: string): Promise<boolean> {
  try {
    const { output } = await generateText({
      model: gateway('anthropic/claude-haiku-4.5'),
      temperature: 0, // a borderline title must not flip verdict between scans
      output: Output.object({ schema: topicGateSchema }),
      prompt: `You are filtering a hockey news feed that covers every level of the sport: NHL, AHL, ECHL, the CHL (OHL/WHL/QMJHL), USHL, NCAA, PWHL, and other junior and women's leagues.

Many of those clubs share nicknames with teams in other sports (Royals, Warriors, Mariners, Broncos, Americans, Fleet, Sting, Shamrocks, Mammoth, Knights). Treat an unfamiliar team name as hockey unless the article names another sport. Roster moves, signings, draft picks, coaching hires, arena and community items from those clubs are hockey. Off-ice news about hockey people — court cases, obituaries, business and league governance — is hockey too.

A game or playoff-series item naming two clubs, with no other sport named, is hockey — "series tied 2-2" and similar phrasing does not make it baseball or basketball. Opinion, analysis, rumour and commentary about hockey are hockey. "Not sports at all" means a different subject entirely — politics, entertainment, technology.

Answer true ONLY if the article is clearly about another sport, or clearly about a non-sports subject. An item that names no sport at all — league governance, eligibility rules, arena or business news — is not clearly another sport: answer false.

Title: ${title}

Snippet: ${excerpt ?? ''}`,
    });
    return !(output?.isOtherSport ?? false);
  } catch {
    return true;
  }
}

const articleAnalysisSchema = z.object({
  isOtherSport: z
    .boolean()
    .describe(
      'Judge this first. True ONLY when the full text shows this is about a sport other than ice hockey, or is not sports content at all. Hockey at any level — NHL, AHL, ECHL, CHL, USHL, NCAA, PWHL, junior, women\'s — is false, and so is off-ice news about hockey people. When unsure, answer false; the remaining fields only matter then.',
    ),
  language: z
    .string()
    .describe(
      "The language the article is written in, as an ISO 639-1 code — 'en', 'fr', 'sv'. Judge it from the body text, not the club's location.",
    ),
  titleEnglish: z
    .string()
    .describe(
      'The headline in English. If the article is ALREADY in English, repeat its headline back exactly as given, character for character — do not rewrite, retitle, clean up or improve it. The ONE exception: if the headline is written in ALL CAPITALS, give it back in normal headline capitalisation, spelling names the way they are properly spelled (McDavid, O\'Brien, DeBrusk, LeBlanc) and leaving acronyms capitalised (AHL, NHL, GM, PTO, OT). Only when the article is in another language should the wording differ from the original: then translate the headline faithfully, keeping club and player names as they are written.',
    ),
  excerpt: z
    .string()
    .describe(
      'A natural, news-style summary in 1-3 sentences that states the actual news directly, ALWAYS written in English whatever language the article is in. Do NOT describe the article — never start with meta-phrases like "The article discusses/reports/explains/covers...". Lead with the facts (who/what), as a news blurb would.',
    ),
  isGameRecap: z.boolean(),
  players: z.array(z.string()).describe('Full player names mentioned'),
  teams: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            'Club name in place-then-nickname order as an English-language league table writes it — "Rimouski Océanic", not "L\'Océanic de Rimouski"; "Québec Remparts", not "Remparts de Québec".',
          ),
        relevance: z
          .number()
          .min(0)
          .max(100)
          .describe(
            "How central this team is to THIS article: 90-100 = the article is primarily about this team; 60-89 = significantly involved; 30-59 = a notable but secondary mention; 1-29 = a passing/historical mention (e.g. a player's former team). Judge by the article's focus, not how many times the team is named.",
          ),
      }),
    )
    .describe('Teams mentioned, each with a relevance score'),
  leagues: z
    .array(z.string())
    .describe('League names only if no teams referenced'),
  category: z.enum([
    'trade',
    'signing',
    'game-recap',
    'game-preview',
    'injury',
    'prospect',
    'draft',
    'league-news',
    'opinion',
    'profile',
    'ranking',
    'schedule',
    'coaching',
    'other',
  ]),
  relevanceScore: z
    .number()
    .min(0)
    .max(100)
    .describe('Importance score: 90+ major, 70-89 notable, 50-69 routine, <50 minor'),
  timeSensitivity: z.enum(['evergreen', 'time-sensitive', 'post-event']),
  eventDate: z
    .string()
    .nullable()
    .describe('ISO date of related event, or null'),
});

export interface ScanResult {
  articlesFound: number;
  articlesSaved: number;
  articlesSkipped: number;
  /** New items rejected by the hockey topic gate. */
  articlesRejected: number;
  error?: string;
}

/**
 * Scan a single feed: fetch RSS, read full articles, analyze with LLM, save to DB.
 */
export async function scanFeed(feedId: string): Promise<ScanResult> {
  // Get feed details
  const { data: feed, error: feedError } = await supabase
    .from('article_feeds')
    .select('id, name, url, source_id, league_id, source:article_sources(name), league:leagues(name)')
    .eq('id', feedId)
    .single();

  if (feedError || !feed) {
    return { articlesFound: 0, articlesSaved: 0, articlesSkipped: 0, articlesRejected: 0, error: feedError?.message ?? 'Feed not found' };
  }

  const sourceName = (feed.source as unknown as { name: string } | null)?.name;
  const leagueHint = (feed.league as unknown as { name: string } | null)?.name;
  if (!sourceName) {
    return { articlesFound: 0, articlesSaved: 0, articlesSkipped: 0, articlesRejected: 0, error: 'Feed has no source' };
  }

  // Fetch RSS
  let items;
  try {
    items = await fetchFeed(feed.url);
  } catch (err) {
    return {
      articlesFound: 0,
      articlesSaved: 0,
      articlesSkipped: 0,
      articlesRejected: 0,
      error: `RSS fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Filter out existing articles
  const urls = items.map((item) => item.url);
  const { data: existing } = await supabase
    .from('articles')
    .select('url')
    .in('url', urls);

  const existingUrls = new Set(existing?.map((a) => a.url) ?? []);
  const newItems = items.filter((item) => !existingUrls.has(item.url));
  const skipped = items.length - newItems.length;

  let saved = 0;
  let rejected = 0;

  for (const item of newItems) {
    try {
      // Topic gate on cheap RSS metadata, before paying for a full page read.
      if (!(await isHockeyItem(item.title, lede(item.excerpt)))) {
        rejected++;
        continue;
      }

      // Read full article content
      const content = await readArticle(item.url);
      const articleText = content.success
        ? `Title: ${item.title}\n\nContent: ${content.text}`
        : `Title: ${item.title}\n\nSnippet: ${item.excerpt ?? ''}`;

      // Analyze with LLM
      const { output: analysis } = await generateText({
        model: gateway('anthropic/claude-haiku-4.5'),
        output: Output.object({ schema: articleAnalysisSchema }),
        prompt: `Analyze this sports article. First decide whether it is about ice hockey; if it is, extract entities, categorize, and score relevance.\n\n${articleText}`,
      });

      if (!analysis) continue;

      // Backstop: the full text can expose a non-hockey story the headline hid.
      if (analysis.isOtherSport) {
        rejected++;
        continue;
      }

      const title = displayTitle(item.title, analysis.language, analysis.titleEnglish);

      // Insert article
      const { data: article, error: articleError } = await supabase
        .from('articles')
        .insert({
          title,
          url: item.url,
          source_id: feed.source_id,
          excerpt: analysis.excerpt,
          published_at: item.publishedAt || new Date().toISOString(),
          author: item.author ?? null,
          image_url: item.imageUrl ?? null,
          is_game_recap: analysis.isGameRecap,
          is_global: false,
          full_content_used: content.success,
          category: analysis.category,
          relevance_score: analysis.relevanceScore,
          time_sensitivity: analysis.timeSensitivity,
          event_date: analysis.eventDate ?? null,
        })
        .select('id')
        .single();

      if (articleError) continue;

      // Resolve and insert entity tags
      const resolved = await resolveEntities(
        {
          players: analysis.players,
          teams: analysis.teams.map((t) => t.name),
          leagues: analysis.leagues,
        },
        leagueHint ?? undefined,
        feed.league_id ?? undefined,
      );

      // Map each extracted team's relevance back to its resolved id.
      const relByName = new Map(
        analysis.teams.map((t) => [t.name.toLowerCase().trim().replace(/\s+/g, ' '), t.relevance]),
      );

      const insertions = [];
      if (resolved.teamMatches.length > 0) {
        insertions.push(
          supabase.from('article_teams').insert(
            resolved.teamMatches.map((m) => ({
              article_id: article.id,
              team_id: m.id,
              relevance: relByName.get(m.name.toLowerCase().trim().replace(/\s+/g, ' ')) ?? null,
            })),
          ),
        );
      }
      if (resolved.playerIds.length > 0) {
        insertions.push(
          supabase.from('article_players').insert(
            resolved.playerIds.map((playerId) => ({
              article_id: article.id,
              player_id: playerId,
            })),
          ),
        );
      }
      if (resolved.leagueIds.length > 0) {
        insertions.push(
          supabase.from('article_leagues').insert(
            resolved.leagueIds.map((leagueId) => ({
              article_id: article.id,
              league_id: leagueId,
            })),
          ),
        );
      }
      await Promise.all(insertions);

      saved++;
    } catch {
      // Skip individual article failures, continue with next
      continue;
    }
  }

  // Update last_fetched_at on the feed
  await supabase
    .from('article_feeds')
    .update({ last_fetched_at: new Date().toISOString() })
    .eq('id', feedId);

  return {
    articlesFound: items.length,
    articlesSaved: saved,
    articlesSkipped: skipped,
    articlesRejected: rejected,
  };
}
