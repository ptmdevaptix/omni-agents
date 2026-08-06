import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * Content generation prompts editor. The generator fuses `base` + a per-type
 * prompt at generation time (src/lib/content/prompts.ts), so edits here change
 * future generations without a deploy.
 */

export async function GET() {
  const { data, error } = await supabase
    .from('content_prompts')
    .select('*')
    .order('key');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ prompts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { key, label, systemPrompt } = await request.json();
  if (!key || !systemPrompt) {
    return Response.json({ error: 'key and systemPrompt required' }, { status: 400 });
  }
  const { error } = await supabase.from('content_prompts').insert({
    key,
    label: label || null,
    system_prompt: systemPrompt,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const { id, systemPrompt, active, label } = await request.json();
  if (id === undefined) {
    return Response.json({ error: 'id required' }, { status: 400 });
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (systemPrompt !== undefined) {
    patch.system_prompt = systemPrompt;
    // bump version when the text changes
    const { data: cur } = await supabase
      .from('content_prompts')
      .select('version')
      .eq('id', id)
      .maybeSingle();
    patch.version = (cur?.version ?? 1) + 1;
  }
  if (active !== undefined) patch.active = active;
  if (label !== undefined) patch.label = label || null;

  const { error } = await supabase.from('content_prompts').update(patch).eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ success: true });
}
