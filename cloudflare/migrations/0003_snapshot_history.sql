-- Append-only history of the mapped telemetry the collector already writes to `snapshots` (one row per successful
-- collect). Used only to estimate fuel economy from odometer / fuel-level deltas. No VIN, no location, no raw payload,
-- no secrets. The collector keeps at most SNAPSHOT_HISTORY_LIMIT rows per vehicle (see src/worker.js).
CREATE TABLE IF NOT EXISTS snapshot_history (
  vehicle_id TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  fuel_percent REAL,
  odometer_km REAL,
  range_km REAL,
  soc_percent REAL,
  electric_range_km REAL,
  PRIMARY KEY (vehicle_id, fetched_at)
);
