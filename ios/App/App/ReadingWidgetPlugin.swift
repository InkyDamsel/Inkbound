import Capacitor
import Foundation
import WidgetKit

@objc(ReadingWidgetPlugin)
public final class ReadingWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReadingWidgetPlugin"
    public let jsName = "ReadingWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeAction", returnType: CAPPluginReturnPromise)
    ]

    private let suiteName = "group.com.inkydameinteractive.inkbound"

    @objc func syncState(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            call.reject("Reading widget shared storage is unavailable.")
            return
        }

        let stringKeys = ["sessionMode", "bookId", "title", "author", "progressLabel", "dailyPagesLabel", "paceLabel", "paceDetail", "dueTitle", "dueDate", "dueLabel"]
        for key in stringKeys {
            defaults.set(call.getString(key) ?? "", forKey: key)
        }
        defaults.set(call.getInt("timerSeconds") ?? 0, forKey: "timerSeconds")
        defaults.set(call.getBool("timerRunning") ?? false, forKey: "timerRunning")
        defaults.set(call.getDouble("timerAnchorMillis") ?? 0, forKey: "timerAnchorMillis")
        defaults.synchronize()
        WidgetCenter.shared.reloadTimelines(ofKind: "InkboundReadingWidget")
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func readState(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            call.resolve()
            return
        }

        call.resolve([
            "sessionMode": defaults.string(forKey: "sessionMode") ?? "none",
            "bookId": defaults.string(forKey: "bookId") ?? "",
            "title": defaults.string(forKey: "title") ?? "",
            "author": defaults.string(forKey: "author") ?? "",
            "progressLabel": defaults.string(forKey: "progressLabel") ?? "",
            "timerSeconds": defaults.integer(forKey: "timerSeconds"),
            "timerRunning": defaults.bool(forKey: "timerRunning"),
            "timerAnchorMillis": defaults.double(forKey: "timerAnchorMillis"),
            "dailyPagesLabel": defaults.string(forKey: "dailyPagesLabel") ?? "",
            "paceLabel": defaults.string(forKey: "paceLabel") ?? "",
            "paceDetail": defaults.string(forKey: "paceDetail") ?? "",
            "dueTitle": defaults.string(forKey: "dueTitle") ?? "",
            "dueDate": defaults.string(forKey: "dueDate") ?? "",
            "dueLabel": defaults.string(forKey: "dueLabel") ?? ""
        ])
    }

    @objc func consumeAction(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            call.resolve()
            return
        }
        let action = defaults.string(forKey: "pendingAction") ?? ""
        let bookId = defaults.string(forKey: "pendingBookId") ?? ""
        defaults.removeObject(forKey: "pendingAction")
        defaults.removeObject(forKey: "pendingBookId")
        if action.isEmpty {
            call.resolve()
        } else {
            call.resolve(["action": action, "bookId": bookId])
        }
    }
}
