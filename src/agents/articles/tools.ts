import { tool } from 'ai';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { resolveEntities } from '@/lib/resolve-entities';
import { fetchFeed } from '@/lib/rss';
import { readArticle } from '@/lib/article-reader';

export const articleTools = {
  listFeeds: tool({
    description:
      'List available RSS feeds from the database. Optionally filter by league. Use this to discover which feeds are available before fetching.',
    inputSchema: z.object({
      leagueName: z
        .string()
        .optional()
        .describe('Filter feeds by league name (e.g. "NHL", "OHL"). Omit to list all.'),
    }),
    execute: async ({ leagueName }) => {
      let query = supabase
        .from('article_feeds')
        .select(
          'id, name, url, feed_type, is_active, last_fetched_at, source:article_sources(name), league:leagues(name)',
        )
        .eq('is_active', true)
        .order('name');

      if (leagueName) {
        query = query.eq('league.name', leagueName);
      }

      const { data, error } = await query;

      if (error) {
        return { error: error.message };
      }

      return {
        feeds: data?.map((f) => ({
          id: f.id,
          name: f.name,
          source: (f.source as unknown as { name: string } | null)?.name,
          league: (f.league as unknown as { name: string } | null)?.name ?? 'general',
          feedType: f.feed_type,
          lastFetched: f.last_fetched_at,
        })),
      };
    },
  }),

  fetchFeed: tool({
    description:
      'Fetch articles from an RSS feed. Returns the latest items. Use listFeeds first to find available feeds, then fetch by feed ID.',
    inputSchema: z.object({
      feedId: z.string().uuid().describe('The feed ID from listFeeds'),
      maxItems: z
        .number()
        .optional()
        .describe('Maximum items to return (default 20)'),
    }),
    execute: async ({ feedId, maxItems = 20 }) => {
      const { data: feed, error: feedError } = await supabase
        .from('article_feeds')
        .select(
          'id, name, url, source:article_sources(name), league:leagues(name)',
        )
        .eq('id', feedId)
        .single();

      if (feedError || !feed) {
        return { error: feedError?.message ?? 'Feed not found' };
      }

      try {
        const items = await fetchFeed(feed.url);
        const limited = items.slice(0, maxItems);

        const urls = limited.map((item) => item.url);
        const { data: existing } = await supabase
          .from('articles')
          .select('url')
          .in('url', urls);

        const existingUrls = new Set(existing?.map((a) => a.url) ?? []);
        const newItems = limited.filter((item) => !existingUrls.has(item.url));

        await supabase
          .from('article_feeds')
          .update({ last_fetched_at: new Date().toISOString() })
          .eq('id', feedId);

        return {
          feedName: feed.name,
          source: (feed.source as unknown as { name: string } | null)?.name,
          league: (feed.league as unknown as { name: string } | null)?.name ?? null,
          totalItems: limited.length,
          newItems: newItems.length,
          skippedExisting: limited.length - newItems.length,
          articles: newItems,
        };
      } catch (err) {
        return {
          error: `Failed to fetch feed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  }),

  readFullArticle: tool({
    description:
      'Fetch the full content of an article by URL. Use this after fetchFeed to read the complete article text for better entity extraction and relevance scoring. Falls back gracefully if the page is paywalled or unavailable.',
    inputSchema: z.object({
      url: z.string().url().describe('The article URL to fetch'),
    }),
    execute: async ({ url }) => {
      const result = await readArticle(url);

      if (!result.success) {
        return {
          success: false,
          message:
            'Could not extract article content. Use the RSS snippet for processing.',
        };
      }

      return {
        success: true,
        content: result.text,
        truncated: result.truncated,
      };
    },
  }),

  saveArticle: tool({
    description:
      'Save a discovered article to the database with entity tags, relevance scoring, and time sensitivity assessment.',
    inputSchema: z.object({
      title: z.string().describe('The article title'),
      url: z.string().url().describe('The article URL'),
      sourceName: z.string().describe('The source/publisher name'),
      excerpt: z
        .string()
        .describe(
          'A concise 1-3 sentence summary of the article. Write this yourself based on the full content if available.',
        ),
      publishedAt: z.string().describe('ISO 8601 publication date'),
      author: z.string().optional().describe('The article author, if known'),
      imageUrl: z
        .string()
        .url()
        .optional()
        .describe('Article hero/thumbnail image URL, if available'),
      isGameRecap: z
        .boolean()
        .optional()
        .describe('Whether this article is a game recap'),
      fullContentUsed: z
        .boolean()
        .describe('Whether the full article content was successfully read'),

      // Entity extraction
      players: z
        .array(z.string())
        .describe('Full names of players mentioned (e.g. "Connor McDavid")'),
      teams: z
        .array(z.string())
        .describe(
          'Team names mentioned — full name (e.g. "Edmonton Oilers"), nickname ("Oilers"), or abbreviation ("EDM")',
        ),
      leagues: z
        .array(z.string())
        .describe(
          'League names only if no specific team is referenced. Omit if teams are provided — leagues will be inferred.',
        ),

      // Relevance and categorization
      category: z
        .enum([
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
        ])
        .describe('The primary category of this article'),
      relevanceScore: z
        .number()
        .min(0)
        .max(100)
        .describe(
          'How important/notable is this article (0-100). 90+: major trade, top draft pick. 70-89: notable signing, key injury, playoff result. 50-69: regular game recap, roster move. 30-49: minor news, press release. 0-29: low-value or tangentially related.',
        ),
      timeSensitivity: z
        .enum(['evergreen', 'time-sensitive', 'post-event'])
        .describe(
          'evergreen: stays relevant (profiles, rankings, opinion). time-sensitive: about an upcoming event, decays after event_date. post-event: about something that just happened, decays gradually.',
        ),
      eventDate: z
        .string()
        .optional()
        .describe(
          'ISO 8601 date of the related event, if time-sensitive or post-event (e.g. the game date, trade deadline). Omit for evergreen.',
        ),
    }),
    execute: async (input) => {
      // 1. Resolve the article source
      const { data: source, error: sourceError } = await supabase
        .from('article_sources')
        .select('id')
        .eq('name', input.sourceName)
        .maybeSingle();

      if (sourceError) {
        return { saved: false, error: `Source lookup failed: ${sourceError.message}` };
      }

      if (!source) {
        return {
          saved: false,
          error: `Unknown source "${input.sourceName}". The source must exist in article_sources.`,
        };
      }

      // 2. Insert the article
      const { data: article, error: articleError } = await supabase
        .from('articles')
        .insert({
          title: input.title,
          url: input.url,
          source_id: source.id,
          excerpt: input.excerpt,
          published_at: input.publishedAt,
          author: input.author ?? null,
          image_url: input.imageUrl ?? null,
          is_game_recap: input.isGameRecap ?? false,
          is_global: false,
          full_content_used: input.fullContentUsed,
          category: input.category,
          relevance_score: input.relevanceScore,
          time_sensitivity: input.timeSensitivity,
          event_date: input.eventDate ?? null,
        })
        .select('id')
        .single();

      if (articleError) {
        return { saved: false, error: `Article insert failed: ${articleError.message}` };
      }

      // 3. Resolve entities
      const resolved = await resolveEntities({
        players: input.players,
        teams: input.teams,
        leagues: input.leagues,
      });

      // 4. Insert join table rows
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

      // 5. Return results
      const hasUnresolved =
        resolved.unresolvedPlayers.length > 0 ||
        resolved.unresolvedTeams.length > 0 ||
        resolved.unresolvedLeagues.length > 0;

      return {
        saved: true,
        articleId: article.id,
        category: input.category,
        relevanceScore: input.relevanceScore,
        timeSensitivity: input.timeSensitivity,
        tagged: {
          teams: resolved.teamIds.length,
          players: resolved.playerIds.length,
          leagues: resolved.leagueIds.length,
        },
        ...(hasUnresolved && {
          unresolved: {
            players: resolved.unresolvedPlayers,
            teams: resolved.unresolvedTeams,
            leagues: resolved.unresolvedLeagues,
          },
        }),
      };
    },
  }),
};
