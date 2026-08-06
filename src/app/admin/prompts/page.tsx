'use client';

import { useEffect, useState, useCallback } from 'react';
import { AppNav } from '@/components/app-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Prompt {
  id: number;
  key: string;
  label: string | null;
  system_prompt: string;
  active: boolean;
  version: number;
  updated_at: string;
}

function PromptCard({ prompt, onSaved }: { prompt: Prompt; onSaved: () => void }) {
  const [text, setText] = useState(prompt.system_prompt);
  const [saving, setSaving] = useState(false);
  const dirty = text !== prompt.system_prompt;

  async function save() {
    setSaving(true);
    await fetch('/api/admin/prompts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: prompt.id, systemPrompt: text }),
    });
    setSaving(false);
    onSaved();
  }
  async function toggle(active: boolean) {
    await fetch('/api/admin/prompts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: prompt.id, active }),
    });
    onSaved();
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <code className="text-sm font-semibold">{prompt.key}</code>
          {prompt.label && <span className="text-xs text-muted-foreground">{prompt.label}</span>}
          <Badge variant="outline" className="ml-1">v{prompt.version}</Badge>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span>active</span>
            <Switch checked={prompt.active} onCheckedChange={toggle} />
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.min(16, Math.max(6, text.split('\n').length + 1))}
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm font-mono leading-relaxed"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-auto">
            Edited {new Date(prompt.updated_at).toLocaleString()} · saving bumps the version
          </span>
          {dirty && <Button size="sm" variant="ghost" onClick={() => setText(prompt.system_prompt)}>Reset</Button>}
          <Button size="sm" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddPromptDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError('');
    const res = await fetch('/api/admin/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, label, systemPrompt }),
    });
    if (res.ok) {
      setOpen(false);
      setKey(''); setLabel(''); setSystemPrompt('');
      onSaved();
    } else {
      setError((await res.json()).error ?? 'Failed to add');
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Add prompt</Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add prompt</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Key is fused by the generator: <code>base</code> + a type key like{' '}
          <code>game_preview.opener</code>, <code>game_recap</code>, <code>news_article</code>.
        </p>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-xs">Key</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="game_recap" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Game recap" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">System prompt</Label>
            <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={6}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm font-mono" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || !key || !systemPrompt}>Add</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/prompts');
    const data = await res.json();
    setPrompts(data.prompts ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col flex-1">
      <AppNav />
      <div className="p-6 max-w-4xl w-full mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Generation prompts</h1>
            <p className="text-sm text-muted-foreground">
              Edited live — the generator fuses <code>base</code> with the per-type prompt on the next run.
            </p>
          </div>
          <AddPromptDialog onSaved={load} />
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : prompts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No prompts yet (using code defaults).</p>
        ) : (
          <div className="space-y-3">
            {prompts.map((p) => (
              <PromptCard key={p.id} prompt={p} onSaved={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
