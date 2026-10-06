import Capacitor
import Foundation
import UserNotifications

@objc(LoanReminderPlugin)
public final class LoanReminderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LoanReminderPlugin"
    public let jsName = "LoanReminder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private let center = UNUserNotificationCenter.current()

    @objc func schedule(_ call: CAPPluginCall) {
        guard
            let bookId = call.getString("bookId"),
            let title = call.getString("title"),
            let dueDateString = call.getString("dueDate")
        else {
            call.reject("bookId, title, and dueDate are required")
            return
        }

        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"

        guard let dueDate = formatter.date(from: dueDateString) else {
            call.reject("dueDate must use YYYY-MM-DD")
            return
        }

        center.requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, error in
            guard let self else { return }
            if let error {
                call.reject(error.localizedDescription)
                return
            }
            guard granted else {
                call.reject("Notification permission was not granted.")
                return
            }

            self.cancelRequests(bookId: bookId)
            let calendar = Calendar.current
            let threeDays = calendar.date(byAdding: .day, value: -3, to: dueDate)
            let now = Date()

            if let threeDays, threeDays > now {
                self.addRequest(
                    identifier: self.identifier(bookId: bookId, kind: "three-days"),
                    title: "Library book due in 3 days",
                    body: "“\(title)” is due back at the library in 3 days.",
                    date: threeDays
                )
            }

            if dueDate >= calendar.startOfDay(for: now) {
                self.addRequest(
                    identifier: self.identifier(bookId: bookId, kind: "due-today"),
                    title: "Library book due today",
                    body: "Return “\(title)” to the library today.",
                    date: dueDate
                )
            }

            call.resolve()
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let bookId = call.getString("bookId"), !bookId.isEmpty else {
            call.reject("bookId is required")
            return
        }
        cancelRequests(bookId: bookId)
        call.resolve()
    }

    private func addRequest(identifier: String, title: String, body: String, date: Date) {
        var components = Calendar.current.dateComponents([.year, .month, .day], from: date)
        components.hour = 9
        components.minute = 0

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: trigger))
    }

    private func cancelRequests(bookId: String) {
        center.removePendingNotificationRequests(withIdentifiers: [
            identifier(bookId: bookId, kind: "three-days"),
            identifier(bookId: bookId, kind: "due-today"),
        ])
    }

    private func identifier(bookId: String, kind: String) -> String {
        "inkbound.loan.\(bookId).\(kind)"
    }
}
