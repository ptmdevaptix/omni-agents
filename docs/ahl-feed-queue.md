# AHL club feeds — investigation queue

23 of 32 AHL clubs now have a club-site feed in `article_feeds` (source per club,
`team_id` and `league_id` set). These nine resisted automated discovery and need
a person to look at the site.

Everything below was tried on 2026-08-28 with the scanner's own `fetchFeed`
(User-Agent `OmniAgents/1.0`, `Accept-Language` set). Clubs already working are
not listed — see `article_feeds` where `name LIKE 'AHL %'`.

## How these were searched

For each club: `/news/rss` on `www.<domain>` and `<domain>`, then any
`<link rel="alternate" type="application/rss+xml">` the homepage advertises, then
`/rss`, `/feed`, `/news/feed`, `/rss.xml`, `/feeds/news.xml`, `/news/rss.xml`.
For the Craft sites, also `/news.rss`, `/feed.xml`, `/news/feed.xml`, `/news.xml`,
`/rss/news`, `/blog/rss`, `/atom.xml`, `/index.rss`, `/news?format=rss`.

## The queue

| # | Club | Domain | What happens | Where to look next |
|---|------|--------|--------------|--------------------|
| 1 | **Toronto Marlies** | torontomarlies.com | Does not resolve — every request fails at DNS. But **marlies.ca returns 200** | Start here; it is the most likely quick win. Try `marlies.ca/news/rss` and the standard paths against that domain |
| 2 | **Abbotsford Canucks** | abbotsfordcanucks.com | Site is 200, but `/news/rss`, `/rss`, `/feed`, `/news/feed`, `/rss.xml` all return a **114-byte HTML stub** rather than 404 | A stub that size usually means a JS-rendered shell. View source on the news page and search for `rss`; failing that the news may only exist behind an API the page calls |
| 3 | **Hershey Bears** | hersheybears.com | `/news/rss` 404, one request timed out. No CMS fingerprint | Check the news page source for a feed link |
| 4 | **Cleveland Monsters** | clevelandmonsters.com | `/news/rss` 404; 16 paths tried, none served XML | Craft CMS + SEOmatic — see the note below |
| 5 | **Grand Rapids Griffins** | griffinshockey.com | Same | Craft CMS + SEOmatic |
| 6 | **Ontario Reign** | ontarioreign.com | Same | Craft CMS + SEOmatic |
| 7 | **Rockford IceHogs** | icehogs.com | Same | Craft CMS + SEOmatic |
| 8 | **Springfield Thunderbirds** | springfieldthunderbirds.com | Same (also runs Shopify for the store) | Craft CMS + SEOmatic |
| 9 | **San Jose Barracuda** | sjbarracuda.com | `/news/rss` 404. The alternate domain sanjosebarracuda.com returns **HTTP 522** (Cloudflare: origin unreachable) and then times out | Craft CMS + SEOmatic; sjbarracuda.com is the live one |

### The Craft/SEOmatic cluster

Six of the nine (Cleveland, Grand Rapids, Ontario, Rockford, Springfield, San
Jose — and Toronto's dead domain) return `<meta name="generator" content="SEOmatic">`,
the SEO plugin for Craft CMS. They are the same vendor build, so **one feed path
found on any of them very probably works on all six.** That makes this a single
investigation worth doing before the individual ones:

1. Open any of those clubs' news page and view source; search for
   `application/rss+xml`, `rss`, or `feed`.
2. If nothing, check whether the vendor exposes feeds under a section handle
   rather than a fixed path (Craft routes are author-defined — it could be
   anything, e.g. `/latest-news.rss`).
3. If still nothing, these sites may simply not publish RSS, in which case the
   fallback is theahl.com's league-wide news, or asking the clubs.

## Notes for whoever picks this up

- **Add a feed** the way the others were added: one `article_sources` row per
  club (`name` = "Place Nickname", `short_name` = the team abbreviation,
  `homepage_url` = the site origin), then an `article_feeds` row with
  `name` = "AHL Place Nickname", the feed URL, `league_id` = AHL,
  `team_id` = the club, `is_active` = true. RLS allows both inserts with the
  anon key.
- **Verify before adding.** Parse it with `fetchFeed` and confirm items have
  titles, URLs and dates. A feed that parses but returns zero items is not worth
  a row yet — Bakersfield looked like that at `/news/rss` and turned out to
  publish at `/feed/`.
- **Unescape `&amp;`** if the URL comes from a `<link>` tag. Charlotte's feed is
  `?format=feed&type=rss`; stored with `&amp;` it would send the server a
  parameter called `amp;type`.
- **A 406 is not a dead end.** hamiltonhammers.com rejects a request that carries
  a User-Agent and an Accept but no `Accept-Language`. `fetchFeed` now sends one.
- **Not urgent.** Every club here still gets covered by the league and
  cross-league feeds; what they lack is their own club-site wire.
