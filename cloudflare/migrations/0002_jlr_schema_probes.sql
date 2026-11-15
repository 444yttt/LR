-- Structure-only record of the JLR status/diagnostics responses (latest per endpoint).
-- paths_json holds key paths and value types only, e.g. "$.vehicle.range:number". Never values.
CREATE TABLE IF NOT EXISTS jlr_schema_probes (
  endpoint TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  http_status INTEGER,
  error_code TEXT,
  path_count INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0,
  paths_json TEXT NOT NULL DEFAULT '[]'
);
