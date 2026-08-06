import { config } from 'dotenv';
config({ path: '.env.local' });

import {
  buildOpenerContext,
  generateOpenerPreview,
  saveGamePreview,
} from '../src/lib/content/nhl-preview';

/**
 * Generate ONE NHL season-opener preview for a team's first game and save it to
 * generated_content (status=new) for review. Usage:
 *   npm run gen:nhl-preview -- TOR
 */
async function main() {
  const teamAbbr = (process.argv[2] || 'TOR').toUpperCase();
  console.log(`Building opener context for ${teamAbbr}...`);
  const ctx = await buildOpenerContext(teamAbbr);
  console.log(`Opener: ${ctx.away.name} @ ${ctx.home.name} (${ctx.date}) — game ${ctx.gameId}`);

  console.log('Generating preview...');
  const preview = await generateOpenerPreview(ctx);
  const res = await saveGamePreview(ctx, preview);

  console.log(`\n${res.outcome} generated_content id=${res.id}\n`);
  console.log(`TITLE:   ${preview.title}`);
  console.log(`SUMMARY: ${preview.summary}\n`);
  console.log(preview.body);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
