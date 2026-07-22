import type { AccountPoll, MoveSource, PolledTweets, Tweet } from './index';

/**
 * Live X (Twitter) API v2 source. Incremental per-account polling with
 * since_id keeps reads cheap (~$0.005/read; contract §4).
 *
 * Needs X_BEARER_TOKEN in env. Excludes retweets/replies so we only see an
 * account's own original announcements (original-source policy).
 */

const API = 'https://api.twitter.com/2';
const MAX_RESULTS = 20;

interface XMedia {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
}

interface XTweet {
  id: string;
  text: string;
  created_at?: string;
  attachments?: { media_keys?: string[] };
}

interface XTimeline {
  data?: XTweet[];
  includes?: { media?: XMedia[] };
  meta?: { newest_id?: string; result_count?: number };
  errors?: unknown;
  title?: string;
  detail?: string;
}

function bearer(): string {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    throw new Error('X_BEARER_TOKEN must be set to use the live X API source');
  }
  return token;
}

async function xGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`X API ${res.status} ${res.statusText} for ${path}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function resolveUserId(handle: string): Promise<string> {
  const clean = handle.replace(/^@/, '');
  const data = await xGet<{ data?: { id: string }; title?: string; detail?: string }>(
    `/users/by/username/${clean}`,
    {},
  );
  if (!data.data?.id) {
    throw new Error(`Could not resolve X user id for @${clean}: ${data.detail ?? 'not found'}`);
  }
  return data.data.id;
}

function imagesFor(tweet: XTweet, media: XMedia[]): string[] {
  const keys = new Set(tweet.attachments?.media_keys ?? []);
  if (keys.size === 0) return [];
  const urls: string[] = [];
  for (const m of media) {
    if (!keys.has(m.media_key)) continue;
    const url = m.url ?? m.preview_image_url;
    if (url) urls.push(url);
  }
  return urls;
}

export const xApiSource: MoveSource = {
  name: 'x-api',
  async poll(account: AccountPoll): Promise<PolledTweets> {
    const userId = account.xUserId ?? (await resolveUserId(account.handle));

    const params: Record<string, string> = {
      max_results: String(MAX_RESULTS),
      exclude: 'retweets,replies',
      'tweet.fields': 'created_at,attachments',
      expansions: 'attachments.media_keys',
      'media.fields': 'url,type,preview_image_url',
    };
    if (account.sinceId) params.since_id = account.sinceId;

    const timeline = await xGet<XTimeline>(`/users/${userId}/tweets`, params);
    const media = timeline.includes?.media ?? [];

    const tweets: Tweet[] = (timeline.data ?? []).map((t) => ({
      id: t.id,
      text: t.text,
      createdAt: t.created_at ?? null,
      authorHandle: account.handle,
      imageUrls: imagesFor(t, media),
    }));

    return {
      tweets,
      newestId: timeline.meta?.newest_id ?? null,
      xUserId: userId,
    };
  },
};
