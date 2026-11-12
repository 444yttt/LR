# Unified Garage Telemetry Contract (v0.1)

## Product objective
Private fleet-of-personal-vehicles interface combining OEM connected APIs and optional owner-installed OBD/LTE devices. **Read-only by default**. Do not expose remote unlock/start controls as a generic capability.

## Vehicle overview
Per vehicle:
- Model, year, source (OEM API / OBD / manual), connection state, and last successful reading
- Last confirmed trip end (not a guess at last ignition)
- OEM-estimated combined range in km, EV-only range in km where available
- Fuel percentage, HV battery SOC, 12V terminal voltage (separate; neither voltage nor engine run means battery is healthy)
- Diagnostics categories: good / attention-required / service-required / unknown
- Active DTC count and service items due
- Sensor timestamp plus API fetch timestamp, with stale/disconnected state

## Contract (missing data is null)
```json
{
  "vehicle_id": "range-l460",
  "manufacturer": "Land Rover",
  "source": "jlr-rest",
  "observed_at": null,
  "last_drive_at": null,
  "last_drive_verified": false,
  "odometer_km": null,
  "range_km": null,
  "electric_range_km": null,
  "fuel_percent": null,
  "soc_percent": null,
  "battery_12v_voltage": null,
  "health_status": "unknown",
  "faults_count": null,
  "maintenance_due_count": null,
  "status_updated_at": null,
  "health_updated_at": null,
  "data_status": "unknown"
}
```

## Adapter support
| Brand | Adapter | Current verified capability | Still unverified |
|---|---|---|---|
| Land Rover | JLR Data Hub owner OAuth | metadata, status endpoint, journeys endpoint; 29 journeys, 2 pages | actual range/fuel/diagnostic field values, OEM Remote reconciliation |
| Ferrari | manual → investigation of MyFerrari / optional OBD | manual last use | API connectivity, HV/12V, remote data |
| BMW | manual → CarData/My BMW assessment | manual last use | model/year, market entitlement and scopes |
| Generic OBD/LTE | opt-in future adapter | none | CAN/UDS permissions, 12V battery draw, 24/7 connectivity, consent |

## Alerts
- Trigger after 7 days without confirmed trip, repeat at 14 days.
- Only when last drive is verified and data freshness is sufficient; no false inactivity claim if JLR API is unreachable.
- Separate alert classes: data unavailable, service-required, critical DTC (future).
- Send alerts only after actual notifier delivery is configured. Database pending rows do **not** mean notifications have been sent.
- A new trip updates last_drive_at; preserve adapter verification status while rejecting regression to older data.

## Security
- Never expose VIN, route, location, DTC descriptions, keys, or raw API responses in frontend by default.
- Data access requires authenticated per-user context; current Worker bearer gate is bootstrap-only and not a final client architecture.
- Cloudflare Access or managed auth should replace a static bearer token for multi-device usage.
- Keep OAuth private key and refresh tokens outside Git and assistant chat. Rotate tokens safely, store rotated credentials in encrypted vault.
- Delete historic travel data only according to intentional retention policy; current backend does not persist raw GPS trails.

## UI information architecture
1. Garage: list/carousel of vehicle cards, source freshness and last use
2. Vehicle detail: Range, Fuel/Charge, Last Trip, Vehicle Health, Diagnostics and Service, Data provenance
3. Timeline: verified trips and alert history, no precise location unless user explicitly enables it
4. Integrations: OEM account connections and optional OBD device, scope/permission controls, data deletion
5. Notifications: 7/14 days thresholds and action status

## Next concrete gate
Codespaces → Cloudflare secrets migration, then verify read-only scheduled collection. Do not enable cron-triggered collection until the owner has confirmed the JLR Remote app's last trip time. Date observed from API on Nov 12: 2026-11-08T06:00:29Z.
