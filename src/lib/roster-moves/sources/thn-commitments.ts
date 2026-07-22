import { resolveNcaaTeam, type ResolvedTeam } from '../resolve';

/**
 * The Hockey News "NCAA Roster Tracker" commitments live blog.
 *
 * Prose, but regular: a hierarchy of conference → team headers, with player
 * entries listed under the team they committed to. Entries read:
 *   `Player Name [source-url], Pos, PreviousTeam`            (dest = team header)
 *   `Player Name [source-url], Pos, PreviousTeam — Dest`     (explicit dest)
 *
 * The previous team decides commit vs transfer: an NCAA D1 origin → transfer_in,
 * anything else (junior/USHL/Europe) → commit. Parsed deterministically (no LLM)
 * off the article's ld+json `articleBody`.
 */

export const THN_COMMITMENTS_URL =
  'https://thehockeynews.com/ncaa/latest-news/commitments-live-blog';

/** Conference/section headers to skip (not teams, don't set destination). */
const SECTION_HEADERS = new Set([
  'nchc',
  'hockey east',
  'big ten',
  'ecac',
  'ecac hockey',
  'atlantic hockey',
  'atlantic hockey america',
  'aha',
  'ccha',
  'independent',
  'independents',
]);

const URL_RE = /\[(https?:\/\/[^\]]+)\]|\((https?:\/\/[^)]+)\)/;
const POS_INLINE_RE = /,\s*(F|D|G)\s*,/;
const DASH_SPLIT_RE = /\s[—–]\s/;

export interface CommitmentEntry {
  playerName: string;
  position: 'F' | 'D' | 'G' | null;
  /** Origin team as written (junior club or NCAA school). */
  prevTeamName: string;
  /** Destination NCAA school as written (from header or explicit "— Dest"). */
  destTeamName: string;
  destTeam: ResolvedTeam;
  sourceUrl: string | null;
}

export interface CommitmentsDoc {
  entries: CommitmentEntry[];
  lastModified: string | null;
}

interface NewsArticleLd {
  '@type': string | string[];
  articleBody?: string;
  dateModified?: string;
}

/** Pull the NewsArticle ld+json (articleBody + dateModified) from the page. */
function extractArticle(html: string): NewsArticleLd | null {
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => m[1]);
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b);
      for (const o of ([] as NewsArticleLd[]).concat(parsed)) {
        const type = o['@type'];
        const isArticle = Array.isArray(type)
          ? type.includes('NewsArticle')
          : type === 'NewsArticle';
        if (isArticle && o.articleBody) return o;
      }
    } catch {
      // skip unparseable block
    }
  }
  return null;
}

function extractPosition(segments: string[]): 'F' | 'D' | 'G' | null {
  for (const s of segments) {
    const t = s.trim().toUpperCase();
    if (t === 'F' || t === 'D' || t === 'G') return t;
  }
  return null;
}

/**
 * Parse the article body into commitment entries, tracking the current team
 * header as the destination. Async because header detection resolves names
 * against the NCAA teams (a line is a team header iff it resolves to a team).
 */
export async function parseCommitments(
  articleBody: string,
): Promise<CommitmentEntry[]> {
  const paras = articleBody
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const entries: CommitmentEntry[] = [];
  let currentTeam: ResolvedTeam | null = null;
  let currentTeamName = '';

  for (const p of paras) {
    const looksEntry = URL_RE.test(p) || POS_INLINE_RE.test(p);

    if (!looksEntry) {
      const low = p.toLowerCase();
      if (low === 'latest updates') {
        // The "latest updates" list carries explicit "— Dest"; no header dest.
        currentTeam = null;
        currentTeamName = '';
        continue;
      }
      if (SECTION_HEADERS.has(low)) continue;
      // A short line that resolves to an NCAA team is a team header.
      if (p.length <= 40) {
        const r = await resolveNcaaTeam(p);
        if (r?.teamId) {
          currentTeam = r;
          currentTeamName = p;
        }
      }
      continue;
    }

    // Entry line.
    const urlMatch = p.match(URL_RE);
    const sourceUrl = urlMatch ? (urlMatch[1] ?? urlMatch[2] ?? null) : null;
    const urlIdx = urlMatch ? p.indexOf(urlMatch[0]) : -1;
    const commaIdx = p.indexOf(',');
    const nameEnd = Math.min(
      urlIdx === -1 ? p.length : urlIdx,
      commaIdx === -1 ? p.length : commaIdx,
    );
    const playerName = p.slice(0, nameEnd).replace(/,$/, '').trim();
    if (!playerName || playerName.split(' ').length < 2) continue;

    // Explicit "— Dest" overrides the current team header.
    const dashParts = p.split(DASH_SPLIT_RE);
    let destTeam = currentTeam;
    let destTeamName = currentTeamName;
    if (dashParts.length > 1) {
      destTeamName = dashParts[dashParts.length - 1].trim();
      destTeam = await resolveNcaaTeam(destTeamName);
    }
    if (!destTeam || !destTeamName) continue; // no destination context

    const beforeDash = dashParts[0];
    const segs = beforeDash
      .split(',')
      .map((s) => s.replace(URL_RE, '').trim())
      .filter(Boolean);
    const prevTeamName = segs.length ? segs[segs.length - 1] : '';
    if (!prevTeamName) continue;

    entries.push({
      playerName,
      position: extractPosition(segs.slice(1)),
      prevTeamName,
      destTeamName,
      destTeam,
      sourceUrl,
    });
  }

  return entries;
}

/** Fetch + parse the commitments tracker. */
export async function fetchCommitments(
  url: string = THN_COMMITMENTS_URL,
): Promise<CommitmentsDoc> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OmniAgents/1.0; +https://github.com)',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`THN fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const article = extractArticle(html);
  if (!article?.articleBody) {
    throw new Error('THN commitments: could not find NewsArticle articleBody');
  }
  const entries = await parseCommitments(article.articleBody);
  return { entries, lastModified: article.dateModified ?? null };
}
