import { config } from 'dotenv';
config({ path: '.env.local' });

import { scanPortal } from '../src/lib/roster-moves/scan-portal';

async function main() {
  const result = await scanPortal();

  console.log(`Portal last_updated: ${result.lastUpdated ?? 'unknown'}`);
  console.log(
    `Entries: ${result.entries} | Moves: ${result.movesEmitted} | ` +
      `Inserted: ${result.inserted} | Updated: ${result.updated}`,
  );
  if (result.unresolvedOrigins.length > 0) {
    console.log(
      `Unresolved origin schools (stored as slugs): ${result.unresolvedOrigins.join(', ')}`,
    );
  }
  if (result.errors.length > 0) {
    console.log(`\n${result.errors.length} issue(s):`);
    for (const e of result.errors.slice(0, 20)) console.log(`  - ${e}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
