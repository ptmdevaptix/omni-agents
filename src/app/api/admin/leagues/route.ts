import { supabase } from '@/lib/supabase';

/**
 * Which leagues readers ask for, and which of the ones the site carries they follow.
 *
 * Both come from omni-hockey's tables through views (database/create_league_requests.sql and
 * create_pref_telemetry.sql over there): the ask is recorded by Customize's "Request a league",
 * the usage by the preference telemetry every browser posts. Views because RLS keeps the anon key
 * this app carries out of the tables themselves; nothing in them identifies a person.
 */
export async function GET() {
  const [counts, recent, usage, activity] = await Promise.all([
    supabase.from('league_request_counts').select('*'),
    supabase.from('league_requests_recent').select('*'),
    supabase.from('pref_league_counts').select('*'),
    supabase.from('pref_league_activity_7d').select('*'),
  ]);
  const firstError = [counts, recent, usage, activity].find((r) => r.error)?.error;
  if (firstError) {
    return Response.json(
      { error: `${firstError.message} — have the views in database/create_league_requests.sql been created?` },
      { status: 500 },
    );
  }
  return Response.json({
    generatedAt: new Date().toISOString(),
    requests: { counts: counts.data ?? [], recent: recent.data ?? [] },
    usage: { leagues: usage.data ?? [], activity: activity.data ?? [] },
  });
}
