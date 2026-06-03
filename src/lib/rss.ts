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

/**
 * Fetch and parse an RSS/Atom feed, returning normalized items.
 */
export async function fetchFeed(feedUrl: string): Promise<FeedItem[]> {
  const feed = await parser.parseURL(feedUrl);

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
