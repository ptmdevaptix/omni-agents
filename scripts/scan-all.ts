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

  console.log(`Scanning ${feeds.length} active feeds...\n`);
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalFound = 0;

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
      console.log(` ERROR (${elapsed}s): ${result.error}`);
    } else {
      console.log(` ${result.articlesSaved} saved, ${result.articlesSkipped} skipped (${elapsed}s)`);
    }
  }

  console.log(`\nDone. Found: ${totalFound} | Saved: ${totalSaved} | Skipped: ${totalSkipped}`);
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
