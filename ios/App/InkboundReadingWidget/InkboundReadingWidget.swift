import SwiftUI
import WidgetKit

private let suiteName = "group.com.inkydameinteractive.inkbound"

struct ReadingEntry: TimelineEntry {
    let date: Date
    let sessionMode: String
    let bookId: String
    let title: String
    let author: String
    let progressLabel: String
    let timerSeconds: Int
    let timerRunning: Bool
    let timerAnchorMillis: Double
    let dailyPagesLabel: String
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
            sessionMode: "none",
            bookId: "",
            title: "Currently Reading",
            author: "Inkbound",
            progressLabel: "Page 0 of 0",
            timerSeconds: 0,
            timerRunning: false,
            timerAnchorMillis: 0,
            dailyPagesLabel: "",
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
        return ReadingEntry(
            date: Date(),
            sessionMode: defaults?.string(forKey: "sessionMode") ?? "none",
            bookId: defaults?.string(forKey: "bookId") ?? "",
            title: defaults?.string(forKey: "title") ?? "",
            author: defaults?.string(forKey: "author") ?? "",
            progressLabel: defaults?.string(forKey: "progressLabel") ?? "",
            timerSeconds: defaults?.integer(forKey: "timerSeconds") ?? 0,
            timerRunning: defaults?.bool(forKey: "timerRunning") ?? false,
            timerAnchorMillis: defaults?.double(forKey: "timerAnchorMillis") ?? 0,
            dailyPagesLabel: defaults?.string(forKey: "dailyPagesLabel") ?? "",
            paceLabel: defaults?.string(forKey: "paceLabel") ?? "",
            paceDetail: defaults?.string(forKey: "paceDetail") ?? "",
            dueTitle: defaults?.string(forKey: "dueTitle") ?? "",
            dueDate: defaults?.string(forKey: "dueDate") ?? "",
            dueLabel: defaults?.string(forKey: "dueLabel") ?? ""
        )
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

    private let plum = Color(red: 0.105, green: 0.068, blue: 0.125)
    private let rose = Color(red: 0.78, green: 0.60, blue: 0.70)
    private let gold = Color(red: 0.847, green: 0.710, blue: 0.427)

    private var libraryReminder: String {
        guard !entry.dueTitle.isEmpty, !entry.dueDate.isEmpty, !entry.dueLabel.isEmpty else { return "" }
        let bookPrefix = entry.dueTitle == entry.title ? "" : entry.dueTitle + " · "
        return "Library: " + bookPrefix + "Due back " + entry.dueDate + " · " + entry.dueLabel
    }

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.height < 170
            let hasLoan = !libraryReminder.isEmpty
            let hasPace = !entry.paceLabel.isEmpty
            let dense = hasLoan && hasPace
            let tight = compact || dense
            VStack(alignment: .leading, spacing: tight ? 2 : 5) {
                HStack {
                    Text("INKBOUND")
                        .font(.system(size: 10, weight: .bold))
                        .tracking(2)
                        .foregroundColor(rose)
                    Spacer()
                    if entry.sessionMode == "active" {
                        Text("READING")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(gold)
                    }
                }
                .padding(.bottom, tight ? 0 : 3)

                if entry.title.isEmpty {
                    Spacer(minLength: 0)
                    Text("No current read")
                        .font(.headline)
                        .foregroundColor(.white)
                    Text("Choose a Currently Reading book in Inkbound.")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                    Spacer(minLength: 0)
                } else {
                    Text(entry.title)
                        .font(.system(size: tight ? 14 : 17, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)

                    if !entry.author.isEmpty {
                        Text(entry.author)
                            .font(.system(size: 12))
                            .foregroundColor(Color(red: 0.78, green: 0.72, blue: 0.75))
                            .lineLimit(1)
                    }

                    if !entry.progressLabel.isEmpty {
                        Text(entry.progressLabel)
                            .font(.system(size: 11))
                            .foregroundColor(.white.opacity(0.75))
                            .lineLimit(1)
                    }

                    if !entry.dailyPagesLabel.isEmpty {
                        Text(entry.dailyPagesLabel)
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(gold)
                            .lineLimit(1)
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
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.white.opacity(0.85))
                            .lineLimit(1)
                    }

                    if !entry.paceDetail.isEmpty && !dense {
                        Text(entry.paceDetail)
                            .font(.system(size: 10))
                            .foregroundColor(.white.opacity(0.65))
                            .lineLimit(1)
                    }

                    if !libraryReminder.isEmpty {
                        Text(libraryReminder)
                            .font(.system(size: 11))
                            .foregroundColor(gold)
                            .lineLimit(dense ? 1 : 2)
                    }

                    Spacer(minLength: 0)

                    if entry.sessionMode == "none" {
                        Link(destination: startURL) {
                            HStack(spacing: 5) {
                                Image(systemName: "play.fill")
                                    .font(.system(size: 9))
                                Text("Start")
                                    .font(.system(size: 12, weight: .semibold))
                            }
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: tight ? 27 : 32)
                            .background(Color(red: 0.478, green: 0.325, blue: 0.408), in: RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, tight ? 8 : 13)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        }
        .inkboundWidgetBackground()
        .widgetURL(openURL)
    }
}

private extension View {
    @ViewBuilder
    func inkboundWidgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) {
                Color(red: 0.105, green: 0.068, blue: 0.125)
            }
        } else {
            background(Color(red: 0.105, green: 0.068, blue: 0.125))
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
