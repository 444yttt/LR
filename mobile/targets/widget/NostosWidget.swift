import SwiftUI
import WidgetKit

// Final / Light Floor colours and type (mobile/src/ui/theme.tsx). Light only: no dark widget theme.
enum Theme {
    static let page = Color(red: 0xF8 / 255, green: 0xF8 / 255, blue: 0xF7 / 255)
    static let ink = Color(red: 0x1B / 255, green: 0x1D / 255, blue: 0x20 / 255)
    static let mute = Color(red: 0x73 / 255, green: 0x77 / 255, blue: 0x7D / 255)
    static let rule = Color(red: 0xE3 / 255, green: 0xE5 / 255, blue: 0xE6 / 255)
    static let white = Color.white

    static func regular(_ size: CGFloat) -> Font { .custom("Inter-Regular", size: size) }
    static func medium(_ size: CGFloat) -> Font { .custom("Inter-Medium", size: size) }
    static func semibold(_ size: CGFloat) -> Font { .custom("Inter-SemiBold", size: size) }
}

// MARK: - Timeline

struct NostosEntry: TimelineEntry {
    let date: Date
    let content: WidgetContent
}

struct Provider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> NostosEntry {
        NostosEntry(date: Date(), content: .vehicle(Samples.rangeRover))
    }

    func snapshot(for configuration: SelectVehicleIntent, in context: Context) async -> NostosEntry {
        let now = Date()
        if let snapshot = SnapshotStore.load() {
            return NostosEntry(date: now, content: .resolve(snapshot, configured: configuration.vehicle?.id, now: now))
        }
        // Widget gallery before the app has written anything: the sample layout.
        return context.isPreview ? placeholder(in: context) : NostosEntry(date: now, content: .signedOut)
    }

    /// Reads the shared snapshot once, then steps the clock every 15 minutes for 6 hours so "N min ago" and the
    /// 36-hour stale rule advance without the app. The app reloads the timeline after every write.
    func timeline(for configuration: SelectVehicleIntent, in context: Context) async -> Timeline<NostosEntry> {
        let now = Date()
        let snapshot = SnapshotStore.load()
        let entries = (0..<24).map { step -> NostosEntry in
            let date = now.addingTimeInterval(TimeInterval(step) * 900)
            return NostosEntry(date: date, content: .resolve(snapshot, configured: configuration.vehicle?.id, now: date))
        }
        return Timeline(entries: entries, policy: .atEnd)
    }
}

// MARK: - Views

struct NostosWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NostosEntry

    var body: some View {
        content
            // Keep the small layout intact under large Dynamic Type sizes.
            .dynamicTypeSize(...DynamicTypeSize.large)
            .widgetURL(entry.content.url)
            .containerBackground(for: .widget) { background }
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryCircular: CircularView(content: entry.content)
        case .accessoryRectangular: RectangularView(content: entry.content)
        case .accessoryInline: InlineView(content: entry.content)
        case .systemMedium: MediumView(content: entry.content)
        default: SmallView(content: entry.content)
        }
    }

    @ViewBuilder private var background: some View {
        switch family {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline: Color.clear
        default: Theme.white
        }
    }
}

/// Uppercase status line, as on the Garage cards. A filled dot marks stale and sign-in expired.
struct StatusLine: View {
    let vehicle: VehicleDisplay

    var body: some View {
        HStack(spacing: 5) {
            if vehicle.needsAttention {
                Circle().fill(Theme.ink).frame(width: 5, height: 5)
            }
            Text(vehicle.status.uppercased())
                .font(Theme.medium(9))
                .foregroundStyle(vehicle.needsAttention ? Theme.ink : Theme.mute)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }
}

struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(Theme.medium(9)).foregroundStyle(Theme.mute).lineLimit(1)
    }
}

/// Fuel / battery level: ink on a rule-coloured track; muted when stale; track only when unknown.
struct LevelBar: View {
    let percent: Int?
    let dimmed: Bool

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.rule)
                if let percent {
                    Capsule()
                        .fill(dimmed ? Theme.mute : Theme.ink)
                        .frame(width: max(3, geometry.size.width * CGFloat(min(100, max(0, percent))) / 100))
                }
            }
        }
        .frame(height: 3)
        .accessibilityHidden(true)
    }
}

struct SignedOutView: View {
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Nostos").font(Theme.semibold(compact ? 15 : 17)).foregroundStyle(Theme.ink)
            Eyebrow(text: "Garage").padding(.top, 4)
            Spacer(minLength: 8)
            Text("Sign in to Nostos to show a vehicle here.")
                .font(Theme.regular(12))
                .foregroundStyle(Theme.mute)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// The caption under a value: why it is blank, if it is.
private func caption(_ vehicle: VehicleDisplay, missing: Bool) -> String? {
    switch vehicle.state {
    case .authExpired: return "Open Nostos to sign in"
    case .empty: return "No report yet"
    case .notConnected: return "No data source"
    case .live, .stale: return missing ? "Not reported" : nil
    }
}

struct SmallView: View {
    let content: WidgetContent

    var body: some View {
        switch content {
        case .signedOut:
            SignedOutView(compact: true)
        case .vehicle(let vehicle):
            VStack(alignment: .leading, spacing: 0) {
                Text(vehicle.name)
                    .font(Theme.semibold(15))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                StatusLine(vehicle: vehicle).padding(.top, 4)
                Spacer(minLength: 6)
                Eyebrow(text: vehicle.levelLabel)
                Text(vehicle.levelText)
                    .font(Theme.semibold(26))
                    .foregroundStyle(vehicle.dimmed ? Theme.mute : Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.top, 2)
                LevelBar(percent: vehicle.levelPercent, dimmed: vehicle.dimmed).padding(.top, 5)
                HStack(alignment: .firstTextBaseline) {
                    Eyebrow(text: "Range")
                    Spacer(minLength: 4)
                    Text(vehicle.rangeText)
                        .font(Theme.medium(12))
                        .foregroundStyle(vehicle.dimmed ? Theme.mute : Theme.ink)
                        .lineLimit(1)
                }
                .padding(.top, 9)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityText(vehicle))
        }
    }
}

struct MetricColumn: View {
    let label: String
    let value: String
    let note: String?
    let dimmed: Bool
    var showsBar = false
    var percent: Int? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Eyebrow(text: label)
            Text(value)
                .font(Theme.semibold(24))
                .foregroundStyle(dimmed ? Theme.mute : Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.top, 3)
            if showsBar {
                LevelBar(percent: percent, dimmed: dimmed).padding(.top, 5).padding(.trailing, 6)
            }
            if let note {
                Text(note).font(Theme.regular(10)).foregroundStyle(Theme.mute).lineLimit(1).padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct MediumView: View {
    let content: WidgetContent

    var body: some View {
        switch content {
        case .signedOut:
            SignedOutView(compact: false)
        case .vehicle(let vehicle):
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(vehicle.name)
                            .font(Theme.semibold(17))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        StatusLine(vehicle: vehicle)
                    }
                    Spacer(minLength: 8)
                    Text("›").font(Theme.regular(20)).foregroundStyle(Theme.mute)
                }
                Spacer(minLength: 8)
                Rectangle().fill(Theme.rule).frame(height: 1)
                HStack(alignment: .top, spacing: 14) {
                    MetricColumn(label: "Range", value: vehicle.rangeText,
                                 note: caption(vehicle, missing: vehicle.rangeKm == nil), dimmed: vehicle.dimmed)
                    Rectangle().fill(Theme.rule).frame(width: 1).frame(maxHeight: .infinity)
                    MetricColumn(label: vehicle.levelLabel, value: vehicle.levelText,
                                 note: caption(vehicle, missing: vehicle.levelPercent == nil), dimmed: vehicle.dimmed,
                                 showsBar: true, percent: vehicle.levelPercent)
                }
                .padding(.top, 10)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityText(vehicle))
        }
    }
}

// Lock screen. The system renders these in its own vibrant style, so they use the system font.

struct CircularView: View {
    let content: WidgetContent

    var body: some View {
        if case .vehicle(let vehicle) = content, let percent = vehicle.levelPercent {
            Gauge(value: Double(min(100, max(0, percent))), in: 0...100) {
                Text(vehicle.levelLabel == "Battery" ? "BAT" : "FUEL")
            } currentValueLabel: {
                Text("\(percent)")
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .accessibilityLabel(accessibilityText(vehicle))
        } else {
            ZStack {
                AccessoryWidgetBackground()
                Text("—").font(.system(size: 16, weight: .semibold))
            }
            .accessibilityLabel(accessibilityText(content))
        }
    }
}

struct RectangularView: View {
    let content: WidgetContent

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            switch content {
            case .signedOut:
                Text("Nostos").font(.headline).widgetAccentable()
                Text("Sign in to show a vehicle").font(.caption).foregroundStyle(.secondary)
            case .vehicle(let vehicle):
                Text(vehicle.name).font(.headline).widgetAccentable().lineLimit(1).minimumScaleFactor(0.8)
                Text("\(vehicle.levelLabel) \(vehicle.levelText) · \(vehicle.rangeText)").font(.body).lineLimit(1).minimumScaleFactor(0.8)
                Text(vehicle.shortStatus).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct InlineView: View {
    let content: WidgetContent

    var body: some View {
        switch content {
        case .signedOut:
            Text("Nostos · Sign in")
        case .vehicle(let vehicle):
            Text(vehicle.state == .authExpired ? "\(vehicle.name) · Sign-in expired" : "\(vehicle.name) · \(vehicle.levelText)")
        }
    }
}

private func accessibilityText(_ vehicle: VehicleDisplay) -> String {
    let level = vehicle.levelPercent.map { "\($0) percent" } ?? "not reported"
    let range = vehicle.rangeKm.map { "\($0) kilometres" } ?? "not reported"
    return "\(vehicle.name). \(vehicle.levelLabel) \(level). Range \(range). \(vehicle.status)."
}

private func accessibilityText(_ content: WidgetContent) -> String {
    switch content {
    case .signedOut: return "Nostos. Sign in to show a vehicle."
    case .vehicle(let vehicle): return accessibilityText(vehicle)
    }
}

// MARK: - Widget

struct NostosWidget: Widget {
    let kind = "NostosWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: SelectVehicleIntent.self, provider: Provider()) { entry in
            NostosWidgetView(entry: entry)
        }
        .configurationDisplayName("Vehicle")
        .description("Fuel or battery level, range, and the last update for one vehicle.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct NostosWidgets: WidgetBundle {
    var body: some Widget {
        NostosWidget()
    }
}

// MARK: - Previews (SAMPLE DATA only; see Samples)

#Preview("Small", as: .systemSmall) {
    NostosWidget()
} timeline: {
    NostosEntry(date: .now, content: .vehicle(Samples.rangeRover))
    NostosEntry(date: .now, content: .vehicle(Samples.etron))
    NostosEntry(date: .now, content: .vehicle(Samples.x7Stale))
    NostosEntry(date: .now, content: .vehicle(Samples.expired))
    NostosEntry(date: .now, content: .vehicle(Samples.empty))
    NostosEntry(date: .now, content: .vehicle(Samples.ferrari))
    NostosEntry(date: .now, content: .signedOut)
}

#Preview("Medium", as: .systemMedium) {
    NostosWidget()
} timeline: {
    NostosEntry(date: .now, content: .vehicle(Samples.rangeRover))
    NostosEntry(date: .now, content: .vehicle(Samples.etron))
    NostosEntry(date: .now, content: .vehicle(Samples.x7Stale))
    NostosEntry(date: .now, content: .vehicle(Samples.expired))
    NostosEntry(date: .now, content: .signedOut)
}

#Preview("Lock screen", as: .accessoryRectangular) {
    NostosWidget()
} timeline: {
    NostosEntry(date: .now, content: .vehicle(Samples.rangeRover))
    NostosEntry(date: .now, content: .vehicle(Samples.etron))
    NostosEntry(date: .now, content: .vehicle(Samples.expired))
}

#Preview("Circular", as: .accessoryCircular) {
    NostosWidget()
} timeline: {
    NostosEntry(date: .now, content: .vehicle(Samples.rangeRover))
    NostosEntry(date: .now, content: .vehicle(Samples.etron))
    NostosEntry(date: .now, content: .signedOut)
}
