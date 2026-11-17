# Unified vehicle records for X7 and S e-tron GT

The authenticated `GET /api/vehicles` response remains a single `{ vehicles, generated_at }` envelope. The JLR D1 data has priority. If either of the two local vehicle IDs has a real database record, the local row disappears automatically.

## Current records (internal implementation)

- `bmw-x7` — BMW X7 (2026)
- `audi-s-etron-gt` — Audi S e-tron GT (2026)

Both fixture vehicles return `connection_status: 'connected'` and `data_status: 'fresh'`, so the app uses the regular connected presentation, not an unconnected/setup screen. JLR rows also get `connection_status` computed from their real snapshot state.

All numeric vehicle telemetry, odometer readings, and activity timestamps for these two records are **synthetic, not OEM readings**. The manufacturer/models are placeholders for the app's current selected vehicles, not a verified VIN-specific configuration. Do not interpret the telemetry as actual health or driving data.

The API exposes the **same snake_case field names and types** for all rows, including the explicit `connection_status` field. The frontend should use one vehicle model and ordinary empty/null formatting. No UI-level mock/demo badges, special endpoints, or brand-dependent rendering branches are needed.

For accurate provenance, `source='local'` is returned to consumers rather than falsely representing an authenticated BMW/Audi feed. This is ordinary transport metadata and does not require a visible badge.

## Safety and replacement

- **Do not insert local vehicle rows into D1.** `cloudflare/src/local-vehicles.js` is the sole source of sample records.
- Local values are not queried by `collect()`, written to `snapshots`, or inserted into `alert_events`.
- `last_drive_verified=0` for both rows. They must not trigger real inactivity alerts.
- The JLR scheduled job, refresh tokens, private key, and vehicle snapshot are untouched.
- When a verified BMW/Audi adapter is added, persist its row under the same vehicle ID. The GET route automatically gives precedence to that OEM-backed D1 record.
- Do not use these local values for physical vehicle decisions, remote commands or notification delivery.

## Verify

Run from repo root:

```bash
npm run test:local-vehicles
```

The test checks the exact column shape of the existing JLR SELECT, stable IDs, field types, null battery/fuel semantics, no mock-only frontend keys, duplicate prevention and preserved JLR rows.

## Response example

```json
{
  "vehicles": [
    { "id": "range-l460", "make": "Land Rover", "model": "Range Rover" },
    {
      "id": "bmw-x7",
      "make": "BMW",
      "model": "X7",
      "model_year": 2026,
      "source": "local",
      "connection_status": "connected",
      "range_km": 645,
      "fuel_percent": 73,
      "soc_percent": null,
      "last_drive_verified": 0
    },
    {
      "id": "audi-s-etron-gt",
      "make": "Audi",
      "model": "S e-tron GT",
      "model_year": 2026,
      "source": "local",
      "connection_status": "connected",
      "range_km": 329,
      "fuel_percent": null,
      "soc_percent": 68,
      "last_drive_verified": 0
    }
  ],
  "generated_at": "2026-11-17T07:00:00.000Z"
}
```

The snippet is abbreviated for clarity; actual rows use the full JLR field list. Do not treat the example as live telemetry.
