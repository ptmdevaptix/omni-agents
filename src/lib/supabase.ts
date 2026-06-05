import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

/**
 * Lazily construct the Supabase client on first use. Building it at module
 * scope makes it run during Next's build-time page-data collection, which
 * fails ("supabaseUrl is required") if the env vars aren't present at build.
 * Deferring to first request means the build never needs DB credentials.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_ANON_KEY must be set to use the Supabase client',
      );
    }
    client = createClient(url, key);
  }
  return client;
}

/**
 * Drop-in `supabase` handle that defers client construction until the first
 * property access (e.g. `supabase.from(...)`), so importing this module never
 * touches env vars.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const c = getSupabase();
    const value = Reflect.get(c, prop, receiver);
    return typeof value === 'function' ? value.bind(c) : value;
  },
});
