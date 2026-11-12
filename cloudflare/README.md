# Garage Monitor | Cloudflare Deployment

This is the read-only Cloudflare backend for a future multi-brand private garage monitor.

**Current deployment:** Worker `garage-monitor` and D1 `garage-monitor` exist; live JLR ingestion is deliberately disabled until secrets are transferred, source timestamps verified, and a notification destination is connected.

## Architecture
- Private Cloudflare Worker; `workers_dev=false`, no public hostname enabled
- D1: vehicles, snapshots, alert_events, ingestion_runs, credential_vault, telemetry_capabilities
- JLR OAuth Device Code for initial consent, then refresh tokens with PS256 client assertion and DPoP.
- Refresh token rotation saved in D1 encrypted at rest using AES-GCM and a 256-bit Worker secret; **do not overwrite the vault encryption key after the first live refresh**.
- Manufacturer-specific adapters normalize telemetry to common units; unavailable fields remain null.
- First successful journey read is `last_drive_verified=0` by design; cross-check against Remote and only then enable trusted inactivity alerts.
- A daily cron schedule is defined in `wrangler.jsonc`, **but remote cron is not yet enabled**. Do not deploy via Wrangler until secrets and permissions are checked.
- The Worker has no public API without `GARAGE_API_TOKEN`. Eventually place behind Cloudflare Access or an app backend and replace shared token access with short-lived per-user auth.

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

## Prerequisites before enabling the daily collection
1. Secret migration confirmed without exposing their contents.
2. Device authorization and refresh token rotation verified from Worker.
3. Remote App trip end matches API trip end.
4. Enable `vehicles.enabled=1` for Range Rover only.
5. Enable daily Cron and test pending alert creation.
6. Configure APNs/email/push and confirm delivery. `alert_events.delivery_status=pending` is **not** a sent notification.
