import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * Feed scanning is run on GitHub Actions (a real runner), NOT in this serverless
 * function — a full multi-feed scan takes minutes and would be killed here.
 *
 *   POST { feedId }          → start a scan (one feed, or all if null): create a
 *                              scan_runs row and dispatch the scan.yml workflow.
 *   POST { action: 'abort' } → flag the active run to stop and cancel its GH run.
 *   GET                      → recent scan_runs (drives the UI's live state).
 *
 * Requires a GitHub token with actions:write in env GITHUB_DISPATCH_TOKEN.
 */

const REPO = process.env.GITHUB_REPO ?? 'ptmdevaptix/omni-agents';
const WORKFLOW = process.env.GITHUB_SCAN_WORKFLOW ?? 'scan.yml';
const REF = process.env.GITHUB_SCAN_REF ?? 'main';
const ACTIVE = ['queued', 'running', 'aborting'];

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'omni-agents',
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    feedId?: string | null;
    action?: string;
  };
  const token = process.env.GITHUB_DISPATCH_TOKEN;

  // ---- Abort the active scan ----
  if (body.action === 'abort') {
    // A running scan aborts cooperatively (scan-all checks the flag between
    // feeds). A queued scan hasn't started on the runner yet, so finalize it
    // directly (and cancel the dispatched GH run below).
    const now = new Date().toISOString();
    await supabase
      .from('scan_runs')
      .update({ status: 'aborted', completed_at: now })
      .eq('status', 'queued');
    const { data: flagged } = await supabase
      .from('scan_runs')
      .update({ status: 'aborting' })
      .eq('status', 'running')
      .select('id');

    // Best-effort: cancel the in-progress GitHub run(s) too, so a hung scan dies.
    if (token) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=10`,
          { headers: ghHeaders(token) },
        );
        const json = (await res.json()) as { workflow_runs?: { id: number; status: string }[] };
        for (const run of json.workflow_runs ?? []) {
          if (run.status === 'queued' || run.status === 'in_progress') {
            await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${run.id}/cancel`, {
              method: 'POST',
              headers: ghHeaders(token),
            });
          }
        }
      } catch {
        // cooperative abort (scan-all checks the flag) still applies
      }
    }
    return Response.json({ aborted: flagged?.length ?? 0 });
  }

  // ---- Start a scan ----
  // Refuse if one is already active (also enforced by the workflow's concurrency).
  const { data: active } = await supabase
    .from('scan_runs')
    .select('id')
    .in('status', ACTIVE)
    .limit(1);
  if (active && active.length > 0) {
    return Response.json({ error: 'A scan is already in progress' }, { status: 409 });
  }

  if (!token) {
    return Response.json(
      { error: 'GITHUB_DISPATCH_TOKEN is not configured — cannot dispatch the scan workflow' },
      { status: 500 },
    );
  }

  const feedId = body.feedId || null;
  const { data: run, error: runErr } = await supabase
    .from('scan_runs')
    .insert({ feed_id: feedId, status: 'queued' })
    .select('id')
    .single();
  if (runErr || !run) {
    return Response.json({ error: runErr?.message ?? 'Failed to create scan run' }, { status: 500 });
  }

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({ ref: REF, inputs: { feed_id: feedId ?? '', scan_run_id: run.id } }),
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    await supabase
      .from('scan_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: `workflow dispatch failed (${res.status}): ${detail.slice(0, 300)}`,
      })
      .eq('id', run.id);
    return Response.json({ error: `Failed to dispatch scan workflow (${res.status})` }, { status: 502 });
  }

  return Response.json({ scanRunId: run.id, status: 'queued' });
}

export async function GET(request: NextRequest) {
  const feedId = request.nextUrl.searchParams.get('feedId');

  let query = supabase
    .from('scan_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);

  if (feedId) {
    query = query.eq('feed_id', feedId);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ scanRuns: data });
}
