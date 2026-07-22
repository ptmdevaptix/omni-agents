import { config } from 'dotenv';
config({ path: '.env.local' });

import { scanCommitments } from '../src/lib/roster-moves/scan-commitments';

async function main() {
  const result = await scanCommitments();

  console.log(`THN last_modified: ${result.lastModified ?? 'unknown'}`);
  console.log(
    `Entries: ${result.entries} | Commits: ${result.commits} | Transfers-in: ${result.transfersIn} | ` +
      `Inserted: ${result.inserted} | Updated: ${result.updated}`,
  );
  if (result.unresolvedDestinations.length > 0) {
    console.log(
      `Unresolved destinations (stored as slugs): ${result.unresolvedDestinations.join(', ')}`,
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
