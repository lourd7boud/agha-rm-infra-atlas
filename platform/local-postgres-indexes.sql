-- Runtime index needed by the continuous portal sentinel after restoring the
-- production append-only snapshot log.
CREATE INDEX IF NOT EXISTS portal_snapshot_source_url_fetched_idx
  ON watch.portal_snapshot (source, url, fetched_at DESC);
