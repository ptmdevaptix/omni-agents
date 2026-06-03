-- ============================================================
-- Scan Runs
-- Tracks each feed scan job with timing and results.
-- ============================================================

CREATE TABLE scan_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  feed_id uuid REFERENCES article_feeds(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',  -- running, completed, failed
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  articles_found integer DEFAULT 0,
  articles_saved integer DEFAULT 0,
  articles_skipped integer DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- NULL feed_id means "scan all feeds"
CREATE INDEX idx_scan_runs_feed_id ON scan_runs(feed_id);
CREATE INDEX idx_scan_runs_started ON scan_runs(started_at DESC);

-- RLS
ALTER TABLE scan_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access to scan_runs" ON scan_runs
  FOR SELECT USING (true);
CREATE POLICY "Allow insert to scan_runs" ON scan_runs
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update to scan_runs" ON scan_runs
  FOR UPDATE USING (true);
