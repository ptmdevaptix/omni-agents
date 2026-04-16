import * as cheerio from 'cheerio';

export interface ArticleContent {
  text: string;
  success: boolean;
  truncated: boolean;
}

const MAX_CONTENT_LENGTH = 8000; // chars — keep within token budget

/**
 * Fetch a URL and extract the main article text from the HTML.
 * Strips navigation, ads, footers, scripts, and other non-content elements.
 */
export async function readArticle(url: string): Promise<ArticleContent> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; OmniAgents/1.0; +https://github.com)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { text: '', success: false, truncated: false };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return { text: '', success: false, truncated: false };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove non-content elements
    $(
      'script, style, nav, header, footer, aside, .sidebar, .ad, .advertisement, ' +
        '.social-share, .related-posts, .comments, .navigation, .menu, .breadcrumb, ' +
        'iframe, noscript, [role="navigation"], [role="banner"], [role="complementary"]',
    ).remove();

    // Try to find the main article content using common selectors
    const selectors = [
      'article',
      '[role="main"]',
      '.article-body',
      '.article-content',
      '.entry-content',
      '.post-content',
      '.story-body',
      '.article__body',
      '#article-body',
      'main',
    ];

    let content = '';

    for (const selector of selectors) {
      const el = $(selector);
      if (el.length > 0) {
        content = el
          .find('p, h1, h2, h3, h4, li')
          .map((_, el) => $(el).text().trim())
          .get()
          .filter((t) => t.length > 20) // skip tiny fragments
          .join('\n\n');

        if (content.length > 200) break; // found meaningful content
      }
    }

    // Fallback: grab all paragraphs from body
    if (content.length < 200) {
      content = $('body p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter((t) => t.length > 20)
        .join('\n\n');
    }

    // Clean up whitespace
    content = content.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    const truncated = content.length > MAX_CONTENT_LENGTH;
    if (truncated) {
      content = content.substring(0, MAX_CONTENT_LENGTH) + '...';
    }

    return {
      text: content,
      success: content.length > 100,
      truncated,
    };
  } catch {
    return { text: '', success: false, truncated: false };
  }
}
