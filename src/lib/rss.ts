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

/** Strip tags and collapse whitespace — enough to turn feed HTML into prose. */
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Plain-text body for an item.
 *
 * Publishers disagree about where the text lives. Most fill <description>, but
 * WordPress feeds (chl.ca's club sites, for one) leave it empty and put the
 * whole story in <content:encoded> — which left those items with no text at all
 * for the topic gate and for the fallback when the page read fails.
 */
function itemText(item: Record<string, unknown>): string | undefined {
  const candidates = [
    item.contentSnippet,
    item['content:encodedSnippet'],
    item.content,
    item['content:encoded'],
  ];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const text = stripHtml(c);
    if (text) return decodeHtmlEntities(text);
  }
  return undefined;
}

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
    excerpt: itemText(item as Record<string, unknown>),
    imageUrl:
      item.enclosure?.url ??
      (item as Record<string, unknown>)['media:thumbnail']?.toString() ??
      undefined,
  }));
}
