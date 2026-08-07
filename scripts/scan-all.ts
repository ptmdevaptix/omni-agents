import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { scanFeed } from '../src/lib/scan-feed';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

async function main() {
  const { data: feeds } = await supabase
    .from('article_feeds')
    .select('id, name, feed_type')
    .eq('is_active', true)
    .order('name');

  if (!feeds || feeds.length === 0) {
    console.log('No active feeds found');
    return;
  }

  // Record the run in scan_runs (feed_id null = a full "scan all") so the admin
  // "Last scan" panel reflects cron/manual runs — this script is what actually
  // scans reliably (the Vercel route's background scan gets killed).
  const { data: scanRun } = await supabase
    .from('scan_runs')
    .insert({ feed_id: null, status: 'running' })
    .select('id')
    .single();

  console.log(`Scanning ${feeds.length} active feeds...\n`);
  const runStart = Date.now();
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalFound = 0;
  const errors: string[] = [];

  try {
    for (const feed of feeds) {
      if (feed.feed_type === 'podcast') {
        console.log(`  SKIP ${feed.name} (podcast)`);
        continue;
      }

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

    if (scanRun) {
      await supabase
        .from('scan_runs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - runStart,
          articles_found: totalFound,
          articles_saved: totalSaved,
          articles_skipped: totalSkipped,
          error_message: errors.length ? errors.join('; ') : null,
        })
        .eq('id', scanRun.id);
    }
  } catch (err) {
    if (scanRun) {
      await supabase
        .from('scan_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - runStart,
          articles_found: totalFound,
          articles_saved: totalSaved,
          articles_skipped: totalSkipped,
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq('id', scanRun.id);
    }
    throw err;
  }

  console.log(`\nDone. Found: ${totalFound} | Saved: ${totalSaved} | Skipped: ${totalSkipped}`);
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
