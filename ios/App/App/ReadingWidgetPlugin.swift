import Capacitor
import Foundation
import WidgetKit

@objc(ReadingWidgetPlugin)
public final class ReadingWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReadingWidgetPlugin"
    public let jsName = "ReadingWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeAction", returnType: CAPPluginReturnPromise)
    ]

    private let suiteName = "group.com.inkydameinteractive.inkbound"

    @objc func syncState(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            call.reject("Reading widget shared storage is unavailable.")
            return
        }

        let stringKeys = ["sessionMode", "bookId", "title", "author", "progressLabel", "paceLabel", "paceDetail", "dueTitle", "dueDate", "dueLabel"]
        for key in stringKeys {
            defaults.set(call.getString(key) ?? "", forKey: key)
        }
        defaults.set(call.getInt("timerSeconds") ?? 0, forKey: "timerSeconds")
        defaults.set(call.getBool("timerRunning") ?? false, forKey: "timerRunning")
        defaults.set(call.getDouble("timerAnchorMillis") ?? 0, forKey: "timerAnchorMillis")
        defaults.synchronize()
        WidgetCenter.shared.reloadTimelines(ofKind: "InkboundReadingWidget")
        call.resolve()
    }

    @objc func consumeAction(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            call.resolve()
            return
        }
        let action = defaults.string(forKey: "pendingAction") ?? ""
        defaults.removeObject(forKey: "pendingAction")
        if action.isEmpty {
            call.resolve()
        } else {
            call.resolve(["action": action])
        }
    }
}
