import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

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
