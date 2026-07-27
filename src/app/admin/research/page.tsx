'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { AppNav } from '@/components/app-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ---- types (mirror the research-queue contract) ----
interface NhlCandidate {
  nhlId: string;
  name: string;
  pos?: string;
}
interface TaskState {
  status: string;
  assignee: string | null;
  notes: string | null;
  resolution: unknown;
  resolved_at: string | null;
}
interface Item {
  dedup_key: string;
  reason: string;
  priority: number;
  seo: string;
  team_name: string | null;
  player_name: string;
  norm_name: string;
  season: string;
  source: string;
  position: string | null;
  class_year: number | null;
  missing_fields: string[] | null;
  prior_team: string | null;
  prior_league: string | null;
  nhl_candidates: NhlCandidate[];
  hints: Record<string, unknown>;
  detected_at: string;
  state: TaskState | null;
  orphaned: boolean;
}
interface AliasRow {
  id: number;
  alias_norm: string;
  seo: string | null;
  nhl_id: string | null;
  canonical_name: string | null;
  note: string | null;
  active: boolean;
}
interface SuppressionRow {
  id: number;
  seo: string;
  player_norm: string;
  reason: string | null;
  active: boolean;
}

const REASON_LABEL: Record<string, string> = {
  missing_data: 'Missing data',
  no_player_page: 'No player page',
  resolved_upstream: 'Resolved upstream',
};

function ReasonBadge({ reason }: { reason: string }) {
  const cls: Record<string, string> = {
    missing_data: 'bg-amber-600 text-white',
    no_player_page: 'bg-blue-600 text-white',
    resolved_upstream: 'bg-green-700 text-white',
  };
  return <Badge className={cls[reason] ?? ''}>{REASON_LABEL[reason] ?? reason}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'in_progress':
      return <Badge className="bg-blue-600 text-white">In progress</Badge>;
    case 'resolved':
      return <Badge className="bg-green-600 text-white">Resolved</Badge>;
    case 'dismissed':
      return <Badge variant="outline">Dismissed</Badge>;
    default:
      return <Badge variant="outline">Open</Badge>;
  }
}

function effectiveStatus(item: Item): string {
  if (item.orphaned) return 'resolved';
  return item.state?.status ?? 'open';
}

// ---- Resolve dialog ----
type ResolveMode = 'bio' | 'alias' | 'suppress' | 'note';
const MODE_LABEL: Record<ResolveMode, string> = {
  bio: 'Fill bio',
  alias: 'Link',
  suppress: 'Remove from roster',
  note: 'Note',
};

function ResolveDialog({ item, onResolved }: { item: Item; onResolved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ResolveMode>('bio');

  const [nhlId, setNhlId] = useState('');
  const [canonicalName, setCanonicalName] = useState('');
  const [note, setNote] = useState('');
  // bio fields
  const [position, setPosition] = useState('');
  const [classYear, setClassYear] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [weightLbs, setWeightLbs] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [hometown, setHometown] = useState('');
  const [originCountry, setOriginCountry] = useState('');

  const missing = item.missing_fields ?? [];

  function openDialog() {
    // missing_data ⇒ fill the gaps; no_player_page ⇒ link to an NHL id.
    setMode(item.reason === 'missing_data' ? 'bio' : 'alias');
    setNhlId('');
    setCanonicalName('');
    setNote('');
    setPosition(item.position ?? '');
    setClassYear(item.class_year ? String(item.class_year) : '');
    setHeightInches('');
    setWeightLbs('');
    setBirthDate('');
    setHometown('');
    setOriginCountry('');
    setError('');
    setOpen(true);
  }

  async function submit() {
    setSaving(true);
    setError('');
    const payload: Record<string, unknown> = { dedupKey: item.dedup_key, kind: mode };
    if (mode === 'alias') {
      payload.aliasNorm = item.norm_name;
      payload.seo = item.seo;
      payload.nhlId = nhlId || null;
      payload.canonicalName = canonicalName || null;
      payload.note = `Resolved from research queue (${item.reason})`;
    } else if (mode === 'bio') {
      payload.playerNorm = item.norm_name;
      payload.seo = item.seo;
      payload.position = position || undefined;
      payload.classYear = classYear ? Number(classYear) : undefined;
      payload.heightInches = heightInches ? Number(heightInches) : undefined;
      payload.weightLbs = weightLbs ? Number(weightLbs) : undefined;
      payload.birthDate = birthDate || undefined;
      payload.hometown = hometown || undefined;
      payload.originCountry = originCountry || undefined;
    } else if (mode === 'suppress') {
      payload.seo = item.seo;
      payload.playerNorm = item.norm_name;
      payload.playerName = item.player_name;
      payload.reason = note || 'Not attending / left (research queue)';
    } else {
      payload.note = note || null;
    }
    const res = await fetch('/api/admin/research/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setOpen(false);
      onResolved();
    } else {
      setError((await res.json()).error ?? 'Failed to resolve');
    }
    setSaving(false);
  }

  const fieldHint = (f: string) =>
    missing.includes(f) ? <span className="text-amber-500"> (missing)</span> : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={openDialog}>
        Resolve
      </Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Resolve — {item.player_name}{' '}
            <span className="text-muted-foreground font-normal">({item.seo})</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 flex-wrap">
          {(['bio', 'alias', 'suppress', 'note'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-md text-sm ${
                mode === m ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        {mode === 'bio' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Writes <code>player_bio_overrides</code> (player_norm=<code>{item.norm_name}</code>, seo=
              <code>{item.seo}</code>). Only filled fields are written; they win over resolved data.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Position{fieldHint('position')}</Label>
                <Select value={position || 'none'} onValueChange={(v) => setPosition(v === 'none' ? '' : v ?? '')}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    <SelectItem value="F">F</SelectItem>
                    <SelectItem value="D">D</SelectItem>
                    <SelectItem value="G">G</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Class year</Label>
                <Select value={classYear || 'none'} onValueChange={(v) => setClassYear(v === 'none' ? '' : v ?? '')}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    <SelectItem value="1">Fr</SelectItem>
                    <SelectItem value="2">So</SelectItem>
                    <SelectItem value="3">Jr</SelectItem>
                    <SelectItem value="4">Sr</SelectItem>
                    <SelectItem value="5">Gr</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="bd" className="text-xs">Birthdate{fieldHint('birthdate')}</Label>
                <Input id="bd" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ht" className="text-xs">Height (inches){fieldHint('height')}</Label>
                <Input id="ht" type="number" value={heightInches} onChange={(e) => setHeightInches(e.target.value)} placeholder="e.g. 72" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="wt" className="text-xs">Weight (lbs){fieldHint('weight')}</Label>
                <Input id="wt" type="number" value={weightLbs} onChange={(e) => setWeightLbs(e.target.value)} placeholder="e.g. 190" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="hometown" className="text-xs">Hometown{fieldHint('hometown')}</Label>
                <Input id="hometown" value={hometown} onChange={(e) => setHometown(e.target.value)} placeholder="City, ST/Prov." />
              </div>
              <div className="space-y-1">
                <Label htmlFor="country" className="text-xs">Country</Label>
                <Input id="country" value={originCountry} onChange={(e) => setOriginCountry(e.target.value)} placeholder="e.g. Canada" />
              </div>
            </div>
          </div>
        )}

        {mode === 'alias' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Writes <code>player_aliases</code> (alias_norm=<code>{item.norm_name}</code>, seo=
              <code>{item.seo}</code>). NHL id is most robust; otherwise a canonical spelling that
              resolves at NHL/EP.
            </p>
            {item.nhl_candidates.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Pick the NHL candidate</Label>
                <div className="rounded-md border divide-y">
                  {item.nhl_candidates.map((c) => (
                    <label key={c.nhlId} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="nhlpick"
                        checked={nhlId === c.nhlId}
                        onChange={() => setNhlId(c.nhlId)}
                      />
                      <span>{c.name}</span>
                      {c.pos && <span className="text-muted-foreground">{c.pos}</span>}
                      <span className="ml-auto text-muted-foreground">{c.nhlId}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="nhlid" className="text-xs">NHL id</Label>
              <Input id="nhlid" value={nhlId} onChange={(e) => setNhlId(e.target.value)} placeholder="e.g. 8486099" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="canon" className="text-xs">or canonical spelling</Label>
              <Input id="canon" value={canonicalName} onChange={(e) => setCanonicalName(e.target.value)} placeholder="e.g. Yegor Shilov" />
            </div>
          </div>
        )}

        {mode === 'suppress' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Writes <code>ncaa_suppressions</code> (seo=<code>{item.seo}</code>, player_norm=
              <code>{item.norm_name}</code>) — removes the player from this team&apos;s roster + Changes,
              and flags any matching incoming move as suppressed.
            </p>
            <div className="space-y-1">
              <Label htmlFor="supreason" className="text-xs">Reason</Label>
              <Input id="supreason" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Signed NHL ELC; will not attend" />
            </div>
          </div>
        )}

        {mode === 'note' && (
          <div className="space-y-1">
            <Label htmlFor="notefield" className="text-xs">Note (no override written)</Label>
            <textarea
              id="notefield"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              placeholder="e.g. bio re-pull requested"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Resolve'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Notes/assignee inline editor ----
function NotesCell({ item, onSaved }: { item: Item; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [assignee, setAssignee] = useState(item.state?.assignee ?? '');
  const [notes, setNotes] = useState(item.state?.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch('/api/admin/research', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dedupKey: item.dedup_key, assignee, notes }),
    });
    setSaving(false);
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground underline"
        onClick={() => setOpen(true)}
      >
        {item.state?.notes || item.state?.assignee ? 'edit' : 'add'}
      </button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Notes — {item.player_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="assignee" className="text-xs">Assignee</Label>
            <Input id="assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes" className="text-xs">Notes</Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Overrides panel ----
// ---- Add-alias dialog (standalone: alias one spelling to a canonical / NHL id) ----
function AddAliasDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [aliasName, setAliasName] = useState('');
  const [canonicalName, setCanonicalName] = useState('');
  const [nhlId, setNhlId] = useState('');
  const [seo, setSeo] = useState('');
  const [note, setNote] = useState('');

  function openDialog() {
    setAliasName('');
    setCanonicalName('');
    setNhlId('');
    setSeo('');
    setNote('');
    setError('');
    setOpen(true);
  }

  async function submit() {
    setSaving(true);
    setError('');
    const res = await fetch('/api/admin/research/overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'player_aliases',
        aliasName,
        canonicalName: canonicalName || null,
        nhlId: nhlId || null,
        seo: seo || null,
        note: note || null,
      }),
    });
    if (res.ok) {
      setOpen(false);
      onSaved();
    } else {
      setError((await res.json()).error ?? 'Failed to add alias');
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={openDialog}>Add alias</Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add player alias</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Map a spelling as it appears in our data (e.g. &ldquo;Benny Yurchuk&rdquo;) to a canonical
          spelling and/or an NHL id, so both resolve to the same player. Scope to a team or leave
          global.
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Variant name (as in our data)</Label>
            <Input value={aliasName} onChange={(e) => setAliasName(e.target.value)} placeholder="e.g. Benny Yurchuk" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Canonical spelling</Label>
            <Input value={canonicalName} onChange={(e) => setCanonicalName(e.target.value)} placeholder="e.g. Ben Yurchuk" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">or NHL id</Label>
            <Input value={nhlId} onChange={(e) => setNhlId(e.target.value)} placeholder="e.g. 8486099" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Team seo (optional — blank = global)</Label>
            <Input value={seo} onChange={(e) => setSeo(e.target.value)} placeholder="e.g. penn-st" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || !aliasName || (!canonicalName && !nhlId)}>
              {saving ? 'Saving…' : 'Add alias'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OverridesPanel() {
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [suppressions, setSuppressions] = useState<SuppressionRow[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/research/overrides');
    const data = await res.json();
    setAliases(data.aliases ?? []);
    setSuppressions(data.suppressions ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(table: string, id: number, active: boolean) {
    await fetch('/api/admin/research/overrides', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, id, active }),
    });
    load();
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">Player aliases ({aliases.length})</h2>
          <AddAliasDialog onSaved={load} />
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>alias_norm</TableHead>
                  <TableHead>seo</TableHead>
                  <TableHead>nhl_id</TableHead>
                  <TableHead>canonical</TableHead>
                  <TableHead>note</TableHead>
                  <TableHead>active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aliases.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.alias_norm}</TableCell>
                    <TableCell>{a.seo ?? <span className="text-muted-foreground">global</span>}</TableCell>
                    <TableCell className="font-mono text-xs">{a.nhl_id ?? '—'}</TableCell>
                    <TableCell>{a.canonical_name ?? '—'}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{a.note ?? ''}</TableCell>
                    <TableCell>
                      <Switch checked={a.active} onCheckedChange={(v) => toggle('player_aliases', a.id, v)} />
                    </TableCell>
                  </TableRow>
                ))}
                {aliases.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No aliases</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">NCAA suppressions ({suppressions.length})</h2>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>seo</TableHead>
                  <TableHead>player_norm</TableHead>
                  <TableHead>reason</TableHead>
                  <TableHead>active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppressions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.seo}</TableCell>
                    <TableCell className="font-mono text-xs">{s.player_norm}</TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted-foreground">{s.reason ?? ''}</TableCell>
                    <TableCell>
                      <Switch checked={s.active} onCheckedChange={(v) => toggle('ncaa_suppressions', s.id, v)} />
                    </TableCell>
                  </TableRow>
                ))}
                {suppressions.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No suppressions</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---- Page ----
export default function ResearchPage() {
  const [tab, setTab] = useState<'queue' | 'overrides'>('queue');
  const [items, setItems] = useState<Item[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);
  const [counts, setCounts] = useState<{ candidates: number; open: number; aliases: number; suppressions: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const [reasonFilter, setReasonFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('open');
  const [teamFilter, setTeamFilter] = useState('all');
  const [seosearch, setSeoSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/research');
    const data = await res.json();
    setItems(data.items ?? []);
    setReasons(data.reasons ?? []);
    setCounts(data.counts ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setStatus(item: Item, status: string) {
    await fetch('/api/admin/research', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dedupKey: item.dedup_key, status }),
    });
    load();
  }

  // Distinct teams present in the feed, labeled by team_name when available.
  const teamOptions = useMemo(() => {
    const bySeo = new Map<string, string>();
    for (const i of items) {
      if (i.seo && !bySeo.has(i.seo)) bySeo.set(i.seo, i.team_name || i.seo);
    }
    return [...bySeo.entries()]
      .map(([seo, label]) => ({ seo, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (reasonFilter !== 'all' && i.reason !== reasonFilter) return false;
      if (teamFilter !== 'all' && i.seo !== teamFilter) return false;
      const st = effectiveStatus(i);
      if (statusFilter === 'open' && !['open', 'in_progress'].includes(st)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'open' && st !== statusFilter) return false;
      if (seosearch && !i.seo.toLowerCase().includes(seosearch.toLowerCase()) &&
          !i.player_name.toLowerCase().includes(seosearch.toLowerCase())) return false;
      return true;
    });
  }, [items, reasonFilter, teamFilter, statusFilter, seosearch]);

  const RENDER_CAP = 300;
  const visible = filtered.slice(0, RENDER_CAP);

  return (
    <div className="flex flex-col flex-1">
      <AppNav />
      <div className="p-6 max-w-7xl w-full mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Research queue</h1>
            {counts && (
              <p className="text-sm text-muted-foreground">
                {counts.open} open · {counts.candidates} candidates · {counts.aliases} aliases · {counts.suppressions} suppressions
              </p>
            )}
          </div>
          <div className="flex gap-1">
            {(['queue', 'overrides'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md text-sm capitalize ${
                  tab === t ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {tab === 'overrides' ? (
          <OverridesPanel />
        ) : (
          <>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Reason</Label>
                <Select value={reasonFilter} onValueChange={(v) => setReasonFilter(v ?? 'all')}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All reasons</SelectItem>
                    {reasons.map((r) => (
                      <SelectItem key={r} value={r}>{REASON_LABEL[r] ?? r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'open')}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open queue</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="dismissed">Dismissed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Team</Label>
                <Select value={teamFilter} onValueChange={(v) => setTeamFilter(v ?? 'all')}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All teams</SelectItem>
                    {teamOptions.map((t) => (
                      <SelectItem key={t.seo} value={t.seo}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 flex-1 min-w-48">
                <Label className="text-xs">Search (player)</Label>
                <Input value={seosearch} onChange={(e) => setSeoSearch(e.target.value)} placeholder="name…" />
              </div>
              <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">P</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Player</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead className="w-[140px]">Prior team</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        {items.length === 0 ? 'Queue is empty — the omni-hockey detector hasn’t emitted candidates yet.' : 'No items match the filters.'}
                      </TableCell></TableRow>
                    ) : (
                      visible.map((item) => (
                        <TableRow key={item.dedup_key}>
                          <TableCell className="text-muted-foreground">{item.priority}</TableCell>
                          <TableCell><ReasonBadge reason={item.reason} /></TableCell>
                          <TableCell>
                            <div className="font-medium">
                              {item.player_name}
                              {item.position ? ` (${item.position})` : ''}
                            </div>
                            {item.class_year && (
                              <div className="text-xs text-muted-foreground">Yr {item.class_year}</div>
                            )}
                            {item.reason === 'missing_data' && item.missing_fields && item.missing_fields.length > 0 && (
                              <div className="text-xs text-amber-500 mt-0.5">
                                missing: {item.missing_fields.join(', ')}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div>{item.team_name ?? item.seo}</div>
                            <div className="text-xs text-muted-foreground">{item.seo}</div>
                          </TableCell>
                          <TableCell>
                            {item.prior_team ? (
                              <div
                                className="text-sm truncate max-w-[140px]"
                                title={`${item.prior_team}${item.prior_league ? ` (${item.prior_league})` : ''}`}
                              >
                                {item.prior_team}
                                {item.prior_league && (
                                  <span className="text-muted-foreground"> ({item.prior_league})</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{item.source || '—'}</TableCell>
                          <TableCell><StatusBadge status={effectiveStatus(item)} /></TableCell>
                          <TableCell>
                            {item.state?.notes && <div className="text-xs max-w-40 truncate">{item.state.notes}</div>}
                            {item.state?.assignee && <div className="text-xs text-muted-foreground">@{item.state.assignee}</div>}
                            {!item.orphaned && <NotesCell item={item} onSaved={load} />}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.orphaned ? (
                              <span className="text-xs text-green-600">resolved (data updated)</span>
                            ) : (
                              <div className="flex gap-1 justify-end items-center">
                                {effectiveStatus(item) === 'open' && (
                                  <Button size="sm" variant="ghost" onClick={() => setStatus(item, 'in_progress')}>Start</Button>
                                )}
                                {effectiveStatus(item) !== 'dismissed' && effectiveStatus(item) !== 'resolved' && (
                                  <Button size="sm" variant="ghost" onClick={() => setStatus(item, 'dismissed')}>Dismiss</Button>
                                )}
                                <ResolveDialog item={item} onResolved={load} />
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                {filtered.length > RENDER_CAP && (
                  <div className="px-4 py-3 text-sm text-muted-foreground border-t">
                    Showing {RENDER_CAP} of {filtered.length} — refine the filters (reason / team / status) to narrow down.
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
