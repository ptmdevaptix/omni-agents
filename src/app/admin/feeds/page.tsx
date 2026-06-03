'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { AppNav } from '@/components/app-nav';

function teamDisplayName(placeName: string, nickname: string): string {
  if (placeName.toLowerCase().includes(nickname.toLowerCase())) {
    return placeName;
  }
  return `${placeName} ${nickname}`;
}
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Feed {
  id: string;
  name: string;
  url: string;
  feed_type: string;
  is_active: boolean;
  fetch_interval_minutes: number;
  last_fetched_at: string | null;
  source: { id: number; name: string } | null;
  league: { id: string; name: string } | null;
  team: { id: string; place_name: string; nickname: string } | null;
  article_count: number;
}

interface Source {
  id: number;
  name: string;
}

interface League {
  id: string;
  name: string;
}

interface Team {
  id: string;
  place_name: string;
  nickname: string;
  league: string;
}

interface ScanRun {
  id: string;
  feed_id: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  articles_found: number;
  articles_saved: number;
  articles_skipped: number;
  error_message: string | null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function ScanStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Badge className="bg-blue-600 text-white animate-pulse">Running</Badge>;
    case 'completed':
      return <Badge className="bg-green-600 text-white">Completed</Badge>;
    case 'failed':
      return <Badge className="bg-red-600 text-white">Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function AddFeedDialog({
  sources,
  leagues,
  teams,
  onSaved,
}: {
  sources: Source[];
  leagues: League[];
  teams: Team[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [creatingSource, setCreatingSource] = useState(false);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceShortName, setNewSourceShortName] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [feedType, setFeedType] = useState('rss');
  const [leagueId, setLeagueId] = useState('');
  const [teamId, setTeamId] = useState('');

  function reset() {
    setName('');
    setUrl('');
    setSourceId('');
    setNewSourceName('');
    setNewSourceShortName('');
    setNewSourceUrl('');
    setCreatingSource(false);
    setFeedType('rss');
    setLeagueId('');
    setTeamId('');
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    let resolvedSourceId = sourceId ? Number(sourceId) : null;

    // Create new source if needed
    if (creatingSource && newSourceName) {
      const sourceRes = await fetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSourceName,
          shortName: newSourceShortName || newSourceName,
          homepageUrl: newSourceUrl || null,
        }),
      });

      if (!sourceRes.ok) {
        const data = await sourceRes.json();
        setError(data.error || 'Failed to create source');
        setSaving(false);
        return;
      }

      const { source } = await sourceRes.json();
      resolvedSourceId = source.id;
    }

    if (!resolvedSourceId) {
      setError('Please select or create a source');
      setSaving(false);
      return;
    }

    const res = await fetch('/api/admin/feeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        url,
        sourceId: resolvedSourceId,
        feedType,
        leagueId: leagueId || null,
        teamId: teamId || null,
      }),
    });

    if (res.ok) {
      reset();
      setOpen(false);
      onSaved();
    } else {
      const data = await res.json();
      setError(data.error || 'Failed to add feed');
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Add Feed</Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Feed</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="feed-name">Name</Label>
            <Input
              id="feed-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. THW Bruins"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="feed-url">Feed URL</Label>
            <Input
              id="feed-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Source</Label>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => {
                  setCreatingSource(!creatingSource);
                  setSourceId('');
                  setNewSourceName('');
                  setNewSourceShortName('');
                  setNewSourceUrl('');
                }}
              >
                {creatingSource ? 'Use existing' : 'Create new'}
              </button>
            </div>
            {creatingSource ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="space-y-1">
                  <Label htmlFor="new-source-name" className="text-xs">Name</Label>
                  <Input
                    id="new-source-name"
                    value={newSourceName}
                    onChange={(e) => setNewSourceName(e.target.value)}
                    placeholder="e.g. Daily Faceoff"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-source-short" className="text-xs">Short Name</Label>
                  <Input
                    id="new-source-short"
                    value={newSourceShortName}
                    onChange={(e) => setNewSourceShortName(e.target.value)}
                    placeholder="e.g. DFO"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-source-url" className="text-xs">Homepage URL (optional)</Label>
                  <Input
                    id="new-source-url"
                    value={newSourceUrl}
                    onChange={(e) => setNewSourceUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>
            ) : (
              <Select value={sourceId} onValueChange={(v) => setSourceId(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label>Feed Type</Label>
            <Select value={feedType} onValueChange={(v) => setFeedType(v ?? 'rss')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rss">RSS</SelectItem>
                <SelectItem value="atom">Atom</SelectItem>
                <SelectItem value="podcast">Podcast</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>League (optional)</Label>
            <Select value={leagueId} onValueChange={(v) => setLeagueId(v === 'none' ? '' : v ?? '')}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {leagues.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Team (optional)</Label>
            <Select value={teamId} onValueChange={(v) => setTeamId(v === 'none' ? '' : v ?? '')}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {teamDisplayName(t.place_name, t.nickname)} ({t.league})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name || !url || (!sourceId && !newSourceName)}>
              {saving ? 'Adding...' : 'Add Feed'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminFeedsPage() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null); // feedId or 'all'
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    const [feedsRes, scansRes] = await Promise.all([
      fetch('/api/admin/feeds'),
      fetch('/api/admin/feeds/scan'),
    ]);
    const feedsData = await feedsRes.json();
    const scansData = await scansRes.json();
    setFeeds(feedsData.feeds ?? []);
    setSources(feedsData.sources ?? []);
    setLeagues(feedsData.leagues ?? []);
    setTeams(feedsData.teams ?? []);
    setScanRuns(scansData.scanRuns ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll for scan updates while a scan is running
  useEffect(() => {
    if (scanning) {
      pollRef.current = setInterval(async () => {
        const res = await fetch('/api/admin/feeds/scan');
        const data = await res.json();
        setScanRuns(data.scanRuns ?? []);

        // Check if the running scan completed
        const hasRunning = (data.scanRuns ?? []).some(
          (r: ScanRun) => r.status === 'running',
        );
        if (!hasRunning) {
          setScanning(null);
          fetchData(); // refresh article counts
        }
      }, 5000);

      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [scanning, fetchData]);

  async function startScan(feedId?: string) {
    const key = feedId || 'all';
    setScanning(key);

    await fetch('/api/admin/feeds/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedId: feedId || null }),
    });

    // Immediately fetch scan runs to show the new running entry
    const res = await fetch('/api/admin/feeds/scan');
    const data = await res.json();
    setScanRuns(data.scanRuns ?? []);
  }

  async function toggleActive(feed: Feed) {
    await fetch('/api/admin/feeds', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: feed.id, isActive: !feed.is_active }),
    });
    fetchData();
  }

  function getLastScanForFeed(feedId: string): ScanRun | undefined {
    return scanRuns.find(
      (r) => r.feed_id === feedId && r.status !== 'running',
    );
  }

  const activeCount = feeds.filter((f) => f.is_active).length;
  const latestScan = scanRuns[0];
  const hasRunningScan = scanRuns.some((r) => r.status === 'running');

  return (
    <div className="flex flex-1 flex-col">
      <AppNav />
      <div className="px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Manage Feeds</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Loading...'
              : `${feeds.length} feeds (${activeCount} active)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && (
            <>
              <Button
                variant="outline"
                onClick={() => startScan()}
                disabled={hasRunningScan}
              >
                {hasRunningScan ? 'Scanning...' : 'Scan All Feeds'}
              </Button>
              <AddFeedDialog
                sources={sources}
                leagues={leagues}
                teams={teams}
                onSaved={fetchData}
              />
            </>
          )}
        </div>
      </div>

      {/* Latest scan summary */}
      {latestScan && (
        <div className="px-6 pb-4">
          <Card>
            <CardContent className="py-3 px-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Last scan:</span>
                <ScanStatusBadge status={latestScan.status} />
                {latestScan.completed_at && (
                  <span className="text-sm text-muted-foreground">
                    {new Date(latestScan.completed_at).toLocaleString()}
                  </span>
                )}
                {latestScan.duration_ms !== null && (
                  <span className="text-sm text-muted-foreground">
                    ({formatDuration(latestScan.duration_ms)})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span>
                  Found: <strong>{latestScan.articles_found}</strong>
                </span>
                <span>
                  Saved: <strong>{latestScan.articles_saved}</strong>
                </span>
                <span>
                  Skipped: <strong>{latestScan.articles_skipped}</strong>
                </span>
                {latestScan.error_message && (
                  <span className="text-destructive text-xs max-w-[300px] truncate">
                    {latestScan.error_message}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />

      <div className="flex-1 px-6 py-4 overflow-auto">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Active</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>League / Team</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Articles</TableHead>
                  <TableHead>Last Fetched</TableHead>
                  <TableHead>Last Scan</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feeds.map((feed) => {
                  const source = Array.isArray(feed.source)
                    ? (feed.source as unknown as Source[])[0]
                    : feed.source;
                  const league = Array.isArray(feed.league)
                    ? (feed.league as unknown as League[])[0]
                    : feed.league;
                  const team = Array.isArray(feed.team)
                    ? (feed.team as unknown as Team[])[0]
                    : feed.team;
                  const lastScan = getLastScanForFeed(feed.id);
                  const isFeedScanning =
                    scanning === feed.id ||
                    (scanning === 'all' && feed.is_active);

                  return (
                    <TableRow
                      key={feed.id}
                      className={feed.is_active ? '' : 'opacity-50'}
                    >
                      <TableCell>
                        <Switch
                          checked={feed.is_active}
                          onCheckedChange={() => toggleActive(feed)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{feed.name}</TableCell>
                      <TableCell>{source?.name ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {league && (
                            <Badge variant="outline" className="text-xs">
                              {league.name}
                            </Badge>
                          )}
                          {team && (
                            <Badge variant="secondary" className="text-xs">
                              {teamDisplayName(team.place_name, team.nickname)}
                            </Badge>
                          )}
                          {!league && !team && (
                            <span className="text-muted-foreground text-xs">
                              General
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {feed.feed_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {feed.article_count}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {feed.last_fetched_at
                          ? new Date(feed.last_fetched_at).toLocaleString()
                          : 'Never'}
                      </TableCell>
                      <TableCell>
                        {lastScan ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-muted-foreground">
                              {lastScan.articles_saved} saved
                              {lastScan.duration_ms !== null &&
                                ` in ${formatDuration(lastScan.duration_ms)}`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startScan(feed.id)}
                          disabled={
                            hasRunningScan ||
                            !feed.is_active ||
                            feed.feed_type === 'podcast'
                          }
                        >
                          {isFeedScanning ? 'Scanning...' : 'Scan'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
