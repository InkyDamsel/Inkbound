import SwiftUI
import WidgetKit
import AppIntents

private let suiteName = "group.com.inkydameinteractive.inkbound"

struct ReadingEntry: TimelineEntry {
    let date: Date
    let bookPosition: Int
    let bookCount: Int
    let sessionMode: String
    let bookId: String
    let title: String
    let author: String
    let progressLabel: String
    let timerSeconds: Int
    let timerRunning: Bool
    let timerAnchorMillis: Double
    let paceLabel: String
    let paceDetail: String
    let dueTitle: String
    let dueDate: String
    let dueLabel: String
}

struct ReadingProvider: TimelineProvider {
    func placeholder(in context: Context) -> ReadingEntry {
        ReadingEntry(
            date: Date(),
            bookPosition: 0,
            bookCount: 0,
            sessionMode: "none",
            bookId: "",
            title: "Currently Reading",
            author: "Inkbound",
            progressLabel: "Page 0 of 0",
            timerSeconds: 0,
            timerRunning: false,
            timerAnchorMillis: 0,
            paceLabel: "",
            paceDetail: "",
            dueTitle: "",
            dueDate: "",
            dueLabel: ""
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (ReadingEntry) -> Void) {
        completion(readEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ReadingEntry>) -> Void) {
        let entry = readEntry()
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60))))
    }

    private func readEntry() -> ReadingEntry {
        let defaults = UserDefaults(suiteName: suiteName)
        let roster = (defaults?.data(forKey: "readingBooks")).flatMap {
            try? JSONSerialization.jsonObject(with: $0) as? [[String: String]]
        } ?? []
        let selectedId = defaults?.string(forKey: "selectedWidgetBookId") ?? ""
        let index = roster.firstIndex(where: { $0["id"] == selectedId }) ?? 0
        let selected = roster.indices.contains(index) ? roster[index] : nil
        let alternate = selected != nil && selected?["id"] != defaults?.string(forKey: "bookId")
        return ReadingEntry(
            date: Date(),
            bookPosition: index,
            bookCount: roster.count,
            sessionMode: alternate ? "none" : (defaults?.string(forKey: "sessionMode") ?? "none"),
            bookId: selected?["id"] ?? defaults?.string(forKey: "bookId") ?? "",
            title: selected?["title"] ?? defaults?.string(forKey: "title") ?? "",
            author: selected?["author"] ?? defaults?.string(forKey: "author") ?? "",
            progressLabel: selected?["progressLabel"] ?? defaults?.string(forKey: "progressLabel") ?? "",
            timerSeconds: defaults?.integer(forKey: "timerSeconds") ?? 0,
            timerRunning: defaults?.bool(forKey: "timerRunning") ?? false,
            timerAnchorMillis: defaults?.double(forKey: "timerAnchorMillis") ?? 0,
            paceLabel: defaults?.string(forKey: "paceLabel") ?? "",
            paceDetail: defaults?.string(forKey: "paceDetail") ?? "",
            dueTitle: defaults?.string(forKey: "dueTitle") ?? "",
            dueDate: defaults?.string(forKey: "dueDate") ?? "",
            dueLabel: defaults?.string(forKey: "dueLabel") ?? ""
        )
    }
}

@available(iOSApplicationExtension 17.0, *)
struct SwitchReadingBookIntent: AppIntent {
    static var title: LocalizedStringResource = "Switch reading book"
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Direction") var direction: Int
    init() { direction = 1 }
    init(direction: Int) { self.direction = direction }

    func perform() async throws -> some IntentResult {
        guard let defaults = UserDefaults(suiteName: suiteName),
              let data = defaults.data(forKey: "readingBooks"),
              let books = try? JSONSerialization.jsonObject(with: data) as? [[String: String]],
              books.count > 1 else { return .result() }
        let selected = defaults.string(forKey: "selectedWidgetBookId") ?? ""
        let index = books.firstIndex(where: { $0["id"] == selected }) ?? 0
        let next = (index + (direction < 0 ? -1 : 1) + books.count) % books.count
        defaults.set(books[next]["id"] ?? "", forKey: "selectedWidgetBookId")
        WidgetCenter.shared.reloadTimelines(ofKind: "InkboundReadingWidget")
        return .result()
    }
}

struct ReadingWidgetView: View {
    let entry: ReadingEntry

    private var openURL: URL {
        var components = URLComponents()
        components.scheme = "inkbound"
        components.host = "reading-widget"
        components.queryItems = [
            URLQueryItem(name: "action", value: "open"),
            URLQueryItem(name: "bookId", value: entry.bookId),
        ]
        return components.url ?? URL(string: "inkbound://reading-widget?action=open")!
    }

    private var startURL: URL {
        var components = URLComponents()
        components.scheme = "inkbound"
        components.host = "reading-widget"
        components.queryItems = [
            URLQueryItem(name: "action", value: "start"),
            URLQueryItem(name: "bookId", value: entry.bookId),
        ]
        return components.url ?? openURL
    }

    private var timerStartDate: Date {
        let anchor = entry.timerAnchorMillis > 0 ? entry.timerAnchorMillis / 1000 : Date().timeIntervalSince1970
        return Date(timeIntervalSince1970: anchor).addingTimeInterval(TimeInterval(-entry.timerSeconds))
    }

    private var staticTimer: String {
        let total = max(0, entry.timerSeconds)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
            : String(format: "%02d:%02d", minutes, seconds)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("INKBOUND")
                        .font(.caption2.weight(.bold))
                        .tracking(1.3)
                        .foregroundColor(Color(red: 0.82, green: 0.66, blue: 0.39))
                    Spacer()
                    if entry.sessionMode == "active" {
                        Text("READING")
                            .font(.caption2.weight(.bold))
                            .foregroundColor(.green)
                    }
                }

                if entry.bookCount > 1 {
                    if #available(iOSApplicationExtension 17.0, *) {
                        HStack(spacing: 8) {
                            Button(intent: SwitchReadingBookIntent(direction: -1)) {
                                Image(systemName: "chevron.left").frame(minWidth: 28, minHeight: 28)
                            }
                            Spacer()
                            Text("\(entry.bookPosition + 1) of \(entry.bookCount)")
                                .font(.caption2.weight(.semibold))
                            Spacer()
                            Button(intent: SwitchReadingBookIntent(direction: 1)) {
                                Image(systemName: "chevron.right").frame(minWidth: 28, minHeight: 28)
                            }
                        }
                        .foregroundColor(Color(red: 0.87, green: 0.74, blue: 0.52))
                        .buttonStyle(.plain)
                    }
                }

                if entry.title.isEmpty {
                    Spacer()
                    Text("No current read")
                        .font(.headline)
                        .foregroundColor(.white)
                    Text("Choose a Currently Reading book in Inkbound.")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.65))
                    Spacer()
                } else {
                    Text(entry.title)
                        .font(.headline)
                        .foregroundColor(.white)
                        .lineLimit(2)

                    if !entry.author.isEmpty {
                        Text(entry.author)
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.7))
                            .lineLimit(1)
                    }

                    if !entry.progressLabel.isEmpty {
                        Text(entry.progressLabel)
                            .font(.caption.weight(.semibold))
                            .foregroundColor(Color(red: 0.87, green: 0.74, blue: 0.52))
                    }

                    if entry.sessionMode == "active" {
                        Text(timerStartDate, style: .timer)
                            .font(.system(.title3, design: .monospaced).weight(.bold))
                            .foregroundColor(.white)
                    } else if entry.sessionMode == "paused" || entry.sessionMode == "finished" {
                        Text(staticTimer)
                            .font(.system(.title3, design: .monospaced).weight(.bold))
                            .foregroundColor(.white)
                    }

                    if !entry.paceLabel.isEmpty {
                        Text(entry.paceLabel)
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.72))
                            .lineLimit(1)
                    }

                    Spacer(minLength: 2)

                    if entry.sessionMode == "none" {
                        Link(destination: startURL) {
                            Text("Start Reading")
                                .font(.caption.weight(.bold))
                                .foregroundColor(Color(red: 0.071, green: 0.031, blue: 0.09))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(Color(red: 0.82, green: 0.66, blue: 0.39))
                                .cornerRadius(8)
                        }
                    } else if !entry.dueLabel.isEmpty {
                        Text(entry.dueLabel)
                            .font(.caption2.weight(.semibold))
                            .foregroundColor(.orange)
                    }
                }
            }
        .padding(14)
        .inkboundWidgetBackground()
        .widgetURL(openURL)
    }
}

private extension View {
    @ViewBuilder
    func inkboundWidgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) {
                Color(red: 0.071, green: 0.031, blue: 0.09)
            }
        } else {
            background(Color(red: 0.071, green: 0.031, blue: 0.09))
        }
    }
}

@main
struct InkboundReadingWidget: Widget {
    let kind = "InkboundReadingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ReadingProvider()) { entry in
            ReadingWidgetView(entry: entry)
        }
        .configurationDisplayName("Inkbound Reading")
        .description("See your current read, progress, reading pace, and active timer.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
