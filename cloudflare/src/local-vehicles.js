// Deterministic, local-only vehicle records for the private Garage UI.
// THESE VALUES ARE SYNTHETIC. Never use for alerts, service actions or OEM health decisions.
// The public response deliberately retains the same keys as the JLR D1 join;
// there are no view-specific fake/demo flags or special frontend branches.
//
// Removal when an OEM adapter is ready: simply omit the matching local id.
// Not written to D1, not ingested by cron, and never sent to notifier.
export const LOCAL_VEHICLE_IDS = Object.freeze(['bmw-x7', 'audi-s-etron-gt']);

const MINUTE = 60_000;
const DAY = 86_400_000;

const vehicles = Object.freeze([
  {
    id: 'bmw-x7',
    make: 'BMW',
    model: 'X7',
    model_year: 2026,
    display_name: 'BMW X7',
    range_km: 645,
    electric_range_km: null,
    fuel_percent: 73,
    soc_percent: null,
    battery_12v_voltage: null,
    health_status: 'good',
    faults_count: 0,
    odometer_km: 318,
    maintenance_due_count: 0,
    idle_days: 2,
    observation_minutes_ago: 22
  },
  {
    id: 'audi-s-etron-gt',
    make: 'Audi',
    model: 'S e-tron GT',
    model_year: 2026,
    display_name: 'Audi S e-tron GT',
    range_km: 329,
    electric_range_km: 329,
    fuel_percent: null,
    soc_percent: 68,
    battery_12v_voltage: null,
    health_status: 'good',
    faults_count: 0,
    odometer_km: 4820,
    maintenance_due_count: 0,
    idle_days: 4,
    observation_minutes_ago: 34
  }
]);

const iso = (ms) => new Date(ms).toISOString();

/**
 * Create rows matching the exact shape of the existing GET /api/vehicles
 * SELECT in worker.js. No custom mock fields appear in the HTTP payload.
 *
 * connection_status='connected' makes the app treat this fixture as connected.
 * source='local' is correct internal provenance, NOT a claim of BMW/Audi OEM access.
 * last_drive_verified=0 avoids treating fictional trips as confirmed evidence.
 * These records must NEVER be used as backend notification inputs.
 */
export function localVehicleRows(at = Date.now()) {
  if (!Number.isFinite(at)) throw new TypeError('Invalid timestamp');
  return vehicles.map(v => {
    const observed = iso(at - v.observation_minutes_ago * MINUTE);
    const {idle_days, observation_minutes_ago, ...fields} = v;
    return {
      id: fields.id,
      make: fields.make,
      model: fields.model,
      model_year: fields.model_year,
      display_name: fields.display_name,
      enabled: 1,
      last_drive_at: iso(at - idle_days * DAY),
      last_drive_verified: 0,
      fetched_at: observed,
      data_status: 'fresh',
      connection_status: 'connected',
      range_km: fields.range_km,
      electric_range_km: fields.electric_range_km,
      fuel_percent: fields.fuel_percent,
      soc_percent: fields.soc_percent,
      battery_12v_voltage: fields.battery_12v_voltage,
      health_status: fields.health_status,
      faults_count: fields.faults_count,
      odometer_km: fields.odometer_km,
      status_updated_at: observed,
      health_updated_at: observed,
      maintenance_due_count: fields.maintenance_due_count,
      source: 'local'
    };
  });
}

export function combineVehicleRows(oemRows, at = Date.now()) {
  if (!Array.isArray(oemRows)) throw new TypeError('Expected D1 rows');
  const existingIds = new Set(oemRows.map(v => v.id));
  const normalisedOemRows = oemRows.map(v => ({
    ...v,
    connection_status: v.enabled && v.fetched_at && v.data_status === 'fresh'
      ? 'connected' : 'disconnected'
  }));
  return [...normalisedOemRows, ...localVehicleRows(at).filter(v => !existingIds.has(v.id))];
}
