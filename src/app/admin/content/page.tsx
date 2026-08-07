'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AppNav } from '@/components/app-nav';
import { SlideOver } from '@/components/ui/slide-over';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface ContentItem {
  id: number;
  content_type: string;
  status: string;
  league: string | null;
  subject_type: string | null;
  subject_id: string | null;
  title: string | null;
  summary: string | null;
  body: string;
  data: Record<string, unknown>;
  model: string | null;
  version: number;
  generated_at: string;
  reviewer: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  game_preview: 'Game preview',
  game_recap: 'Game recap',
  news_article: 'News article',
};

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'approved':
      return <Badge className="bg-green-600 text-white">Approved</Badge>;
    case 'reviewed':
      return <Badge className="bg-blue-600 text-white">Reviewed</Badge>;
    case 'rejected':
      return <Badge className="bg-red-600 text-white">Rejected</Badge>;
    default:
      return <Badge variant="outline">New</Badge>;
  }
}

async function patchStatus(ids: number[], status: string) {
  await fetch('/api/admin/content', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status }),
  });
}

/** Save reviewer edits (and optionally transition status) for one item. */
async function saveEdits(
  id: number,
  fields: { title: string | null; summary: string | null; body: string },
  status?: string,
) {
  await fetch('/api/admin/content', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...fields, ...(status ? { status } : {}) }),
  });
}

function ReviewPanel({
  item,
  onClose,
  onChanged,
  onDirtyChange,
  onRegenerate,
}: {
  item: ContentItem;
  onClose: () => void;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onRegenerate: (id: number) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title ?? '');
  const [summary, setSummary] = useState(item.summary ?? '');
  const [body, setBody] = useState(item.body);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const dirty =
    title !== (item.title ?? '') || summary !== (item.summary ?? '') || body !== item.body;

  // Report dirty state up so the list can warn before switching/closing.
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  async function act(status?: string) {
    setSaving(true);
    // If text changed (or a status transition is requested), persist via PUT so
    // edits and the status change land together; otherwise nothing to do.
    if (dirty || status) {
      await saveEdits(
        item.id,
        { title: title.trim() || null, summary: summary.trim() || null, body },
        status,
      );
    }
    setSaving(false);
    onChanged();
    onClose();
  }

  async function regenerate() {
    if (dirty && !window.confirm('Discard your edits and regenerate this preview from the current prompt?')) return;
    setRegenerating(true);
    await onRegenerate(item.id);
    setRegenerating(false);
    onClose();
  }

  const textarea =
    'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm leading-relaxed outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-heading text-base font-medium">Review</span>
            <StatusBadge status={item.status} />
            {dirty && <span className="text-xs text-amber-600">unsaved edits</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {TYPE_LABEL[item.content_type] ?? item.content_type}
            {item.league ? ` · ${item.league}` : ''} · {item.model ?? 'model n/a'} · v{item.version} ·{' '}
            {new Date(item.generated_at).toLocaleString()}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <XIcon />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
        <div className="space-y-1">
          <Label className="text-xs">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Summary</Label>
          <textarea className={textarea} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <Label className="text-xs">Body</Label>
          <textarea
            className={cn(textarea, 'min-h-0 flex-1 resize-none')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/50 p-4">
        <Button variant="ghost" onClick={regenerate} disabled={saving || regenerating}>
          {regenerating ? 'Regenerating…' : 'Regenerate'}
        </Button>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => act('rejected')} disabled={saving || regenerating}>Reject</Button>
          <Button variant="outline" onClick={() => act()} disabled={saving || regenerating || !dirty}>Save</Button>
          <Button variant="outline" onClick={() => act('reviewed')} disabled={saving || regenerating}>Save &amp; mark reviewed</Button>
          <Button onClick={() => act('approved')} disabled={saving || regenerating}>Save &amp; approve</Button>
        </div>
      </div>
    </div>
  );
}

export default function ContentPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [contentTypes, setContentTypes] = useState<string[]>([]);
  const [leagues, setLeagues] = useState<string[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('new');
  const [leagueFilter, setLeagueFilter] = useState('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Slide-over review panel. `panelOpen` drives the slide transition; `editing`
  // is cleared after the exit animation so the panel content unmounts fresh.
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const reportDirty = useCallback((d: boolean) => { dirtyRef.current = d; }, []);
  function openPanel(item: ContentItem) {
    // Switching to a different item while there are unsaved edits → confirm.
    if (panelOpen && editing && item.id !== editing.id && dirtyRef.current) {
      if (!window.confirm('You have unsaved edits. Discard them and open this item?')) return;
    }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    dirtyRef.current = false;
    setEditing(item);
    setPanelOpen(true);
  }
  function closePanel() {
    setPanelOpen(false);
    dirtyRef.current = false;
    closeTimer.current = setTimeout(() => setEditing(null), 220);
  }

  // Regeneration (after prompt edits). Single item, or all teams' next games with
  // a client-driven progress bar.
  const [regen, setRegen] = useState<{ running: boolean; done: number; total: number }>({
    running: false, done: 0, total: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/content');
    const data = await res.json();
    setItems(data.items ?? []);
    setContentTypes(data.contentTypes ?? []);
    setLeagues(data.leagues ?? []);
    setStatusCounts(data.statusCounts ?? {});
    setSelected(new Set());
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const regenerateOne = useCallback(async (id: number) => {
    await fetch('/api/admin/content/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await load();
  }, [load]);
  async function regenerateAll() {
    if (!window.confirm("Regenerate every team's next-game preview? This overwrites the current text and resets those items to New.")) return;
    const plan: { target: string }[] = (await fetch('/api/admin/content/regenerate').then((r) => r.json())).plan ?? [];
    setRegen({ running: true, done: 0, total: plan.length });
    for (const p of plan) {
      try {
        await fetch('/api/admin/content/regenerate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: p.target }),
        });
      } catch { /* keep going; one failure shouldn't stop the batch */ }
      setRegen((s) => ({ ...s, done: s.done + 1 }));
    }
    setRegen((s) => ({ ...s, running: false }));
    await load();
  }

  // Sort key: the game's start time (date + time) so previews list soonest-first;
  // fall back to the stored date, then generation time for non-game content.
  const gameTime = (i: ContentItem): string => {
    const d = i.data as { start_time_utc?: string | null; date?: string | null };
    return d?.start_time_utc || d?.date || i.generated_at;
  };

  const filtered = useMemo(() => {
    return items
      .filter((i) => {
        if (typeFilter !== 'all' && i.content_type !== typeFilter) return false;
        if (statusFilter !== 'all' && i.status !== statusFilter) return false;
        if (leagueFilter !== 'all' && i.league !== leagueFilter) return false;
        return true;
      })
      .sort((a, b) => gameTime(a).localeCompare(gameTime(b)));
  }, [items, typeFilter, statusFilter, leagueFilter]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));
  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((i) => i.id)));
  }
  function toggleOne(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  async function bulk(status: string) {
    await patchStatus([...selected], status);
    await load();
  }
  async function rowAct(id: number, status: string) {
    await patchStatus([id], status);
    await load();
  }

  return (
    <div className="flex flex-col flex-1">
      <AppNav />
      <div
        className={cn(
          'w-full space-y-4 p-6 transition-[padding] duration-200',
          panelOpen && 'lg:pr-[37rem]',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Generated content</h1>
            <p className="text-sm text-muted-foreground">
              {statusCounts.new ?? 0} new · {statusCounts.reviewed ?? 0} reviewed ·{' '}
              {statusCounts.approved ?? 0} approved · {statusCounts.rejected ?? 0} rejected
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={regenerateAll} disabled={regen.running}>
            {regen.running ? `Regenerating ${regen.done}/${regen.total}…` : 'Regenerate all'}
          </Button>
        </div>

        {regen.running && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Regenerating next-game previews…</span>
              <span>{regen.done}/{regen.total}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${regen.total ? Math.round((regen.done / regen.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? 'all')}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {contentTypes.map((t) => (
                  <SelectItem key={t} value={t}>{TYPE_LABEL[t] ?? t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'new')}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {leagues.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">League</Label>
              <Select value={leagueFilter} onValueChange={(v) => setLeagueFilter(v ?? 'all')}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {leagues.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border bg-accent/40 px-3 py-2 text-sm">
            <span className="mr-auto">{selected.size} selected</span>
            <Button size="sm" variant="ghost" onClick={() => bulk('rejected')}>Reject</Button>
            <Button size="sm" variant="outline" onClick={() => bulk('reviewed')}>Mark reviewed</Button>
            <Button size="sm" onClick={() => bulk('approved')}>Approve</Button>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all" />
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {items.length === 0 ? 'No generated content yet.' : 'No items match the filters.'}
                  </TableCell></TableRow>
                ) : (
                  filtered.map((item) => {
                    const isOpen = panelOpen && editing?.id === item.id;
                    return (
                    <TableRow
                      key={item.id}
                      onClick={() => openPanel(item)}
                      aria-selected={isOpen}
                      className={cn(
                        'cursor-pointer hover:bg-muted',
                        isOpen && 'bg-accent hover:bg-accent',
                      )}
                    >
                      <TableCell className="relative">
                        {isOpen && <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />}
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggleOne(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Select row"
                        />
                      </TableCell>
                      <TableCell className="text-sm">
                        {TYPE_LABEL[item.content_type] ?? item.content_type}
                        {item.league && <span className="text-muted-foreground"> · {item.league}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{item.title ?? `${item.subject_type ?? ''} ${item.subject_id ?? ''}`}</div>
                        {item.summary && <div className="text-xs text-muted-foreground max-w-md truncate">{item.summary}</div>}
                      </TableCell>
                      <TableCell><StatusBadge status={item.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(item.generated_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end items-center" onClick={(e) => e.stopPropagation()}>
                          {item.status !== 'approved' && (
                            <Button size="sm" variant="ghost" onClick={() => rowAct(item.id, 'approved')}>Approve</Button>
                          )}
                          {item.status !== 'rejected' && item.status !== 'approved' && (
                            <Button size="sm" variant="ghost" onClick={() => rowAct(item.id, 'rejected')}>Reject</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Slide-over review/edit panel — docks on the right and splits the view. */}
      <SlideOver open={panelOpen}>
        {editing && (
          <ReviewPanel
            key={editing.id}
            item={editing}
            onClose={closePanel}
            onChanged={load}
            onDirtyChange={reportDirty}
            onRegenerate={regenerateOne}
          />
        )}
      </SlideOver>
    </div>
  );
}
