import { supabase } from '../supabase';

/**
 * Content generation prompts, stored in the DB (content_prompts) so they can be
 * tweaked over time without a code deploy. A generic `base` prompt is fused with
 * a per-type prompt (e.g. 'game_preview.opener'). Code defaults below are the
 * seed + a fallback if the table/row is missing, so generation always works.
 */

export const PROMPT_DEFAULTS: Record<string, string> = {
  base: `You are a professional hockey writer producing concise, publication-ready copy for a hockey news site.
Rules that ALWAYS apply:
- Use ONLY the facts provided. Never invent players, injuries, transactions, statistics, scores, dates, or storylines that are not given.
- Each past result states its winner explicitly ("X beat Y"). Report results exactly as given; never re-derive who won from a score.
- Write in a natural, engaging sports-media voice. Do not put a headline inside the body — a title is added separately.`,

  'game_preview.opener': `Task: write a season-OPENER game preview.
- Frame it as the first game of the new season.
- Naturally work in last season's head-to-head results and how each team finished last season (record + playoff outcome).
- If the facts say it is the opener for only one team, note that the other team has already begun its season.
- Body: ~180-240 words across 3-4 short paragraphs.`,

  'game_preview.in_season': `Task: write an in-season game preview.
- Emphasize each team's recent form (streaks, standings), any noted injuries/returns, and earlier meetings this season (including notable events).
- Body: ~180-240 words across 3-4 short paragraphs.`,
};

export interface LoadedPrompt {
  system: string;
  usedKeys: string[];
  versions: Record<string, number>;
  source: 'db' | 'default' | 'mixed';
}

/**
 * Build the fused system prompt for a content type: `base` + the type prompt,
 * preferring active DB rows and falling back to the code defaults.
 */
export async function loadSystemPrompt(typeKey: string): Promise<LoadedPrompt> {
  const keys = ['base', typeKey];
  let rows: { key: string; system_prompt: string; version: number }[] = [];
  try {
    const { data } = await supabase
      .from('content_prompts')
      .select('key, system_prompt, version')
      .in('key', keys)
      .eq('active', true);
    rows = data ?? [];
  } catch {
    // table missing → all defaults
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const parts: string[] = [];
  const usedKeys: string[] = [];
  const versions: Record<string, number> = {};
  let fromDb = false;
  let fromDefault = false;

  for (const k of keys) {
    const row = byKey.get(k);
    if (row) {
      parts.push(row.system_prompt);
      usedKeys.push(k);
      versions[k] = row.version;
      fromDb = true;
    } else if (PROMPT_DEFAULTS[k]) {
      parts.push(PROMPT_DEFAULTS[k]);
      usedKeys.push(`${k}(default)`);
      versions[k] = 0;
      fromDefault = true;
    }
  }

  return {
    system: parts.join('\n\n'),
    usedKeys,
    versions,
    source: fromDb && fromDefault ? 'mixed' : fromDb ? 'db' : 'default',
  };
}
