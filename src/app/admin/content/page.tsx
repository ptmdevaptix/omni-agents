'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { AppNav } from '@/components/app-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

function ViewDialog({ item, onChanged }: { item: ContentItem; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  async function act(status: string) {
    await patchStatus([item.id], status);
    setOpen(false);
    onChanged();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>View</Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {item.title ?? `${item.subject_type} ${item.subject_id}`}
            <StatusBadge status={item.status} />
          </DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground">
          {TYPE_LABEL[item.content_type] ?? item.content_type}
          {item.league ? ` · ${item.league}` : ''} · {item.model ?? 'model n/a'} · v{item.version} ·{' '}
          {new Date(item.generated_at).toLocaleString()}
        </div>
        {item.summary && <p className="text-sm font-medium">{item.summary}</p>}
        <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-md border p-3 text-sm leading-relaxed">
          {item.body}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => act('rejected')}>Reject</Button>
          <Button variant="outline" onClick={() => act('reviewed')}>Mark reviewed</Button>
          <Button onClick={() => act('approved')}>Approve</Button>
        </div>
      </DialogContent>
    </Dialog>
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

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (typeFilter !== 'all' && i.content_type !== typeFilter) return false;
      if (statusFilter !== 'all' && i.status !== statusFilter) return false;
      if (leagueFilter !== 'all' && i.league !== leagueFilter) return false;
      return true;
    });
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
      <div className="p-6 max-w-7xl w-full mx-auto space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Generated content</h1>
          <p className="text-sm text-muted-foreground">
            {statusCounts.new ?? 0} new · {statusCounts.reviewed ?? 0} reviewed ·{' '}
            {statusCounts.approved ?? 0} approved · {statusCounts.rejected ?? 0} rejected
          </p>
        </div>

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
                  filtered.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} aria-label="Select row" />
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
                        <div className="flex gap-1 justify-end items-center">
                          <ViewDialog item={item} onChanged={load} />
                          {item.status !== 'approved' && (
                            <Button size="sm" variant="ghost" onClick={() => rowAct(item.id, 'approved')}>Approve</Button>
                          )}
                          {item.status !== 'rejected' && item.status !== 'approved' && (
                            <Button size="sm" variant="ghost" onClick={() => rowAct(item.id, 'rejected')}>Reject</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
