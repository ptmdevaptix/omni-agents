/**
 * GopherPuckLive NCAA transfer-portal source.
 *
 * The public portal page is backed by a static JSON file (division-keyed),
 * refreshed by the site. It's clean structured data, so we parse it
 * deterministically — no LLM, no cost. We target D1 men (the league this app
 * covers). Each row is a player who has ENTERED the portal (leaving `School`),
 * optionally with a committed destination (`Transfered To`).
 */

export const GPL_PORTAL_D1_MEN_URL =
  'https://gopherpucklive.com/wp-content/uploads/gpl-portal-data/d1_men.json';

export interface PortalEntry {
  /** Reported date (as printed, e.g. "5/22/2026"). */
  date: string;
  name: string;
  /** Origin school (the one the player is leaving). */
  school: string;
  /** Position: 'F' | 'D' | 'G' | null. */
  position: 'F' | 'D' | 'G' | null;
  /** Committed destination school, or '' if still uncommitted. */
  transferedTo: string;
  gradTransfer: boolean;
  noContact: boolean;
  /** Years of eligibility remaining, as printed. */
  eligibilityYears: string;
  /** Site-relative link fragment, used as a stable-ish provenance ref. */
  urlText: string;
}

interface PortalJson {
  type?: string;
  headers: string[];
  data: string[][];
  last_updated?: string;
}

/**
 * Portal-specific school aliases. The portal writes bare "Alaska" for Alaska
 * Fairbanks (it lists "Alaska-Anchorage" separately), which our generic
 * resolver treats as ambiguous. Applied only to the portal's own strings.
 */
const SCHOOL_ALIASES: Record<string, string> = {
  Alaska: 'Alaska Fairbanks',
};

function applyAlias(school: string): string {
  return SCHOOL_ALIASES[school.trim()] ?? school;
}

/** True when the destination is a pro signing rather than an NCAA transfer. */
export function isProDestination(transferedTo: string): boolean {
  return /^\s*signed pro/i.test(transferedTo);
}

function mapPosition(pos: string): 'F' | 'D' | 'G' | null {
  const p = pos.trim().toLowerCase();
  if (p.startsWith('fwd') || p === 'f') return 'F';
  if (p.startsWith('def') || p === 'd') return 'D';
  if (p.startsWith('goal') || p === 'g') return 'G';
  return null;
}

export interface PortalFetch {
  entries: PortalEntry[];
  lastUpdated: string | null;
}

/** Fetch and parse the D1 men transfer-portal feed. */
export async function fetchPortalEntries(
  url: string = GPL_PORTAL_D1_MEN_URL,
): Promise<PortalFetch> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OmniAgents/1.0; +https://github.com)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`Portal fetch failed: HTTP ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as PortalJson;
  if (!Array.isArray(json.headers) || !Array.isArray(json.data)) {
    throw new Error('Portal JSON missing headers/data');
  }

  const idx: Record<string, number> = {};
  json.headers.forEach((h, i) => (idx[h] = i));
  const cell = (row: string[], key: string): string => {
    const i = idx[key];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };

  const entries: PortalEntry[] = json.data
    .map((row) => ({
      date: cell(row, 'Date'),
      name: cell(row, 'Name'),
      school: applyAlias(cell(row, 'School')),
      position: mapPosition(cell(row, 'Pos')),
      transferedTo: applyAlias(cell(row, 'Transfered To')),
      gradTransfer: cell(row, 'Grad Transfer').toUpperCase() === 'Y',
      noContact: cell(row, 'No Contact').toUpperCase() === 'Y',
      eligibilityYears: cell(row, 'Eligibility Years'),
      urlText: cell(row, 'URL Text'),
    }))
    // A row needs at least a player and an origin school to be usable.
    .filter((e) => e.name && e.school);

  return { entries, lastUpdated: json.last_updated ?? null };
}

/** Parse a portal "M/D/YYYY" date to an ISO timestamp, or null if unparseable. */
export function portalDateToIso(date: string): string | null {
  const m = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
