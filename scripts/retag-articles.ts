import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { generateText, Output, gateway } from 'ai';
import { z } from 'zod';
import { resolveEntities } from '../src/lib/resolve-entities';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

const entitySchema = z.object({
  teams: z.array(z.string()),
  players: z.array(z.string()),
  leagues: z.array(z.string()),
});

async function main() {
  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, excerpt, source_id')
    .order('id');

  if (!articles || articles.length === 0) {
    console.log('No articles found');
    return;
  }

  // Build a map of source_id -> league hint from feeds
  const { data: feeds } = await supabase
    .from('article_feeds')
    .select('source_id, league:leagues(name)');

  const sourceLeagueHints: Record<number, string> = {};
  if (feeds) {
    for (const f of feeds) {
      const leagueName = (f.league as unknown as { name: string } | null)?.name;
      if (leagueName && f.source_id) {
        sourceLeagueHints[f.source_id] = leagueName;
      }
    }
  }

  console.log(`Re-tagging ${articles.length} articles...`);
  let updated = 0;

  for (const article of articles) {
    const leagueHint = sourceLeagueHints[article.source_id] || undefined;

    // Ask the LLM to extract entities from title + excerpt
    const { output } = await generateText({
      model: gateway('anthropic/claude-haiku-4.5'),
      output: Output.object({ schema: entitySchema }),
      prompt: `Extract hockey entity names from this article. Return teams (use full team names like "New York Rangers" not abbreviations like "NY Rangers"), players, and leagues mentioned.\n\nTitle: ${article.title}\n\nExcerpt: ${article.excerpt ?? ''}`,
    });

    if (!output) continue;

    // Resolve entities using the main resolver with league hint
    const resolved = await resolveEntities(
      {
        players: output.players,
        teams: output.teams,
        leagues: output.leagues,
      },
      leagueHint,
    );

    // Clear existing tags for this article
    await Promise.all([
      supabase.from('article_teams').delete().eq('article_id', article.id),
      supabase.from('article_players').delete().eq('article_id', article.id),
      supabase.from('article_leagues').delete().eq('article_id', article.id),
    ]);

    // Insert new tags
    const insertions = [];
    if (resolved.teamIds.length > 0) {
      insertions.push(
        supabase.from('article_teams').insert(
          resolved.teamIds.map((id) => ({ article_id: article.id, team_id: id })),
        ),
      );
    }
    if (resolved.leagueIds.length > 0) {
      insertions.push(
        supabase.from('article_leagues').insert(
          resolved.leagueIds.map((id) => ({ article_id: article.id, league_id: id })),
        ),
      );
    }
    if (resolved.playerIds.length > 0) {
      insertions.push(
        supabase.from('article_players').insert(
          resolved.playerIds.map((id) => ({ article_id: article.id, player_id: id })),
        ),
      );
    }
    await Promise.all(insertions);

    updated++;
    const tags = resolved.teamIds.length > 0
      ? ` [${resolved.teamIds.map((id) => id.slice(0, 8)).join(', ')}]`
      : '';
    console.log(`  ${updated}/${articles.length} - ${article.title.slice(0, 60)}${tags}`);
  }

  console.log(`\nDone. Re-tagged ${updated} articles.`);
}

main().catch(console.error);
