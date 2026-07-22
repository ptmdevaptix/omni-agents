import { config } from 'dotenv';
config({ path: '.env.local' });

import { seasonDiff } from '../src/lib/roster-moves/season-diff';

async function main() {
  const result = await seasonDiff();

  console.log(`Season diff: ${result.prevSeason} → ${result.currentSeason}`);
  if (!result.ran) {
    console.log(`Skipped: ${result.note}`);
    return;
  }

  console.log(`Inserted: ${result.inserted} | Updated: ${result.updated}`);
  console.log(
    '  ' +
      Object.entries(result.byDirection)
        .filter(([, n]) => n > 0)
        .map(([d, n]) => `${d}=${n}`)
        .join(' '),
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
