import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

export async function POST(request: NextRequest) {
  const { name, shortName, homepageUrl } = await request.json();

  const { data, error } = await supabase
    .from('article_sources')
    .insert({
      name,
      short_name: shortName,
      homepage_url: homepageUrl || null,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ source: data });
}
