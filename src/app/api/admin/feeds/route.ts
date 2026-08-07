import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('article_feeds')
    .select(
      'id, name, url, feed_type, is_active, fetch_interval_minutes, last_fetched_at, source_id, source:article_sources(id, name), league:leagues(id, name), team:teams(id, place_name, nickname)',
    )
    .order('name');

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Count articles per source. A plain `select('source_id')` is capped at 1000
  // rows by PostgREST, which silently undercounts once the table grows past that
  // (it did — >10k rows), so most feeds showed 0. Use an exact head-count per
  // distinct source instead.
  const sourceIds = [...new Set((data ?? []).map((f) => f.source_id).filter((v): v is number => v != null))];
  const countPairs = await Promise.all(
    sourceIds.map(async (sid) => {
      const { count } = await supabase
        .from('articles')
        .select('*', { count: 'exact', head: true })
        .eq('source_id', sid);
      return [sid, count ?? 0] as const;
    }),
  );
  const articleCounts: Record<number, number> = Object.fromEntries(countPairs);

  // Attach article count to each feed based on its source_id
  const feedsWithCounts = data?.map((f) => ({
    ...f,
    article_count: articleCounts[f.source_id] ?? 0,
  }));

  // Also return sources and leagues for the add/edit forms
  const [sourcesResult, leaguesResult, teamsResult] = await Promise.all([
    supabase.from('article_sources').select('id, name').order('name'),
    supabase.from('leagues').select('id, name').order('name'),
    supabase
      .from('teams')
      .select('id, place_name, nickname, league')
      .order('place_name'),
  ]);

  return Response.json({
    feeds: feedsWithCounts,
    sources: sourcesResult.data ?? [],
    leagues: leaguesResult.data ?? [],
    teams: teamsResult.data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const { data, error } = await supabase
    .from('article_feeds')
    .insert({
      name: body.name,
      url: body.url,
      source_id: body.sourceId,
      feed_type: body.feedType || 'rss',
      league_id: body.leagueId || null,
      team_id: body.teamId || null,
      is_active: true,
      fetch_interval_minutes: body.fetchIntervalMinutes || 60,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ feed: data });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...updates } = body;

  // Map camelCase to snake_case
  const dbUpdates: Record<string, unknown> = {};
  if ('name' in updates) dbUpdates.name = updates.name;
  if ('url' in updates) dbUpdates.url = updates.url;
  if ('sourceId' in updates) dbUpdates.source_id = updates.sourceId;
  if ('feedType' in updates) dbUpdates.feed_type = updates.feedType;
  if ('leagueId' in updates) dbUpdates.league_id = updates.leagueId || null;
  if ('teamId' in updates) dbUpdates.team_id = updates.teamId || null;
  if ('isActive' in updates) dbUpdates.is_active = updates.isActive;
  if ('fetchIntervalMinutes' in updates)
    dbUpdates.fetch_interval_minutes = updates.fetchIntervalMinutes;

  const { error } = await supabase
    .from('article_feeds')
    .update(dbUpdates)
    .eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ success: true });
}
