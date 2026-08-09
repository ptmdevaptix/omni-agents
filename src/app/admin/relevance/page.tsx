'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { AppNav } from '@/components/app-nav';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Bucket { label: string; min: number; max: number; count: number }
interface Sample { id: number; title: string; teams: { name: string; relevance: number | null }[] }

export default function RelevancePage() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [nullCount, setNullCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(40);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/admin/relevance');
      const d = await res.json();
      setBuckets(d.buckets ?? []);
      setNullCount(d.nullCount ?? 0);
      setTotal(d.total ?? 0);
      setSamples(d.samples ?? []);
      setLoading(false);
    })();
  }, []);

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const scored = buckets.reduce((s, b) => s + b.count, 0);
  const kept = buckets.filter((b) => b.max >= threshold).reduce((s, b) => s + b.count, 0);
  // A team link is shown if relevance >= threshold OR relevance is null (legacy/
  // single-team). Cut = scored links below the threshold.
  const cut = scored - buckets.filter((b) => b.min >= threshold).reduce((s, b) => s + b.count, 0);
  const shownTotal = scored - cut + nullCount;

  const bandColor = (b: Bucket) =>
    b.min >= threshold ? 'bg-green-500' : b.max < threshold ? 'bg-destructive/60' : 'bg-amber-500';

  const keep = (rel: number | null) => rel == null || rel >= threshold;

  const sortedSamples = useMemo(
    () =>
      [...samples].sort((a, b) => {
        const am = Math.max(...a.teams.map((t) => t.relevance ?? -1));
        const bm = Math.max(...b.teams.map((t) => t.relevance ?? -1));
        return bm - am;
      }),
    [samples],
  );

  return (
    <div className="flex flex-1 flex-col">
      <AppNav />
      <div className="w-full space-y-6 p-6">
        <div>
          <h1 className="text-xl font-semibold">Team relevance</h1>
          <p className="text-sm text-muted-foreground">
            How central each team is to its article (0–100). Use this to pick a display threshold
            for the read side.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {/* Threshold explorer */}
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Threshold</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={threshold}
                      onChange={(e) => setThreshold(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                      className="w-24"
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="flex-1 min-w-48 accent-primary"
                  />
                </div>
                <div className="flex flex-wrap gap-6 text-sm">
                  <span>Total links: <strong>{total.toLocaleString()}</strong></span>
                  <span className="text-green-600">
                    Shown (≥{threshold} or unscored): <strong>{shownTotal.toLocaleString()}</strong>
                  </span>
                  <span className="text-destructive">
                    Hidden (&lt;{threshold}): <strong>{cut.toLocaleString()}</strong>{' '}
                    ({scored ? Math.round((cut / scored) * 100) : 0}% of scored)
                  </span>
                  <span className="text-muted-foreground">
                    Unscored (always shown): {nullCount.toLocaleString()}
                  </span>
                </div>

                {/* Histogram */}
                <div className="flex items-end gap-1 pt-2" style={{ height: 160 }}>
                  {buckets.map((b) => (
                    <div key={b.label} className="flex flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-[10px] text-muted-foreground">{b.count.toLocaleString()}</span>
                      <div
                        className={cn('w-full rounded-t', bandColor(b))}
                        style={{ height: `${Math.max(2, (b.count / maxCount) * 130)}px` }}
                        title={`${b.label}: ${b.count}`}
                      />
                      <span className="text-[10px] text-muted-foreground">{b.min}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Green bars are kept at the current threshold; red are hidden. Bars are relevance
                  bands (0–9 … 90–100).
                </p>
              </CardContent>
            </Card>

            {/* Samples: recent multi-team articles, chips colored by keep/cut */}
            <div>
              <h2 className="mb-2 text-sm font-semibold">
                Recent multi-team articles ({sortedSamples.length}) — chips dim when they&apos;d be hidden
              </h2>
              <Card>
                <CardContent className="space-y-3 p-4">
                  {sortedSamples.map((s) => (
                    <div key={s.id} className="border-b pb-2 last:border-0 last:pb-0">
                      <div className="text-sm font-medium">{s.title}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {s.teams.map((t, i) => (
                          <span
                            key={i}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs',
                              keep(t.relevance)
                                ? 'border-green-600/40 bg-green-500/10'
                                : 'border-destructive/30 text-muted-foreground line-through opacity-60',
                            )}
                          >
                            {t.name}
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {t.relevance ?? '—'}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {sortedSamples.length === 0 && (
                    <p className="text-sm text-muted-foreground">No multi-team articles found.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
