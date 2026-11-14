# Garage Monitor | Cloudflare Deployment

This is the read-only Cloudflare backend for a future multi-brand private garage monitor.

**Current deployment (2026-11-12):** Worker `garage-monitor` and D1 `garage-monitor` exist. All six JLR/garage secrets were confirmed bound through Cloudflare. The Range Rover vehicle is enabled and daily Cron is scheduled for 00:10 UTC (09:10 JST). **No scheduled execution, snapshot, or successful Cloudflare-side JLR fetch has yet been observed.** Automatic inactivity alerts remain withheld until OEM Remote timestamp confirmation; no push notifier is connected.

## Architecture
- Private Cloudflare Worker; `workers_dev=false`, no public hostname enabled
- D1: vehicles, snapshots, alert_events, ingestion_runs, credential_vault, telemetry_capabilities
- JLR OAuth Device Code for initial consent, then refresh tokens with PS256 client assertion and DPoP.
- Refresh token rotation saved in D1 encrypted at rest using AES-GCM and a 256-bit Worker secret; **do not overwrite the vault encryption key after the first live refresh**.
- Manufacturer-specific adapters normalize telemetry to common units; unavailable fields remain null.
- First successful journey read is `last_drive_verified=0` by design; cross-check against Remote and only then enable trusted inactivity alerts.
- A daily Cron schedule is active remotely (00:10 UTC). It has not yet produced a confirmed successful run. Keep secrets and bindings intact during changes.
- The Worker has no public API without `GARAGE_API_TOKEN`. Eventually place behind Cloudflare Access or an app backend and replace shared token access with short-lived per-user auth.

## D1 migrations

Migrations live in `cloudflare/migrations` and are applied with Wrangler from `cloudflare/` against the D1 database name `garage-monitor`. Wrangler records filenames in `d1_migrations` (`id`, `name`, `applied_at`). Production was created before that table existed, so it has `vehicles`, `snapshots`, `alert_events`, `ingestion_runs`, `credential_vault`, and `telemetry_capabilities`, and it does not have `d1_migrations` or `vehicle_trip_ends`.

`0000_baseline.sql` is the inferred production schema (`CREATE TABLE IF NOT EXISTS` only). Do not execute it on the live database: stamp it as already applied, then apply `0001_mobile_trip_ends.sql`. Do not rotate `JLR_VAULT_KEY` or any other secret as part of this. Do not deploy the collector until `0001` is applied, because the collector writes `vehicle_trip_ends`.

```bash
cd cloudflare

# Names only. Do not select vault, snapshot, or journey rows.
npx wrangler d1 execute garage-monitor --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

npx wrangler d1 execute garage-monitor --remote --command \
  "CREATE TABLE IF NOT EXISTS d1_migrations(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT UNIQUE,
     applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
   );"

npx wrangler d1 execute garage-monitor --remote --command \
  "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0000_baseline.sql');"

npx wrangler d1 migrations list garage-monitor --remote
# 0000_baseline.sql applied, 0001_mobile_trip_ends.sql pending.

npx wrangler d1 migrations apply garage-monitor --remote
```

A brand-new database skips the stamp and runs `npx wrangler d1 migrations apply garage-monitor --remote`, which applies `0000` and then `0001`.

Collector deploy, after the migration above and without changing secrets:

```bash
cd cloudflare
npx wrangler deploy
```

The mobile gateway is a separate Worker and is not deployed yet. Deploy it only after `GARAGE_ISSUER`, `GARAGE_JWKS_URL`, `GARAGE_AUDIENCE`, and `GARAGE_OWNER_SUB` are set on that Worker:

```bash
cd cloudflare/mobile-gateway
npx wrangler deploy
```

TestFlight reads `EXPO_PUBLIC_GARAGE_API_URL`, `EXPO_PUBLIC_GARAGE_ISSUER`, `EXPO_PUBLIC_GARAGE_CLIENT_ID`, and `EXPO_PUBLIC_GARAGE_RESOURCE` from GitHub repository Variables. Set those variables, then rerun the TestFlight workflow. Empty variables leave the app unconfigured. A build made before the variables exist does not pick them up later.

## One-time iPhone/Codespaces secret provisioning
From the repository root:
```bash
git pull
bash scripts/provision-cloudflare.sh
```
This requires completing Wrangler OAuth in the browser and typing the VIN privately in the terminal. Secret values never pass through Git or chat.

**Important:** The Cloudflare account ID embedded in this repo is for the previously selected connected Cloudflare account. Confirm that Wrangler `whoami` targets that account. Do not transfer keys to an unrelated account.

The scripts run `wrangler secret put` against the existing Worker. Do **not** run `wrangler deploy` before reviewing bindings and configuration because it can replace deployed configuration.

## Verified prior to deployment
JLR owner API was tested from Codespaces using Japanese L460:
- OAuth refresh HTTP 200, vehicle metadata HTTP 200, status HTTP 200, journeys HTTP 200
- 29 journey items across 2 pages, latest observed trip end 2026-11-08T06:00:29Z
- Not yet checked against Land Rover Remote display.

## Telemetry semantics
`last_drive_at` is journey end, **not** engine start or 12V battery-health proof. `range_km` is OEM-estimated, never inferred from fuel level. `health_status` is JLR diagnostics categorical state and does not mean a full workshop health inspection. Each field has a source and freshness expectation. No trip GPS points are stored.

## Remaining gates before trustworthy notifications
1. Verify first scheduled Worker execution and its D1 run details.
2. Confirm Cloudflare-side token refresh and persistent encrypted rotation.
3. Compare JLR Remote app trip end against API trip end (2026-11-08 15:00:29 JST).
4. Set `snapshots.last_drive_verified=1` after verification, without falsifying previous runs.
5. Validate real returned range/fuel/diagnostics fields before exposing UI values.
6. Configure APNs/email/push and confirm delivery. Pending rows are not sent notifications. `alert_events.delivery_status=pending` is **not** a sent notification.
