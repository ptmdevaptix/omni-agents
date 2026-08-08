'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AppNav } from '@/components/app-nav';
import { SlideOver } from '@/components/ui/slide-over';

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
  feeds_scanned: number | null;
  articles_found: number;
  articles_saved: number;
  articles_skipped: number;
  error_count: number | null;
  error_message: string | null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

const ACTIVE_STATUSES = ['queued', 'running', 'aborting'];

function ScanStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'queued':
      return <Badge className="bg-amber-500 text-white animate-pulse">Queued</Badge>;
    case 'running':
      return <Badge className="bg-blue-600 text-white animate-pulse">Running</Badge>;
    case 'aborting':
      return <Badge className="bg-orange-600 text-white animate-pulse">Aborting</Badge>;
    case 'completed':
      return <Badge className="bg-green-600 text-white">Completed</Badge>;
    case 'aborted':
      return <Badge className="bg-zinc-500 text-white">Aborted</Badge>;
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

function EditFeedPanel({
  feed,
  sources,
  leagues,
  teams,
  onClose,
  onChanged,
  onDirtyChange,
}: {
  feed: Feed;
  sources: Source[];
  leagues: League[];
  teams: Team[];
  onClose: () => void;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const src = Array.isArray(feed.source) ? (feed.source as unknown as Source[])[0] : feed.source;
  const lg = Array.isArray(feed.league) ? (feed.league as unknown as League[])[0] : feed.league;
  const tm = Array.isArray(feed.team) ? (feed.team as unknown as Team[])[0] : feed.team;
  const seedSource = src ? String(src.id) : '';
  const seedLeague = lg ? String(lg.id) : '';
  const seedTeam = tm ? String(tm.id) : '';

  const [name, setName] = useState(feed.name);
  const [url, setUrl] = useState(feed.url);
  const [sourceId, setSourceId] = useState(seedSource);
  const [feedType, setFeedType] = useState(feed.feed_type);
  const [leagueId, setLeagueId] = useState(seedLeague);
  const [teamId, setTeamId] = useState(seedTeam);
  const [isActive, setIsActive] = useState(feed.is_active);
  const [fetchInterval, setFetchInterval] = useState(String(feed.fetch_interval_minutes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dirty =
    name !== feed.name ||
    url !== feed.url ||
    sourceId !== seedSource ||
    feedType !== feed.feed_type ||
    leagueId !== seedLeague ||
    teamId !== seedTeam ||
    isActive !== feed.is_active ||
    fetchInterval !== String(feed.fetch_interval_minutes);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  async function save() {
    setSaving(true);
    setError('');
    const res = await fetch('/api/admin/feeds', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: feed.id,
        name,
        url,
        sourceId: sourceId ? Number(sourceId) : undefined,
        feedType,
        leagueId: leagueId || null,
        teamId: teamId || null,
        isActive,
        fetchIntervalMinutes: Number(fetchInterval) || 60,
      }),
    });
    setSaving(false);
    if (res.ok) {
      onChanged();
      onClose();
    } else {
      const d = await res.json();
      setError(d.error || 'Failed to save');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b p-4">
        <div className="min-w-0 flex-1">
          <div className="font-heading text-base font-medium">Edit feed</div>
          <div className="truncate text-xs text-muted-foreground">{feed.name}</div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <XIcon />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="space-y-1">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Feed URL</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Source</Label>
          <Select value={sourceId} onValueChange={(v) => setSourceId(v ?? '')}>
            <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Feed Type</Label>
          <Select value={feedType} onValueChange={(v) => setFeedType(v ?? 'rss')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rss">RSS</SelectItem>
              <SelectItem value="atom">Atom</SelectItem>
              <SelectItem value="podcast">Podcast</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">League (optional)</Label>
          <Select value={leagueId || 'none'} onValueChange={(v) => setLeagueId(v === 'none' ? '' : v ?? '')}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {leagues.map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Team (optional)</Label>
          <Select value={teamId || 'none'} onValueChange={(v) => setTeamId(v === 'none' ? '' : v ?? '')}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
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
        <div className="flex items-center justify-between">
          <Label className="text-xs">Active</Label>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Fetch interval (minutes)</Label>
          <Input type="number" value={fetchInterval} onChange={(e) => setFetchInterval(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="flex items-center gap-2 border-t bg-muted/50 p-4">
        {dirty && <span className="text-xs text-amber-600">unsaved edits</span>}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !dirty || !name || !url}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminFeedsPage() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [errorDetail, setErrorDetail] = useState<ScanRun | null>(null);

  // Slide-over edit panel (same pattern as the content/research admin pages).
  const [editing, setEditing] = useState<Feed | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const reportDirty = useCallback((d: boolean) => { dirtyRef.current = d; }, []);
  function openPanel(feed: Feed) {
    if (panelOpen && editing && feed.id !== editing.id && dirtyRef.current) {
      if (!window.confirm('You have unsaved edits. Discard them and open this feed?')) return;
    }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    dirtyRef.current = false;
    setEditing(feed);
    setPanelOpen(true);
  }
  function closePanel() {
    setPanelOpen(false);
    dirtyRef.current = false;
    closeTimer.current = setTimeout(() => setEditing(null), 220);
  }

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

  // A scan is "active" (queued/running/aborting) regardless of who started it —
  // the UI reflects the DB state, not just this tab's action.
  const activeRun = scanRuns.find((r) => ACTIVE_STATUSES.includes(r.status));
  const hasActiveScan = !!activeRun;

  const refreshScans = useCallback(async () => {
    const res = await fetch('/api/admin/feeds/scan');
    const data = await res.json();
    setScanRuns(data.scanRuns ?? []);
    return (data.scanRuns ?? []) as ScanRun[];
  }, []);

  // Poll while a scan is active; refresh feed data once it finishes.
  useEffect(() => {
    if (!hasActiveScan) return;
    const iv = setInterval(async () => {
      const runs = await refreshScans();
      if (!runs.some((r) => ACTIVE_STATUSES.includes(r.status))) fetchData();
    }, 5000);
    return () => clearInterval(iv);
  }, [hasActiveScan, refreshScans, fetchData]);

  async function startScan(feedId?: string) {
    const res = await fetch('/api/admin/feeds/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedId: feedId || null }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Failed to start scan');
    }
    await refreshScans();
  }

  async function abortScan() {
    if (!window.confirm('Abort the current scan? It will stop at the next feed boundary.')) return;
    await fetch('/api/admin/feeds/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'abort' }),
    });
    await refreshScans();
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
      (r) => r.feed_id === feedId && !ACTIVE_STATUSES.includes(r.status),
    );
  }

  const activeCount = feeds.filter((f) => f.is_active).length;
  const latestScan = scanRuns[0];
  const feedNameById = new Map(feeds.map((f) => [f.id, f.name]));

  return (
    <div className="flex flex-1 flex-col">
      <AppNav />
      <div
        className={cn(
          'flex flex-1 flex-col transition-[padding] duration-200',
          panelOpen && 'lg:pr-[37rem]',
        )}
      >
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
              {hasActiveScan && (
                <Button variant="destructive" onClick={abortScan}>
                  {activeRun?.status === 'aborting' ? 'Aborting…' : 'Abort scan'}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => startScan()}
                disabled={hasActiveScan}
              >
                {hasActiveScan ? 'Scanning…' : 'Scan All Feeds'}
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

      {/* Scan history */}
      <div className="px-6 pb-4">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          {showHistory ? 'Hide scan history' : `Scan history (${scanRuns.length})`}
        </button>
        {showHistory && (
          <Card className="mt-2">
            <CardContent className="p-0">
              <div className="max-h-[40vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Feeds</TableHead>
                      <TableHead className="text-right">Found</TableHead>
                      <TableHead className="text-right">Saved</TableHead>
                      <TableHead className="text-right">Skipped</TableHead>
                      <TableHead className="text-right">Errors</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scanRuns.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {new Date(r.started_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.feed_id ? feedNameById.get(r.feed_id) ?? 'feed' : 'All feeds'}
                        </TableCell>
                        <TableCell><ScanStatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-right text-sm">{r.feeds_scanned ?? '—'}</TableCell>
                        <TableCell className="text-right text-sm">{r.articles_found}</TableCell>
                        <TableCell className="text-right text-sm">{r.articles_saved}</TableCell>
                        <TableCell className="text-right text-sm">{r.articles_skipped}</TableCell>
                        <TableCell className="text-right text-sm">
                          {(r.error_count ?? 0) > 0 || r.error_message ? (
                            <button
                              type="button"
                              className="text-destructive underline underline-offset-2 hover:opacity-80"
                              onClick={() => setErrorDetail(r)}
                              title="Show errors"
                            >
                              {r.error_count ?? '≥1'}
                            </button>
                          ) : (
                            0
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {r.duration_ms != null ? formatDuration(r.duration_ms) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                    {scanRuns.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                          No scans recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

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
                    hasActiveScan &&
                    (activeRun?.feed_id === feed.id ||
                      (activeRun?.feed_id == null && feed.is_active));
                  const isOpen = panelOpen && editing?.id === feed.id;

                  return (
                    <TableRow
                      key={feed.id}
                      onClick={() => openPanel(feed)}
                      aria-selected={isOpen}
                      className={cn(
                        'cursor-pointer hover:bg-muted',
                        !feed.is_active && !isOpen && 'opacity-50',
                        isOpen && 'bg-accent hover:bg-accent',
                      )}
                    >
                      <TableCell className="relative">
                        {isOpen && <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />}
                        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={feed.is_active}
                            onCheckedChange={() => toggleActive(feed)}
                          />
                        </span>
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
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startScan(feed.id)}
                          disabled={
                            hasActiveScan ||
                            !feed.is_active ||
                            feed.feed_type === 'podcast'
                          }
                        >
                          {isFeedScanning ? 'Scanning…' : 'Scan'}
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

      {/* Scan errors detail */}
      <Dialog open={!!errorDetail} onOpenChange={(o) => !o && setErrorDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Scan errors{errorDetail?.error_count != null ? ` (${errorDetail.error_count})` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {(errorDetail?.error_message ?? '')
              .split('; ')
              .filter(Boolean)
              .map((line, i) => (
                <div key={i} className="rounded-md border bg-muted/40 p-2 text-sm">
                  {line}
                </div>
              ))}
            {!errorDetail?.error_message && (
              <p className="text-sm text-muted-foreground">No error detail recorded.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Slide-over edit panel — docks on the right and splits the view. */}
      <SlideOver open={panelOpen}>
        {editing && (
          <EditFeedPanel
            key={editing.id}
            feed={editing}
            sources={sources}
            leagues={leagues}
            teams={teams}
            onClose={closePanel}
            onChanged={fetchData}
            onDirtyChange={reportDirty}
          />
        )}
      </SlideOver>
    </div>
  );
}
