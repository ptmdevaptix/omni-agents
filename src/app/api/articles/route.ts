import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const teamId = params.get('teamId');
  const playerId = params.get('playerId');
  const leagueId = params.get('leagueId');
  const category = params.get('category');

  // If filtering by entity, we need to join through the relation tables
  let articleIds: number[] | null = null;

  if (teamId) {
    const { data } = await supabase
      .from('article_teams')
      .select('article_id')
      .eq('team_id', teamId);
    articleIds = data?.map((r) => r.article_id) ?? [];
  }

  if (playerId) {
    const { data } = await supabase
      .from('article_players')
      .select('article_id')
      .eq('player_id', playerId);
    const ids = data?.map((r) => r.article_id) ?? [];
    articleIds = articleIds ? articleIds.filter((id) => ids.includes(id)) : ids;
  }

  if (leagueId) {
    const { data } = await supabase
      .from('article_leagues')
      .select('article_id')
      .eq('league_id', leagueId);
    const ids = data?.map((r) => r.article_id) ?? [];
    articleIds = articleIds ? articleIds.filter((id) => ids.includes(id)) : ids;
  }

  // Build the articles query
  let query = supabase
    .from('articles')
    .select(
      '*, source:article_sources(name, short_name), article_teams(team:teams(id, place_name, nickname, league)), article_players(player:players(id, first_name, last_name)), article_leagues(league:leagues(id, name))',
    )
    .order('published_at', { ascending: false })
    .limit(200);

  if (articleIds !== null) {
    if (articleIds.length === 0) {
      return Response.json({ articles: [] });
    }
    query = query.in('id', articleIds);
  }

  if (category) {
    query = query.eq('category', category);
  }

  const { data: articles, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ articles });
}
