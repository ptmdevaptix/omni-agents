import { supabase } from '@/lib/supabase';

/**
 * Team-association relevance distribution + samples, to help pick a display
 * threshold for the read side. GET returns:
 *   - buckets: count of article_teams links per 0-100 relevance band
 *   - nullCount / total
 *   - samples: recent multi-team articles with each team's score
 */

const BANDS: [number, number][] = [
  [0, 9], [10, 19], [20, 29], [30, 39], [40, 49],
  [50, 59], [60, 69], [70, 79], [80, 89], [90, 100],
];

export async function GET() {
  // Distribution via exact head-counts per band (accurate regardless of size).
  const bandCounts = await Promise.all(
    BANDS.map(async ([lo, hi]) => {
      const { count } = await supabase
        .from('article_teams')
        .select('*', { count: 'exact', head: true })
        .gte('relevance', lo)
        .lte('relevance', hi);
      return { label: `${lo}-${hi}`, min: lo, max: hi, count: count ?? 0 };
    }),
  );
  const { count: nullCount } = await supabase
    .from('article_teams')
    .select('*', { count: 'exact', head: true })
    .is('relevance', null);
  const { count: total } = await supabase
    .from('article_teams')
    .select('*', { count: 'exact', head: true });

  // Samples: recent articles, then their team links (keep multi-team ones).
  const { data: recent } = await supabase
    .from('articles')
    .select('id, title, published_at')
    .order('published_at', { ascending: false })
    .limit(150);
  const ids = (recent ?? []).map((a) => a.id);
  const titleById = new Map((recent ?? []).map((a) => [a.id, a.title]));

  const { data: links } = await supabase
    .from('article_teams')
    .select('article_id, relevance, team:teams(place_name, nickname)')
    .in('article_id', ids);

  const byArticle = new Map<number, { name: string; relevance: number | null }[]>();
  for (const l of links ?? []) {
    const t = Array.isArray(l.team) ? l.team[0] : l.team;
    if (!t) continue;
    const name = t.place_name.toLowerCase().includes(t.nickname.toLowerCase())
      ? t.place_name
      : `${t.place_name} ${t.nickname}`;
    const arr = byArticle.get(l.article_id) ?? [];
    arr.push({ name, relevance: l.relevance });
    byArticle.set(l.article_id, arr);
  }

  const samples = ids
    .map((id) => ({
      id,
      title: titleById.get(id) ?? '',
      teams: (byArticle.get(id) ?? []).sort(
        (a, b) => (b.relevance ?? -1) - (a.relevance ?? -1),
      ),
    }))
    .filter((s) => s.teams.length >= 2)
    .slice(0, 60);

  return Response.json({ buckets: bandCounts, nullCount: nullCount ?? 0, total: total ?? 0, samples });
}
