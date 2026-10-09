import UIKit
import Capacitor

/// One UIKit scene owns one canonical InkboundBridgeViewController.
/// Construct its window explicitly so scene startup does not create a second
/// storyboard-backed bridge or depend on the legacy AppDelegate window.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // Own exactly one window and one canonical Capacitor bridge per scene.
        // iOS 27's scene lifecycle must not depend on UIKit instantiating the
        // legacy application storyboard window. The native bridge controller
        // remains the same InkboundBridgeViewController used before migration.
        guard let windowScene = scene as? UIWindowScene else { return }
        let sceneWindow = UIWindow(windowScene: windowScene)
        sceneWindow.rootViewController = InkboundBridgeViewController()
        window = sceneWindow
        sceneWindow.makeKeyAndVisible()

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
