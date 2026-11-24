import AppIntents
import WidgetKit

/// A vehicle the widget can show. Options come from the fixed app catalog, so choosing one never needs the app or
/// the network; its values come from the shared snapshot like every other widget.
struct VehicleEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Vehicle" }
    static var defaultQuery: VehicleQuery { VehicleQuery() }

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

    static var all: [VehicleEntity] { VehicleCatalog.all.map { VehicleEntity(id: $0.id, name: $0.name) } }
}

struct VehicleQuery: EntityQuery {
    func entities(for identifiers: [VehicleEntity.ID]) async throws -> [VehicleEntity] {
        VehicleEntity.all.filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [VehicleEntity] {
        VehicleEntity.all
    }
}

/// Edit Widget → Vehicle. Left empty, the widget follows the vehicle last opened in Nostos.
struct SelectVehicleIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Vehicle" }
    static var description: IntentDescription { "Choose the vehicle this widget shows. Leave empty to follow the vehicle last opened in Nostos." }

    @Parameter(title: "Vehicle")
    var vehicle: VehicleEntity?
}
