import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchAll, type Rangeable } from '@/lib/roster-moves/db';

/**
 * Generated-content review queue (game previews now; recaps / news later).
 * omni-agents writes + reviews; omni-hockey reads status='approved'.
 *
 * GET   → all generated_content (paged) + filter facets + status counts.
 * PATCH → bulk status change (approve / review / reject) for a set of ids.
 */

interface ContentRow {
  id: number;
  content_type: string;
  status: string;
  league: string | null;
  subject_type: string | null;
  subject_id: string | null;
  dedup_key: string;
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

export async function GET() {
  const rows = await fetchAll<ContentRow>(
    () =>
      supabase
        .from('generated_content')
        .select('*')
        .order('generated_at', { ascending: false }) as unknown as Rangeable<ContentRow>,
  );

  const contentTypes = [...new Set(rows.map((r) => r.content_type))].sort();
  const leagues = [...new Set(rows.map((r) => r.league).filter(Boolean))].sort() as string[];
  const statusCounts = rows.reduce<Record<string, number>>((m, r) => {
    m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, {});

  return Response.json({ items: rows, contentTypes, leagues, statusCounts });
}

const REVIEWED_STATES = new Set(['reviewed', 'approved', 'rejected']);

/**
 * PUT → save reviewer edits to a single item's text (title/summary/body) and,
 * optionally, transition its status in the same call ("save & approve"). Any of
 * the three text fields may be omitted to leave it unchanged.
 */
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const {
    id,
    title,
    summary,
    body: text,
    status,
    reviewer,
  } = body as {
    id?: number;
    title?: string | null;
    summary?: string | null;
    body?: string;
    status?: string;
    reviewer?: string;
  };
  if (typeof id !== 'number') {
    return Response.json({ error: 'id required' }, { status: 400 });
  }
  if (status !== undefined && !['new', 'reviewed', 'approved', 'rejected'].includes(status)) {
    return Response.json({ error: `invalid status "${status}"` }, { status: 400 });
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (title !== undefined) patch.title = title || null;
  if (summary !== undefined) patch.summary = summary || null;
  if (text !== undefined) patch.body = text;
  if (status !== undefined) {
    patch.status = status;
    if (REVIEWED_STATES.has(status)) {
      patch.reviewed_at = now;
      if (reviewer !== undefined) patch.reviewer = reviewer || null;
    } else {
      patch.reviewed_at = null;
      patch.reviewer = null;
    }
  }

  const { error } = await supabase.from('generated_content').update(patch).eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { ids, status, reviewer, notes } = body as {
    ids?: number[];
    status?: string;
    reviewer?: string;
    notes?: string;
  };
  if (!Array.isArray(ids) || ids.length === 0 || !status) {
    return Response.json({ error: 'ids[] and status required' }, { status: 400 });
  }
  if (!['new', 'reviewed', 'approved', 'rejected'].includes(status)) {
    return Response.json({ error: `invalid status "${status}"` }, { status: 400 });
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (REVIEWED_STATES.has(status)) {
    patch.reviewed_at = now;
    if (reviewer !== undefined) patch.reviewer = reviewer || null;
  } else {
    // back to 'new' clears the review audit
    patch.reviewed_at = null;
    patch.reviewer = null;
  }
  if (notes !== undefined) patch.review_notes = notes || null;

  const { error, count } = await supabase
    .from('generated_content')
    .update(patch, { count: 'exact' })
    .in('id', ids);

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true, updated: count ?? ids.length });
}
