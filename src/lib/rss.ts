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

/**
 * Fetch and parse an RSS/Atom feed, returning normalized items.
 */
export async function fetchFeed(feedUrl: string): Promise<FeedItem[]> {
  const feed = await parser.parseURL(feedUrl);

  return (feed.items ?? []).map((item) => ({
    title: item.title ?? '',
    url: item.link ?? '',
    publishedAt: item.isoDate ?? item.pubDate ?? '',
    author: item.creator ?? item['dc:creator'] ?? undefined,
    excerpt: item.contentSnippet ?? item.content ?? undefined,
    imageUrl:
      item.enclosure?.url ??
      (item as Record<string, unknown>)['media:thumbnail']?.toString() ??
      undefined,
  }));
}
