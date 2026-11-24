import AppIntents
import WidgetKit

// This file must live in targets/widget/_shared so @bacons/apple-targets links it into BOTH the widget
// extension and the main Nostos app. AppIntentConfiguration widgets are registered through the app's
// App Intents metadata; if the intent is only in the extension, iOS does not show the widget in the gallery.
// Build 42 shipped with this file in the widget target only; archive logs showed the app target
// "Extracted no relevant App Intents symbols, skipping writing output".
// The app's deployment target is 15.1, so every App Intents type here is marked @available(iOS 17.0, *).

/// App vehicles in Garage order (src/garageModel.ts VEHICLES): ids and public display names only.
enum VehicleCatalog {
    static let all: [(id: String, name: String)] = [
        ("range-rover", "Range Rover"),
        ("bmw-x7", "BMW X7"),
        ("audi-s-etron-gt", "Audi S e-tron GT"),
        ("ferrari-296", "Ferrari 296"),
    ]
}

/// A vehicle the widget can show. Options come from the fixed app catalog, so choosing one never needs the app or
/// the network; its values come from the shared snapshot like every other widget.
@available(iOS 17.0, *)
struct VehicleEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Vehicle" }
    static var defaultQuery: VehicleQuery { VehicleQuery() }

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

    static var all: [VehicleEntity] { VehicleCatalog.all.map { VehicleEntity(id: $0.id, name: $0.name) } }
}

@available(iOS 17.0, *)
struct VehicleQuery: EntityQuery {
    func entities(for identifiers: [VehicleEntity.ID]) async throws -> [VehicleEntity] {
        VehicleEntity.all.filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [VehicleEntity] {
        VehicleEntity.all
    }
}

/// Edit Widget → Vehicle. Left empty, the widget follows the vehicle last opened in Nostos.
@available(iOS 17.0, *)
struct SelectVehicleIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Vehicle" }
    static var description: IntentDescription { "Choose the vehicle this widget shows. Leave empty to follow the vehicle last opened in Nostos." }

    @Parameter(title: "Vehicle")
    var vehicle: VehicleEntity?
}
