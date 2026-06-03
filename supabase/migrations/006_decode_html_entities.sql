-- ============================================================
-- One-off cleanup: decode HTML entities in existing articles.
-- Covers title, excerpt, and author columns.
-- ============================================================

-- Helper function for reusable entity decoding
CREATE OR REPLACE FUNCTION decode_html_entities(input text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(
      input,
      '&amp;', '&'),
      '&lt;', '<'),
      '&gt;', '>'),
      '&quot;', '"'),
      '&apos;', ''''),
      '&nbsp;', ' '),
      '&ldquo;', E'\u201C'),
      '&rdquo;', E'\u201D'),
      '&lsquo;', E'\u2018'),
      '&rsquo;', E'\u2019'),
      '&mdash;', E'\u2014'),
      '&ndash;', E'\u2013'),
      '&hellip;', E'\u2026')
$$;

-- Decode title
UPDATE articles
SET title = decode_html_entities(title)
WHERE title ~ '&[a-zA-Z]+;|&#[0-9]+;|&#x[0-9a-fA-F]+;';

-- Decode excerpt
UPDATE articles
SET excerpt = decode_html_entities(excerpt)
WHERE excerpt IS NOT NULL
  AND excerpt ~ '&[a-zA-Z]+;|&#[0-9]+;|&#x[0-9a-fA-F]+;';

-- Decode author
UPDATE articles
SET author = decode_html_entities(author)
WHERE author IS NOT NULL
  AND author ~ '&[a-zA-Z]+;|&#[0-9]+;|&#x[0-9a-fA-F]+;';

-- Handle numeric entities (&#39; &#8217; etc.) that the named replace missed.
-- PostgreSQL doesn't have a simple regex-replace-with-codepoint, so handle the
-- most common numeric ones explicitly.
UPDATE articles
SET title = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
  title,
  '&#39;', ''''),
  '&#34;', '"'),
  '&#38;', '&'),
  '&#8217;', E'\u2019'),
  '&#8216;', E'\u2018')
WHERE title ~ '&#[0-9]+;';

UPDATE articles
SET excerpt = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
  excerpt,
  '&#39;', ''''),
  '&#34;', '"'),
  '&#38;', '&'),
  '&#8217;', E'\u2019'),
  '&#8216;', E'\u2018')
WHERE excerpt IS NOT NULL AND excerpt ~ '&#[0-9]+;';

UPDATE articles
SET author = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
  author,
  '&#39;', ''''),
  '&#34;', '"'),
  '&#38;', '&'),
  '&#8217;', E'\u2019'),
  '&#8216;', E'\u2018')
WHERE author IS NOT NULL AND author ~ '&#[0-9]+;';

-- Clean up the helper function (optional — drop if you don't want it lingering)
DROP FUNCTION decode_html_entities(text);
