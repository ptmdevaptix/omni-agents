import RSSParser from 'rss-parser';

const parser = new RSSParser();

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string;
  author?: string;
  excerpt?: string;
  imageUrl?: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  ldquo: '\u201C',
  rdquo: '\u201D',
  lsquo: '\u2018',
  rsquo: '\u2019',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
};

/**
 * Decode HTML entities (named and numeric) in a string.
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&([a-zA-Z]+);/g, (match, name) =>
      NAMED_ENTITIES[name] ?? match,
    );
}

// rss-parser's default request advertises a "rss-parser" agent, which some
// sites' WAFs (e.g. ESPN) block from datacenter / CI IPs, returning a non-XML
// page → "Unable to parse XML". Use a modest "compatible" UA (same as the NHL
// client): a FULL browser UA is worse — ESPN answers those with a 202 + empty
// body (its bot challenge for fake browsers), which also fails to parse.
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; OmniAgents/1.0; +https://github.com)',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
};

/**
 * Fetch and parse an RSS/Atom feed, returning normalized items.
 */
export async function fetchFeed(feedUrl: string): Promise<FeedItem[]> {
  const res = await fetch(feedUrl, {
    headers: FETCH_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const xml = await res.text();
  const feed = await parser.parseString(xml);

  return (feed.items ?? []).map((item) => ({
    title: decodeHtmlEntities(item.title ?? ''),
    url: item.link ?? '',
    publishedAt: item.isoDate ?? item.pubDate ?? '',
    author: item.creator ?? item['dc:creator']
      ? decodeHtmlEntities(item.creator ?? item['dc:creator'] ?? '')
      : undefined,
    excerpt: item.contentSnippet ?? item.content
      ? decodeHtmlEntities(item.contentSnippet ?? item.content ?? '')
      : undefined,
    imageUrl:
      item.enclosure?.url ??
      (item as Record<string, unknown>)['media:thumbnail']?.toString() ??
      undefined,
  }));
}
