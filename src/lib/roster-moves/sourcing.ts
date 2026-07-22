/**
 * Sourcing policy (contract §4).
 *
 * We use a *licensed* X API and extract from ORIGINAL-SOURCE material only —
 * the tweet's own words, a school's own graphic/press release, the player's
 * own announcement. We deliberately do NOT fetch aggregator/paywalled links
 * (EliteProspects, College Hockey News, The Athletic, ...) and do not OCR
 * screenshots of competitor trackers. Missing those moves is fine; the
 * season-diff backfills them.
 */

/**
 * Domains we never fetch. These are paywalled or competitor aggregators whose
 * content we are intentionally not scraping. Extend as needed — this is the
 * key defensibility knob. Matched as a suffix (covers subdomains).
 */
export const BLOCKED_DOMAINS: readonly string[] = [
  'eliteprospects.com',
  'collegehockeynews.com',
  'theathletic.com',
  'uscho.com',
  'nytimes.com',
  'espn.com',
];

const URL_RE = /https?:\/\/[^\s)]+/gi;

/** Pull bare http(s) URLs out of tweet text. */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_RE) ?? [];
  // Trim trailing punctuation that commonly rides along.
  return matches.map((u) => u.replace(/[.,;:]+$/, ''));
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function isBlockedDomain(url: string): boolean {
  const host = domainOf(url);
  if (!host) return true; // unparseable → treat as unfetchable
  return BLOCKED_DOMAINS.some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
}

export interface ClassifiedLinks {
  /** Links we may fetch as original-source material. */
  fetchable: string[];
  /** Links we deliberately will not fetch (aggregator/paywalled). */
  blocked: string[];
}

/** Split a tweet's links into fetchable vs. deliberately-blocked. */
export function classifyLinks(text: string): ClassifiedLinks {
  const urls = [...new Set(extractUrls(text))];
  const fetchable: string[] = [];
  const blocked: string[] = [];
  for (const u of urls) {
    // Ignore self-referential x.com/twitter status links.
    const host = domainOf(u);
    if (host === 'x.com' || host === 'twitter.com' || host === 't.co') continue;
    (isBlockedDomain(u) ? blocked : fetchable).push(u);
  }
  return { fetchable, blocked };
}
