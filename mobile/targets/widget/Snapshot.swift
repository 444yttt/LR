import Foundation

// The widget's only data: the JSON snapshot the Nostos app writes to App Group UserDefaults.
// Contract (field names, schema version): mobile/src/widgetSnapshot.ts. The widget makes no network requests and
// reads no credentials; it never sees a VIN, location, trips, odometer, or raw gateway data, because the app does not
// write them.

enum SnapshotStore {
    static let appGroup = "group.studio.naus.garagemonitor"
    static let key = "nostos.widget.snapshot"
    static let schemaVersion = 1

    /// nil when the app has not written a snapshot, the user signed out, or the payload is unreadable.
    static func load() -> WidgetSnapshot? {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let text = defaults.string(forKey: key) else { return nil }
        return decode(text)
    }

    static func decode(_ text: String) -> WidgetSnapshot? {
        guard let data = text.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
              snapshot.v == schemaVersion else { return nil }
        return snapshot
    }
}

struct WidgetSnapshot: Codable {
    let v: Int
    /// Device clock when the app wrote this (ms since 1970).
    let writtenAt: Double
    /// "active" or "expired".
    let session: String
    let selectedVehicleId: String
    let vehicles: [WidgetVehicle]
}

struct WidgetVehicle: Codable {
    let id: String
    let name: String
    /// "live", "empty" (connected, no report yet), or "notConnected".
    let kind: String
    /// "Fuel" or "Battery".
    let levelLabel: String
    let levelPercent: Int?
    let rangeKm: Int?
    /// Report time (ms since 1970).
    let updatedAt: Double?
    let stale: Bool
    let authExpired: Bool
}

/// Same copy and thresholds as relativeTime() in src/garageModel.ts.
func relativeTime(_ then: Date, now: Date) -> String? {
    let age = now.timeIntervalSince(then)
    if age < -300 { return nil }
    if age < 45 { return "just now" }
    if age < 3600 { return "\(max(1, Int((age / 60).rounded()))) min ago" }
    if age < 86_400 { return "\(Int(age / 3600)) h ago" }
    let days = Int(age / 86_400)
    return days == 1 ? "yesterday" : "\(days) days ago"
}

/// A report older than this is stale even if the app has not run since (MAX_SNAPSHOT_AGE in src/telemetry.ts).
let maxReportAge: TimeInterval = 36 * 3600

enum VehicleState {
    case live, stale, authExpired, empty, notConnected
}

/// What one widget shows for one vehicle at one moment.
struct VehicleDisplay {
    let id: String
    let name: String
    let levelLabel: String
    let levelPercent: Int?
    let rangeKm: Int?
    let state: VehicleState
    /// "4 min ago", "yesterday", … or nil when unknown.
    let updated: String?

    var hasReport: Bool { state == .live || state == .stale }
    /// Values are shown in the muted colour when they may not reflect the vehicle now.
    var dimmed: Bool { state != .live }
    var needsAttention: Bool { state == .stale || state == .authExpired }

    var levelText: String { levelPercent.map { "\($0) %" } ?? "— %" }
    var rangeText: String { rangeKm.map { "\($0) km" } ?? "— km" }

    /// Status line, rendered uppercase like the Garage cards.
    var status: String {
        switch state {
        case .live: return updated.map { "Updated \($0)" } ?? "Last update available"
        case .stale: return updated.map { "Stale · \($0)" } ?? "Last update is stale"
        case .authExpired: return "Sign-in expired"
        case .empty: return "Not updated yet"
        case .notConnected: return "Not connected"
        }
    }

    /// One short line for the lock screen.
    var shortStatus: String {
        switch state {
        case .live: return updated ?? "Updated"
        case .stale: return "Stale" + (updated.map { " · \($0)" } ?? "")
        case .authExpired: return "Sign-in expired"
        case .empty: return "Not updated yet"
        case .notConnected: return "Not connected"
        }
    }

    var url: URL { URL(string: "garage-monitor://vehicle/\(id)")! }
}

enum WidgetContent {
    /// No snapshot: signed out, not configured, or the app has not run yet.
    case signedOut
    case vehicle(VehicleDisplay)

    var url: URL {
        switch self {
        case .signedOut: return URL(string: "garage-monitor://")!
        case .vehicle(let vehicle): return vehicle.url
        }
    }

    /// The configured vehicle if any, else the app's default (last opened, else first with a report, else first).
    static func resolve(_ snapshot: WidgetSnapshot?, configured: String?, now: Date) -> WidgetContent {
        guard let snapshot else { return .signedOut }
        let wanted = configured ?? snapshot.selectedVehicleId
        guard let vehicle = snapshot.vehicles.first(where: { $0.id == wanted })
                ?? snapshot.vehicles.first(where: { $0.id == snapshot.selectedVehicleId })
                ?? snapshot.vehicles.first else { return .signedOut }
        return .vehicle(display(vehicle, expired: snapshot.session == "expired", now: now))
    }

    static func display(_ vehicle: WidgetVehicle, expired: Bool, now: Date) -> VehicleDisplay {
        let updatedAt = vehicle.updatedAt.map { Date(timeIntervalSince1970: $0 / 1000) }
        let old = updatedAt.map { now.timeIntervalSince($0) > maxReportAge } ?? true
        let state: VehicleState
        if expired || vehicle.authExpired { state = .authExpired }
        else if vehicle.kind == "notConnected" { state = .notConnected }
        else if vehicle.kind != "live" { state = .empty }
        else if vehicle.stale || old { state = .stale }
        else { state = .live }
        let reported = state == .live || state == .stale
        return VehicleDisplay(
            id: vehicle.id,
            name: vehicle.name,
            levelLabel: vehicle.levelLabel == "Battery" ? "Battery" : "Fuel",
            levelPercent: reported ? vehicle.levelPercent : nil,
            rangeKm: reported ? vehicle.rangeKm : nil,
            state: state,
            updated: reported ? updatedAt.flatMap { relativeTime($0, now: now) } : nil
        )
    }
}

/// SAMPLE DATA for previews, the widget gallery placeholder, and design mocks. Made-up values, not a real vehicle.
enum Samples {
    static func vehicle(_ id: String, _ name: String, label: String = "Fuel", percent: Int?, range: Int?,
                        state: VehicleState = .live, updated: String? = "4 min ago") -> VehicleDisplay {
        VehicleDisplay(id: id, name: name, levelLabel: label, levelPercent: percent, rangeKm: range, state: state, updated: updated)
    }
    static let rangeRover = vehicle("range-rover", "Range Rover", percent: 58, range: 486)
    static let x7Stale = vehicle("bmw-x7", "BMW X7", percent: 44, range: 390, state: .stale, updated: "2 days ago")
    static let etron = vehicle("audi-s-etron-gt", "Audi S e-tron GT", label: "Battery", percent: 64, range: 301, updated: "12 min ago")
    static let expired = vehicle("range-rover", "Range Rover", percent: nil, range: nil, state: .authExpired, updated: nil)
    static let empty = vehicle("bmw-x7", "BMW X7", percent: nil, range: nil, state: .empty, updated: nil)
    static let ferrari = vehicle("ferrari-296", "Ferrari 296", percent: nil, range: nil, state: .notConnected, updated: nil)
}
