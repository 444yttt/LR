-- Production baseline for the garage-monitor D1 database.
-- Derived from the collector and gateway SQL. Existing production databases
-- already have these tables and must mark this file applied instead of executing it.
-- Fresh databases can apply it: every statement is CREATE TABLE IF NOT EXISTS.
-- vehicle_trip_ends is intentionally absent; migration 0001 adds it.

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  make TEXT,
  model TEXT,
  model_year INTEGER,
  display_name TEXT,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  vehicle_id TEXT PRIMARY KEY,
  fetched_at TEXT,
  source TEXT,
  last_drive_at TEXT,
  last_drive_verified INTEGER,
  data_status TEXT,
  error_code TEXT,
  payload_json TEXT,
  updated_at TEXT,
  range_km REAL,
  electric_range_km REAL,
  fuel_percent REAL,
  soc_percent REAL,
  battery_12v_voltage REAL,
  health_status TEXT,
  faults_count INTEGER,
  odometer_km REAL,
  status_updated_at TEXT,
  health_updated_at TEXT,
  maintenance_due_count INTEGER
);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  threshold_days INTEGER NOT NULL,
  last_drive_at TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  -- INSERT OR IGNORE records each inactivity threshold once per trip end.
  UNIQUE (vehicle_id, alert_type, threshold_days, last_drive_at)
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  finished_at TEXT,
  page_count INTEGER,
  journey_count INTEGER,
  error_code TEXT
);

CREATE TABLE IF NOT EXISTS credential_vault (
  provider TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_capabilities (
  vehicle_id TEXT NOT NULL,
  field TEXT NOT NULL,
  state TEXT,
  updated_at TEXT,
  PRIMARY KEY (vehicle_id, field)
);
