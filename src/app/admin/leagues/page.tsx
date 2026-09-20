'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Leagues: what readers ask for beside what they use.
 *
 * The left answers "what should we build next" — every league requested through Customize's
 * "Request a league", with what the requester already follows as context (a Swiss ask from someone
 * who follows the SHL and Liiga reads differently from one who follows only the NHL). The right
 * answers "is the last thing we built being used" — followers per league among browsers that have
 * customized their leagues, and the week's follows and unfollows.
 */

interface RequestCount { league_key: string; league_label: string; requests: number; browsers: number; last_at: string }
interface RecentRequest { id: number; league_key: string; league_label: string; other_text: string | null; followed: string[]; region: string | null; created_at: string }
interface LeagueUsage { league: string; users: number }
interface Activity { league: string; action: 'add' | 'remove'; count: number }

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function LeaguesPage() {
  const [counts, setCounts] = useState<RequestCount[]>([]);
  const [recent, setRecent] = useState<RecentRequest[]>([]);
  const [usage, setUsage] = useState<LeagueUsage[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/admin/leagues');
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? 'Failed to load'); setLoading(false); return; }
      setCounts(d.requests?.counts ?? []);
      setRecent(d.requests?.recent ?? []);
      setUsage(d.usage?.leagues ?? []);
      setActivity(d.usage?.activity ?? []);
      setLoading(false);
    })();
  }, []);

  const adds = useMemo(() => new Map(activity.filter((a) => a.action === 'add').map((a) => [a.league, a.count])), [activity]);
  const removes = useMemo(() => new Map(activity.filter((a) => a.action === 'remove').map((a) => [a.league, a.count])), [activity]);
  const totalRequests = counts.reduce((n, c) => n + c.requests, 0);

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Leagues</h1>
          <p className="text-sm text-muted-foreground">
            What readers ask for, and which of the leagues we carry they follow. Requests come from Customize on omnihockey.com; usage from the preference telemetry.
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!loading && !error && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Requested leagues <Badge variant="secondary" className="ml-1">{totalRequests}</Badge>
              </h2>
              <Card>
                <CardContent className="p-0">
                  {counts.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No requests yet.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr><th className="px-4 py-2">League</th><th className="px-4 py-2 text-right">Requests</th><th className="px-4 py-2 text-right">Browsers</th><th className="px-4 py-2">Last</th></tr>
                      </thead>
                      <tbody>
                        {counts.map((c) => (
                          <tr key={c.league_key} className="border-t">
                            <td className="px-4 py-2 font-medium">
                              {c.league_label}
                              {c.league_key === 'other' && <span className="ml-1 text-xs text-muted-foreground">typed — see the list</span>}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">{c.requests}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{c.browsers || '—'}</td>
                            <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{when(c.last_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest asks</h3>
              <Card>
                <CardContent className="p-0">
                  {recent.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">Nothing yet.</p>
                  ) : (
                    <ul className="divide-y">
                      {recent.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm">
                          <span className="font-medium">{r.league_key === 'other' ? `Other: ${r.other_text}` : r.league_label}</span>
                          <span className="text-xs text-muted-foreground">
                            follows {r.followed?.length ? r.followed.join(', ') : '—'}{r.region ? ` · ${r.region}` : ''}
                          </span>
                          <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">{when(r.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">League usage</h2>
              <p className="text-xs text-muted-foreground">
                Followers among browsers that have customized their leagues (the default set is not counted). Adds and removes are the last 7 days, first-snapshot adds excluded.
              </p>
              <Card>
                <CardContent className="p-0">
                  {usage.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No customized browsers reporting yet.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr><th className="px-4 py-2">League</th><th className="px-4 py-2 text-right">Followers</th><th className="px-4 py-2 text-right">Adds 7d</th><th className="px-4 py-2 text-right">Removes 7d</th></tr>
                      </thead>
                      <tbody>
                        {usage.map((u) => (
                          <tr key={u.league} className="border-t">
                            <td className="px-4 py-2 font-medium">{u.league}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{u.users}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-emerald-500">{adds.get(u.league) ?? '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{removes.get(u.league) ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
