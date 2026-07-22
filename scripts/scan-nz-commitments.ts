import { config } from 'dotenv';
config({ path: '.env.local' });

import { scanNeutralZone } from '../src/lib/roster-moves/scan-nz-commitments';

async function main() {
  const r = await scanNeutralZone();

  console.log(`Neutral Zone commitments — season ${r.season} (Commit Year ${r.commitYear})`);
  console.log(
    `Entries: ${r.entriesForSeason} | Commits: ${r.commits} | Transfers-in: ${r.transfersIn} | ` +
      `Inserted: ${r.inserted} | Updated: ${r.updated} | Skipped non-D1: ${r.skippedNonD1}`,
  );
  if (r.skippedSample.length > 0) {
    console.log(`Skipped destinations (sample, verify none are D1): ${r.skippedSample.join(', ')}`);
  }
  if (r.errors.length > 0) {
    console.log(`\n${r.errors.length} issue(s):`);
    for (const e of r.errors.slice(0, 20)) console.log(`  - ${e}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
