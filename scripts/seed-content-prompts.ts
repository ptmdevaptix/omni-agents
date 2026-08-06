import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { PROMPT_DEFAULTS } from '../src/lib/content/prompts';

/**
 * Seed content_prompts from the code defaults (idempotent — existing keys are
 * left untouched). Run once after the table is created; safe to re-run.
 */
const LABELS: Record<string, string> = {
  base: 'Base (all content)',
  'game_preview.opener': 'Game preview — season opener',
  'game_preview.in_season': 'Game preview — in-season',
};

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const rows = Object.entries(PROMPT_DEFAULTS).map(([key, system_prompt]) => ({
    key,
    label: LABELS[key] ?? null,
    system_prompt,
  }));
  const { error } = await sb
    .from('content_prompts')
    .upsert(rows, { onConflict: 'key', ignoreDuplicates: true });
  if (error) {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
    return;
  }
  const { count } = await sb.from('content_prompts').select('*', { count: 'exact', head: true });
  console.log(`Seeded ${rows.length} prompt(s). content_prompts now has ${count} row(s).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode ?? 0));
