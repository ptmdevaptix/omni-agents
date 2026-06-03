import { generateText, Output, gateway } from 'ai';
import { z } from 'zod';
import { supabase } from './supabase';
import { fetchFeed } from './rss';
import { readArticle } from './article-reader';
import { resolveEntities } from './resolve-entities';

const articleAnalysisSchema = z.object({
  excerpt: z
    .string()
    .describe(
      'A natural, news-style summary in 1-3 sentences that states the actual news directly. Do NOT describe the article — never start with meta-phrases like "The article discusses/reports/explains/covers...". Lead with the facts (who/what), as a news blurb would.',
    ),
  isGameRecap: z.boolean(),
  players: z.array(z.string()).describe('Full player names mentioned'),
  teams: z.array(z.string()).describe('Team names mentioned'),
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
    return { articlesFound: 0, articlesSaved: 0, articlesSkipped: 0, error: feedError?.message ?? 'Feed not found' };
  }

  const sourceName = (feed.source as unknown as { name: string } | null)?.name;
  const leagueHint = (feed.league as unknown as { name: string } | null)?.name;
  if (!sourceName) {
    return { articlesFound: 0, articlesSaved: 0, articlesSkipped: 0, error: 'Feed has no source' };
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

  for (const item of newItems) {
    try {
      // Read full article content
      const content = await readArticle(item.url);
      const articleText = content.success
        ? `Title: ${item.title}\n\nContent: ${content.text}`
        : `Title: ${item.title}\n\nSnippet: ${item.excerpt ?? ''}`;

      // Analyze with LLM
      const { output: analysis } = await generateText({
        model: gateway('anthropic/claude-haiku-4.5'),
        output: Output.object({ schema: articleAnalysisSchema }),
        prompt: `Analyze this hockey article. Extract entities, categorize, and score relevance.\n\n${articleText}`,
      });

      if (!analysis) continue;

      // Insert article
      const { data: article, error: articleError } = await supabase
        .from('articles')
        .insert({
          title: item.title,
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
          teams: analysis.teams,
          leagues: analysis.leagues,
        },
        leagueHint ?? undefined,
        feed.league_id ?? undefined,
      );

      const insertions = [];
      if (resolved.teamIds.length > 0) {
        insertions.push(
          supabase.from('article_teams').insert(
            resolved.teamIds.map((teamId) => ({
              article_id: article.id,
              team_id: teamId,
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
  };
}
