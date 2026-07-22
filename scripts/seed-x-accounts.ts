import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

/**
 * Sync the curated X handles from the X_ACCOUNTS env var into the x_accounts
 * table. Env is the human-editable list; the table holds runtime cursor state
 * (since_id) that env can't persist. Safe to re-run: existing rows (and their
 * since_id) are left untouched; only new handles are inserted.
 */
async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  );

  const handles = (process.env.X_ACCOUNTS ?? '')
    .split(',')
    .map((h) => h.trim().replace(/^@/, ''))
    .filter(Boolean);

  if (handles.length === 0) {
    console.log('X_ACCOUNTS is empty — nothing to seed.');
    return;
  }

  const rows = handles.map((handle) => ({ handle }));
  const { error } = await supabase
    .from('x_accounts')
    .upsert(rows, { onConflict: 'handle', ignoreDuplicates: true });

  if (error) {
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const { count } = await supabase
    .from('x_accounts')
    .select('*', { count: 'exact', head: true });

  console.log(
    `Synced ${handles.length} handle(s) from X_ACCOUNTS. x_accounts now has ${count ?? '?'} row(s).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
