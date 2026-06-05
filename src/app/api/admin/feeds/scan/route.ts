import { NextRequest } from 'next/server';
import { scanFeed } from '@/lib/scan-feed';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const { feedId } = await request.json();

  // feedId can be a single ID or null for "scan all"
  let feedIds: string[] = [];

  if (feedId) {
    feedIds = [feedId];
  } else {
    const { data } = await supabase
      .from('article_feeds')
      .select('id')
      .eq('is_active', true)
      .neq('feed_type', 'podcast');

    feedIds = data?.map((f) => f.id) ?? [];
  }

  // Create a scan_run record
  const { data: scanRun, error: scanError } = await supabase
    .from('scan_runs')
    .insert({
      feed_id: feedId || null,
      status: 'running',
    })
    .select('id')
    .single();

  if (scanError || !scanRun) {
    return Response.json(
      { error: scanError?.message ?? 'Failed to create scan run' },
      { status: 500 },
    );
  }

  // Return immediately — run the scan in the background
  const scanPromise = (async () => {
    const startTime = Date.now();
    let totalFound = 0;
    let totalSaved = 0;
    let totalSkipped = 0;
    let errorMessage: string | undefined;

    try {
      for (const id of feedIds) {
        const result = await scanFeed(id);
        totalFound += result.articlesFound;
        totalSaved += result.articlesSaved;
        totalSkipped += result.articlesSkipped;
        if (result.error) {
          errorMessage = errorMessage
            ? `${errorMessage}; ${result.error}`
            : result.error;
        }
      }

      await supabase
        .from('scan_runs')
        .update({
          status: errorMessage ? 'completed' : 'completed',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          articles_found: totalFound,
          articles_saved: totalSaved,
          articles_skipped: totalSkipped,
          error_message: errorMessage ?? null,
        })
        .eq('id', scanRun.id);
    } catch (err) {
      await supabase
        .from('scan_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          articles_found: totalFound,
          articles_saved: totalSaved,
          articles_skipped: totalSkipped,
          error_message:
            err instanceof Error ? err.message : 'Unknown error',
        })
        .eq('id', scanRun.id);
    }
  })();

  // Fire and forget — don't await the scan
  // In Vercel, use waitUntil if available; locally this just runs
  if (
    'waitUntil' in request &&
    typeof (request as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil === 'function'
  ) {
    (request as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(scanPromise);
  } else {
    // Local dev: let the promise run without awaiting
    scanPromise.catch(console.error);
  }

  return Response.json({
    scanRunId: scanRun.id,
    feedCount: feedIds.length,
    status: 'started',
  });
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
