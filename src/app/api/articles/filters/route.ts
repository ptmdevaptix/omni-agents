import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

export async function GET() {
  const [teamsResult, leaguesResult, playersResult] = await Promise.all([
    supabase
      .from('teams')
      .select('id, place_name, nickname, league')
      .order('place_name'),
    supabase.from('leagues').select('id, name, parent_league_id, country').order('name'),
    supabase
      .from('players')
      .select('id, first_name, last_name')
      .order('last_name'),
  ]);

  return Response.json({
    teams: teamsResult.data ?? [],
    leagues: leaguesResult.data ?? [],
    players: playersResult.data ?? [],
    categories: [
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
    ],
  });
}
