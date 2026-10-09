# Inkbound iOS compatibility and launch regression policy

## Incident: October 9, 2026

- iPhone 15 Pro Max running iOS 27.0.1 terminated Inkbound TestFlight build 15 at native launch.
- Crash reports show `EXC_BREAKPOINT / SIGTRAP` in `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`.
- Apple requires UIKit scene lifecycle adoption for apps built with the iOS 27 SDK.
- Inkbound's original native target used an AppDelegate and Main.storyboard but no scene manifest.
- The iOS 27 remediation introduces a **single** storyboard-backed SceneDelegate and retains the existing InkboundBridgeViewController; no storage schema, sync protocol, or Android changes.

## Release blockers

1. `npm run verify:native-projects` must pass on every release. It asserts a nonempty scene manifest, compiled SceneDelegate, scene configuration hook, and widget/auth URL forwarding.
2. `npm run verify:ios-ready` must pass on the Mac before Xcode archiving.
3. Test the *installed update over the existing TestFlight build*; never uninstall to get a clean test. Confirm the same local library, reading sessions, saved quotes, and widget state remain.
4. On an iPhone running the newest available iOS version, test: app icon cold launch; app relaunch after force-close; widget tap to correct book; widget Start Reading; Google/Apple sign-in redirects; foreground/background; device reboot; offline launch and recovery.
5. Repeat launch and widget tests on an iPad, including landscape and split-screen where supported.
6. Review Apple crash reports after each TestFlight upload and block release on new native launch failures.
7. Before major iOS releases, test an available beta on a nonproduction device and check Apple and Capacitor migration guidance. Track the installed Capacitor version; update its scene proxy integration only after verifying plugin compatibility and lockfile integrity.

## Data safety

- **Persistence is law.** Never wipe WebView storage, delete/reinstall as a default troubleshooting step, or overwrite the cloud from a device with incomplete hydration.
- **One source of truth.** Main.storyboard instantiates the single InkboundBridgeViewController. SceneDelegate must not construct a second bridge, create alternate storage, or duplicate pending widget actions.
- The scene migration must not change Firebase or cloud sync behavior. A failed native launch must not trigger migrations or data writes.

## Manual verification checklist (record actual results, not assumptions)

| Check | Result |
| --- | --- |
| iOS 27.0.1 iPhone cold launch | Pending |
| Existing TestFlight install upgraded without data loss | Pending |
| iPhone widget opens the correct book | Pending |
| iPhone active reading session survives force-close | Pending |
| Apple and Google authentication callbacks | Pending |
| iPad launch and widget | Pending |
| iPad landscape layout | Pending |
| iPhone offline startup and reconnection | Pending |
| Apple crash reports show no new startup failure | Pending |

Static checks cannot guarantee compatibility with future iOS updates. Real-device testing and crash monitoring are mandatory.
