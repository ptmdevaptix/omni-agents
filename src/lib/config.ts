export const config = {
  supabase: {
    url: process.env.SUPABASE_URL!,
    anonKey: process.env.SUPABASE_ANON_KEY!,
  },
  ai: {
    gatewayApiKey: process.env.AI_GATEWAY_API_KEY!,
  },
} as const;
