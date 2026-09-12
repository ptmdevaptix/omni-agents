'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * Duplicate-player review.
 *
 * One player is one page across every league, but sources key players differently and share no id, so
 * the same human can become two rows. omni-hockey merges the unambiguous ones on its own; what lands
 * here is what it will not decide alone — most often because a source carries no birth date, which is
 * true of 29% of rows.
 *
 * The reviewer's job is a three-way call, so that is the whole UI: same player, not the same player,
 * or not sure. "Not sure" is a real answer and keeps the pair out of the nightly mail without
 * pretending it was resolved.
 */

interface Candidate {
  dedup_key: string;
  band: string;
  player_a: string;
  player_b: string;
  name_a: string;
  name_b: string;
  birth_a: string | null;
  birth_b: string | null;
  position_a: string | null;
  position_b: string | null;
  source_a: string | null;
  source_b: string | null;
  signals: string[] | null;
  detected_at: string;
  verdict: { verdict: string; reviewer: string | null; notes: string | null } | null;
  /** Club + season, e.g. "St. Lawrence Saints 2026". Season always shown — see the API route. */
  teams_a: string[];
  teams_b: string[];
}

interface Judged {
  dedup_key: string;
  verdict: string;
  reviewer: string | null;
  notes: string | null;
  name_a: string | null;
  name_b: string | null;
  updated_at: string;
}

const BAND_STYLE: Record<string, string> = {
  HIGH: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  MEDIUM: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  LOW: 'bg-muted text-muted-foreground border-border',
};

/** Club+season entries both rows carry. Memoised per candidate so it is not recomputed per list item. */
const sharedCache = new WeakMap<Candidate, Set<string>>();
function sharedTeams(c: Candidate): Set<string> {
  let hit = sharedCache.get(c);
  if (!hit) {
    const b = new Set(c.teams_b ?? []);
    hit = new Set((c.teams_a ?? []).filter((t) => b.has(t)));
    sharedCache.set(c, hit);
  }
  return hit;
}

/**
 * Fields a reviewer can supply. Birth date is first because it is the one that matters: its absence is
 * what keeps a pair out of the automatic band, so filling it converts the next run's merge from a
 * click into a rule.
 */
const EDITABLE = [
  { key: 'birth_date', label: 'Birth date', placeholder: 'YYYY-MM-DD', width: 'w-32' },
  { key: 'position', label: 'Position', placeholder: 'C/L/R/D/G/F', width: 'w-24' },
  { key: 'origin', label: 'Hometown', placeholder: 'City, ST, CAN', width: 'w-44' },
  { key: 'origin_country', label: 'Country', placeholder: 'CAN', width: 'w-20' },
] as const;

const VERDICT_LABEL: Record<string, string> = {
  duplicate: 'Same player',
  not_duplicate: 'Different players',
  unsure: 'Not sure',
};

export default function PlayerMergesPage() {
  const [items, setItems] = useState<Candidate[]>([]);
  const [judged, setJudged] = useState<Judged[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState('');
  const [showJudged, setShowJudged] = useState(false);
  const [showLow, setShowLow] = useState(false);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/player-merges');
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setItems(d.items ?? []);
      setJudged(d.judged ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Remembered per browser so a reviewer isn't retyping their name on every verdict.
    setReviewer(localStorage.getItem('merge-reviewer') ?? '');
  }, [load]);

  useEffect(() => {
    if (reviewer) localStorage.setItem('merge-reviewer', reviewer);
  }, [reviewer]);

  async function judge(c: Candidate, verdict: string) {
    setSaving(c.dedup_key);
    try {
      const res = await fetch('/api/admin/player-merges', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dedupKey: c.dedup_key, verdict, reviewer: reviewer || null,
          nameA: c.name_a, nameB: c.name_b,
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      // Update in place rather than refetching, so the list does not jump under the cursor
      // mid-review. A verdict is reversible right here if it was a misclick.
      setItems((prev) =>
        prev.map((i) =>
          i.dedup_key === c.dedup_key ? { ...i, verdict: { verdict, reviewer, notes: null } } : i,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  async function saveCorrection(playerId: string, fields: Record<string, string>) {
    setSaving(playerId);
    try {
      const res = await fetch('/api/admin/player-merges', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, fields, reviewer: reviewer || null }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      // Deliberately does NOT refetch. The correction is applied by omni-hockey on its next detector
      // run, so the card would come back unchanged and read as a failed save.
      setSaved((prev) => ({ ...prev, [playerId]: true }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  async function undo(dedupKey: string) {
    setSaving(dedupKey);
    try {
      await fetch(`/api/admin/player-merges?dedupKey=${encodeURIComponent(dedupKey)}`, {
        method: 'DELETE',
      });
      setItems((prev) =>
        prev.map((i) => (i.dedup_key === dedupKey ? { ...i, verdict: null } : i)),
      );
      setJudged((prev) => prev.filter((j) => j.dedup_key !== dedupKey));
    } finally {
      setSaving(null);
    }
  }

  // LOW is "record only, never link" — a fuzzy-name proposal kept for the record, not work to hand
  // someone. Hidden by default so the queue is the pairs actually worth a decision; the first run
  // read as "255 to review" when 104 of them were never meant to be acted on.
  const visible = useMemo(
    () => (showLow ? items : items.filter((i) => i.band !== 'LOW')),
    [items, showLow],
  );
  const lowCount = useMemo(() => items.filter((i) => i.band === 'LOW' && !i.verdict).length, [items]);
  const open = useMemo(() => visible.filter((i) => !i.verdict), [visible]);
  const counts = useMemo(
    () => ({
      open: open.length,
      high: open.filter((i) => i.band === 'HIGH').length,
      medium: open.filter((i) => i.band === 'MEDIUM').length,
      low: open.filter((i) => i.band === 'LOW').length,
    }),
    [open],
  );

  return (
    <>
      <AppNav />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Duplicate players</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Pairs that may be one person. Clear matches are merged automatically upstream; these are
              the ones that need a human, usually because a source carries no birth date.
            </p>
          </div>
          <div className="w-56">
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor="reviewer">
              Your name (recorded with the verdict)
            </label>
            <Input
              id="reviewer"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              placeholder="optional"
            />
          </div>
        </div>

        {error && (
          <Card className="mb-4 border-destructive/40">
            <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        <div className="mb-6 flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">{counts.open} to review</Badge>
          {counts.high > 0 && <Badge className={BAND_STYLE.HIGH}>{counts.high} high</Badge>}
          {counts.medium > 0 && <Badge className={BAND_STYLE.MEDIUM}>{counts.medium} medium</Badge>}
          {showLow && counts.low > 0 && <Badge className={BAND_STYLE.LOW}>{counts.low} low</Badge>}
          {lowCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowLow((s) => !s)}>
              {showLow ? 'Hide' : 'Show'} {lowCount} fuzzy-name match{lowCount === 1 ? '' : 'es'}
            </Button>
          )}
          {judged.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowJudged((s) => !s)}>
              {showJudged ? 'Hide' : 'Show'} {judged.length} already decided
            </Button>
          )}
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!loading && visible.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nothing to review. Duplicates that clear the automatic bar are merged without appearing
              here.
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {visible.map((c) => (
            <Card key={c.dedup_key} className={c.verdict ? 'opacity-60' : undefined}>
              <CardContent className="py-4">
                <div className="mb-3 flex items-center gap-2">
                  <Badge className={BAND_STYLE[c.band] ?? BAND_STYLE.LOW}>{c.band}</Badge>
                  {c.verdict && (
                    <Badge variant="outline">
                      {VERDICT_LABEL[c.verdict.verdict] ?? c.verdict.verdict}
                      {c.verdict.reviewer ? ` — ${c.verdict.reviewer}` : ''}
                    </Badge>
                  )}
                </div>

                {/* Side by side, same fields in the same order, so a difference is visible rather
                    than hunted for. */}
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    { name: c.name_a, birth: c.birth_a, pos: c.position_a, src: c.source_a, id: c.player_a, teams: c.teams_a ?? [] },
                    { name: c.name_b, birth: c.birth_b, pos: c.position_b, src: c.source_b, id: c.player_b, teams: c.teams_b ?? [] },
                  ]).map((side, i) => (
                    <div key={i} className="rounded-md border border-border p-3">
                      <div className="font-medium">{side.name}</div>
                      <dl className="mt-2 space-y-1 text-sm text-muted-foreground">
                        <div className="flex gap-2">
                          <dt className="w-16 shrink-0">Born</dt>
                          <dd className={side.birth ? '' : 'italic'}>{side.birth ?? 'not recorded'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-16 shrink-0">Position</dt>
                          <dd>{side.pos ?? '—'}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-16 shrink-0">Source</dt>
                          <dd>{side.src ?? '—'}</dd>
                        </div>
                        {/* Roster history is often the deciding evidence, especially where a birth
                            date is missing: the same club in the same season is strong, while two
                            different schools in one season means one of these rows is wrong about
                            something. Shared entries are marked so the comparison is not manual. */}
                        <div className="flex gap-2">
                          <dt className="w-16 shrink-0">Teams</dt>
                          <dd className="min-w-0">
                            {side.teams.length === 0 ? (
                              <span className="italic">none recorded</span>
                            ) : (
                              <ul className="space-y-0.5">
                                {side.teams.map((t) => {
                                  const shared = sharedTeams(c).has(t);
                                  return (
                                    <li
                                      key={t}
                                      className={shared ? 'font-medium text-emerald-400' : undefined}
                                    >
                                      {t}
                                      {shared && ' ·shared'}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </dd>
                        </div>
                      </dl>
                      <a
                        className="mt-2 inline-block text-xs text-sky-400 hover:underline"
                        href={`https://omnihockey.com/players/${side.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open player page ↗
                      </a>

                      {/* Supplying the missing value is usually more useful than judging the pair:
                          a birth date is what the automatic band needs, so filling it lets the next
                          run merge by rule instead of by click — and fixes the player's data for
                          every future comparison. Blank fields are ignored, never written. */}
                      {!c.verdict && (
                        <div className="mt-3 border-t border-border pt-3">
                          <div className="mb-2 text-xs text-muted-foreground">
                            Add missing data {side.birth ? '' : '— no birth date on this row'}
                          </div>
                          <div className="flex flex-wrap items-end gap-2">
                            {EDITABLE.map((f) => (
                              <div key={f.key}>
                                <label
                                  className="mb-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground"
                                  htmlFor={`${side.id}-${f.key}`}
                                >
                                  {f.label}
                                </label>
                                <Input
                                  id={`${side.id}-${f.key}`}
                                  className={`h-8 text-sm ${f.width}`}
                                  placeholder={f.placeholder}
                                  value={edits[side.id]?.[f.key] ?? ''}
                                  onChange={(e) =>
                                    setEdits((prev) => ({
                                      ...prev,
                                      [side.id]: { ...prev[side.id], [f.key]: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                            ))}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                saving === side.id ||
                                !Object.values(edits[side.id] ?? {}).some((v) => v.trim())
                              }
                              onClick={() => saveCorrection(side.id, edits[side.id] ?? {})}
                            >
                              Save
                            </Button>
                            {saved[side.id] && (
                              <span className="text-xs text-emerald-400">
                                saved · applies on the next nightly run
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Why this was proposed. A merge has to be explainable before it is accepted, and
                    without this the reviewer is being asked to trust a score. */}
                {c.signals && c.signals.length > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Matched on: {c.signals.join(' · ')}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {c.verdict ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving === c.dedup_key}
                      onClick={() => undo(c.dedup_key)}
                    >
                      Undo
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" disabled={saving === c.dedup_key} onClick={() => judge(c, 'duplicate')}>
                        Same player
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={saving === c.dedup_key}
                        onClick={() => judge(c, 'not_duplicate')}
                      >
                        Different players
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving === c.dedup_key}
                        onClick={() => judge(c, 'unsure')}
                      >
                        Not sure
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Decided pairs drop out of the feed upstream, so without this their verdicts — including the
            wrong ones — would be invisible and unfixable. */}
        {showJudged && judged.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Already decided</h2>
            <div className="space-y-2">
              {judged.map((j) => (
                <Card key={j.dedup_key}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <span>
                      {j.name_a ?? '?'} / {j.name_b ?? '?'}{' '}
                      <span className="text-muted-foreground">
                        — {VERDICT_LABEL[j.verdict] ?? j.verdict}
                        {j.reviewer ? ` by ${j.reviewer}` : ''}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={saving === j.dedup_key}
                      onClick={() => undo(j.dedup_key)}
                    >
                      Undo
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <p className="mt-8 text-xs text-muted-foreground">
          Marking a pair does not itself merge them — it records the decision. Merging runs upstream in
          omni-hockey, and the loser is tombstoned rather than deleted, so any merge can be undone.
        </p>
      </main>
    </>
  );
}
