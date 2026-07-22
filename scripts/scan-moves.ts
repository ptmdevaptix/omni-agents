import { config } from 'dotenv';
config({ path: '.env.local' });

import { scanMoves } from '../src/lib/roster-moves/scan-moves';

async function main() {
  const result = await scanMoves();

  console.log(`Source: ${result.source}`);
  console.log(
    `Accounts polled: ${result.accountsPolled} | Tweets: ${result.tweetsSeen} | ` +
      `Moves: ${result.movesExtracted} | Inserted: ${result.inserted} | Updated: ${result.updated}`,
  );

  if (result.errors.length > 0) {
    console.log(`\n${result.errors.length} issue(s):`);
    for (const e of result.errors) console.log(`  - ${e}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
