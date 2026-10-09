import UIKit
import Capacitor

/// One UIKit scene owns the existing storyboard-backed InkboundBridgeViewController.
/// Do not create a second CAPBridgeViewController here: Main.storyboard is the
/// canonical root and registers Inkbound's native plugins once.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // UIKit creates the window and root controller from UISceneStoryboardFile = Main.
        // Cold-launch URLs arrive here instead of AppDelegate.open(_:options:).
        for context in connectionOptions.urlContexts {
            AppDelegate.handleIncomingURL(context.url)
        }
        for activity in connectionOptions.userActivities {
            AppDelegate.handleIncomingUserActivity(activity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            AppDelegate.handleIncomingURL(context.url)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        AppDelegate.handleIncomingUserActivity(userActivity)
    }
}
