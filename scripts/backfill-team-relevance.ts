import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { generateText, Output, gateway } from 'ai';
import { z } from 'zod';
import { fetchAll, type Rangeable } from '../src/lib/roster-moves/db';

/**
 * Backfill article_teams.relevance for existing multi-team articles by scoring
 * each association 0-100 from the stored title + excerpt (no article re-fetch).
 * Single-team articles are left null (a lone team is the article's subject, and
 * the read side treats null as visible). Idempotent: only articles that still
 * have an unscored team link are processed. Usage:
 *   npm run backfill:team-relevance            # score all remaining
 *   npm run backfill:team-relevance -- --limit 50   # just the first 50 (test)
 */

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
const CONCURRENCY = 8;

const schema = z.object({
  scores: z.array(
    z.object({
      team: z.string().describe('the team name, exactly as given in the list'),
      relevance: z
        .number()
        .min(0)
        .max(100)
        .describe(
          "How central this team is to the article: 90-100 = primarily about it; 60-89 = significantly involved; 30-59 = notable secondary mention; 1-29 = passing/historical (e.g. a player's former team).",
        ),
    }),
  ),
});

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
const teamLabel = (t: { place_name: string; nickname: string }) =>
  t.place_name.toLowerCase().includes(t.nickname.toLowerCase())
    ? t.place_name
    : `${t.place_name} ${t.nickname}`;

interface LinkRow {
  article_id: number;
  team_id: string;
  relevance: number | null;
  team: { place_name: string; nickname: string } | { place_name: string; nickname: string }[] | null;
}

async function scoreArticle(
  articleId: number,
  title: string,
  excerpt: string,
  teams: { team_id: string; label: string }[],
): Promise<number> {
  const { output } = await generateText({
    model: gateway('anthropic/claude-haiku-4.5'),
    output: Output.object({ schema }),
    prompt:
      `Score how central each listed team is to this hockey article.\n\n` +
      `Title: ${title}\nSummary: ${excerpt}\n\n` +
      `Teams: ${teams.map((t) => t.label).join(', ')}`,
  });
  if (!output) return 0;
  const byName = new Map(output.scores.map((s) => [norm(s.team), s.relevance]));
  let updated = 0;
  for (const t of teams) {
    const rel = byName.get(norm(t.label));
    if (rel == null) continue;
    const { error } = await sb
      .from('article_teams')
      .update({ relevance: Math.round(rel) })
      .eq('article_id', articleId)
      .eq('team_id', t.team_id);
    if (!error) updated += 1;
  }
  return updated;
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

  console.log('Loading article_teams + articles...');
  const links = await fetchAll<LinkRow>(
    () =>
      sb
        .from('article_teams')
        .select('article_id, team_id, relevance, team:teams(place_name, nickname)') as unknown as Rangeable<LinkRow>,
  );
  const arts = await fetchAll<{ id: number; title: string; excerpt: string | null }>(
    () => sb.from('articles').select('id, title, excerpt') as unknown as Rangeable<{ id: number; title: string; excerpt: string | null }>,
  );
  const artMap = new Map(arts.map((a) => [a.id, a]));

  // Group links by article.
  const byArticle = new Map<number, { team_id: string; label: string; relevance: number | null }[]>();
  for (const l of links) {
    const t = Array.isArray(l.team) ? l.team[0] : l.team;
    if (!t) continue;
    const arr = byArticle.get(l.article_id) ?? [];
    arr.push({ team_id: l.team_id, label: teamLabel(t), relevance: l.relevance });
    byArticle.set(l.article_id, arr);
  }

  // Multi-team articles that still have an unscored link.
  const todo = [...byArticle.entries()]
    .filter(([, teams]) => teams.length >= 2 && teams.some((t) => t.relevance == null))
    .slice(0, limit === Infinity ? undefined : limit);

  console.log(`${todo.length} multi-team articles to score (concurrency ${CONCURRENCY}).\n`);

  let done = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ([articleId, teams]) => {
        const a = artMap.get(articleId);
        if (!a) return;
        try {
          await scoreArticle(articleId, a.title, a.excerpt ?? '', teams);
          done += 1;
        } catch {
          failed += 1;
        }
      }),
    );
    if ((i / CONCURRENCY) % 10 === 0 || i + CONCURRENCY >= todo.length) {
      console.log(`  ${Math.min(i + CONCURRENCY, todo.length)}/${todo.length} (failed: ${failed})`);
    }
  }

  console.log(`\nDone. Scored ${done} articles, ${failed} failed.`);
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
