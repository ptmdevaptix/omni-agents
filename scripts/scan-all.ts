import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { scanFeed } from '../src/lib/scan-feed';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

// Optional dispatch inputs (set when triggered from the admin UI; empty on cron):
const SCAN_FEED_ID = process.env.SCAN_FEED_ID?.trim() || null; // scope to one feed
const SCAN_RUN_ID = process.env.SCAN_RUN_ID?.trim() || null; // update this run row

/** Current status of a scan_runs row — used for cooperative abort. */
async function runStatus(id: string): Promise<string | null> {
  const { data } = await supabase.from('scan_runs').select('status').eq('id', id).maybeSingle();
  return data?.status ?? null;
}

async function main() {
  // Which feeds to scan: one (dispatched) or all active (cron / scan-all).
  const base = supabase.from('article_feeds').select('id, name, feed_type');
  const { data: feeds } = SCAN_FEED_ID
    ? await base.eq('id', SCAN_FEED_ID)
    : await base.eq('is_active', true).order('name');

  if (!feeds || feeds.length === 0) {
    console.log('No feeds to scan');
    return;
  }

  // Use the run row the dispatcher pre-created, or create one (cron path).
  // feed_id null = a full "scan all".
  let scanRunId = SCAN_RUN_ID;
  if (scanRunId) {
    // If it was aborted while still queued, don't start at all.
    const st = await runStatus(scanRunId);
    if (st === 'aborting' || st === 'aborted') {
      await supabase
        .from('scan_runs')
        .update({ status: 'aborted', completed_at: new Date().toISOString() })
        .eq('id', scanRunId);
      console.log('Aborted before start.');
      return;
    }
    await supabase
      .from('scan_runs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', scanRunId);
  } else {
    const { data: created } = await supabase
      .from('scan_runs')
      .insert({ feed_id: SCAN_FEED_ID, status: 'running' })
      .select('id')
      .single();
    scanRunId = created?.id ?? null;
  }

  console.log(`Scanning ${feeds.length} feed(s)${SCAN_FEED_ID ? ' (single)' : ''}...\n`);
  const runStart = Date.now();
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalFound = 0;
  let feedsScanned = 0;
  let aborted = false;
  const errors: string[] = [];

  try {
    for (const feed of feeds) {
      if (feed.feed_type === 'podcast') {
        console.log(`  SKIP ${feed.name} (podcast)`);
        continue;
      }

      // Cooperative abort: stop cleanly if the run was flagged.
      if (scanRunId && (await runStatus(scanRunId)) === 'aborting') {
        aborted = true;
        console.log('  ABORT requested — stopping.');
        break;
      }

      feedsScanned += 1;
      process.stdout.write(`  ${feed.name}...`);
      const start = Date.now();
      const result = await scanFeed(feed.id);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      totalFound += result.articlesFound;
      totalSaved += result.articlesSaved;
      totalSkipped += result.articlesSkipped;

      if (result.error) {
        errors.push(`${feed.name}: ${result.error}`);
        console.log(` ERROR (${elapsed}s): ${result.error}`);
      } else {
        console.log(` ${result.articlesSaved} saved, ${result.articlesSkipped} skipped (${elapsed}s)`);
      }
    }

    if (scanRunId) {
      await supabase
        .from('scan_runs')
        .update({
          status: aborted ? 'aborted' : 'completed',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - runStart,
          feeds_scanned: feedsScanned,
          articles_found: totalFound,
          articles_saved: totalSaved,
          articles_skipped: totalSkipped,
          error_count: errors.length,
          error_message: errors.length ? errors.join('; ') : null,
        })
        .eq('id', scanRunId);
    }
  } catch (err) {
    if (scanRunId) {
      await supabase
        .from('scan_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - runStart,
          feeds_scanned: feedsScanned,
          articles_found: totalFound,
          articles_saved: totalSaved,
          articles_skipped: totalSkipped,
          error_count: errors.length,
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq('id', scanRunId);
    }
    throw err;
  }

  console.log(
    `\nDone${aborted ? ' (ABORTED)' : ''}. Feeds: ${feedsScanned} | Found: ${totalFound} | Saved: ${totalSaved} | Skipped: ${totalSkipped} | Errors: ${errors.length}`,
  );
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
