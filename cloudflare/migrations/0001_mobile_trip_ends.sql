CREATE TABLE IF NOT EXISTS vehicle_trip_ends (
  vehicle_id TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  PRIMARY KEY (vehicle_id, ended_at)
);
