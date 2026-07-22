import { readFile } from 'node:fs/promises';
import type { AccountPoll, MoveSource, PolledTweets, Tweet } from './index';

/**
 * Fixture source: reads tweets from a local JSON file instead of the X API,
 * so the whole pipeline (extract → resolve → upsert) can be exercised without
 * spending X budget or needing a token.
 *
 * Fixture shape: an array of tweets, each with a `handle`. Example:
 * [
 *   { "id": "1", "handle": "CHN_Adam", "text": "Welcome to Boston University! ...",
 *     "createdAt": "2026-07-01T00:00:00Z", "imageUrls": [] }
 * ]
 *
 * Point at it with ROSTER_MOVES_FIXTURE=/path/to/fixture.json.
 */

interface FixtureTweet {
  id: string;
  handle: string;
  text: string;
  createdAt?: string;
  imageUrls?: string[];
}

export function createFixtureSource(fixturePath: string): MoveSource {
  let cache: FixtureTweet[] | null = null;

  async function load(): Promise<FixtureTweet[]> {
    if (cache) return cache;
    const raw = await readFile(fixturePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Fixture ${fixturePath} must be a JSON array of tweets`);
    }
    cache = parsed as FixtureTweet[];
    return cache;
  }

  return {
    name: `fixture(${fixturePath})`,
    async poll(account: AccountPoll): Promise<PolledTweets> {
      const all = await load();
      const forHandle = all.filter(
        (t) => t.handle.replace(/^@/, '') === account.handle.replace(/^@/, ''),
      );
      const fresh = account.sinceId
        ? forHandle.filter((t) => t.id > account.sinceId!)
        : forHandle;

      const tweets: Tweet[] = fresh.map((t) => ({
        id: t.id,
        text: t.text,
        createdAt: t.createdAt ?? null,
        authorHandle: account.handle,
        imageUrls: t.imageUrls ?? [],
      }));

      const newestId = fresh.reduce<string | null>(
        (max, t) => (max === null || t.id > max ? t.id : max),
        null,
      );

      return { tweets, newestId, xUserId: account.xUserId };
    },
  };
}
