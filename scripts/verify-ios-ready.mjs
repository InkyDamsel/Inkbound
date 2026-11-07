import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fail = (message) => {
  console.error(`Inkbound iOS readiness failed: ${message}`);
  process.exitCode = 1;
};

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));

if (!packageJson.dependencies?.['@capacitor/ios']) {
  fail('@capacitor/ios is not installed. Run npm run ios:bootstrap on macOS.');
}

if (!config.plugins?.FirebaseAuthentication?.providers?.includes('apple.com')) {
  fail('Capacitor Firebase Authentication must enable apple.com.');
}

const iosRoot = path.join(root, 'ios', 'App');
const appRoot = path.join(iosRoot, 'App');
const project = path.join(iosRoot, 'App.xcodeproj', 'project.pbxproj');
const infoPlist = path.join(appRoot, 'Info.plist');
const googleService = path.join(appRoot, 'GoogleService-Info.plist');
const privacyManifest = path.join(appRoot, 'PrivacyInfo.xcprivacy');
const barcodePlugin = path.join(appRoot, 'InkboundBarcodeScannerPlugin.swift');
const reminderPlugin = path.join(appRoot, 'LoanReminderPlugin.swift');
const widgetPlugin = path.join(appRoot, 'ReadingWidgetPlugin.swift');
const bridgeController = path.join(appRoot, 'InkboundBridgeViewController.swift');
const sceneDelegate = path.join(appRoot, 'SceneDelegate.swift');
const appDelegate = path.join(appRoot, 'AppDelegate.swift');
const widgetRoot = path.join(iosRoot, 'InkboundReadingWidget');
const widgetSource = path.join(widgetRoot, 'InkboundReadingWidget.swift');
const widgetInfo = path.join(widgetRoot, 'Info.plist');
const widgetEntitlements = path.join(widgetRoot, 'InkboundReadingWidget.entitlements');


for (const [file, label] of [
  [project, 'Xcode project'],
  [sceneDelegate, 'UIKit SceneDelegate'],
  [appDelegate, 'UIKit AppDelegate'],
  [infoPlist, 'Info.plist'],
  [privacyManifest, 'PrivacyInfo.xcprivacy'],
  [googleService, 'GoogleService-Info.plist'],
  [barcodePlugin, 'iOS barcode scanner plugin'],
  [reminderPlugin, 'iOS loan reminder plugin'],
  [widgetPlugin, 'iOS reading widget bridge plugin'],
  [bridgeController, 'iOS native plugin bridge controller'],
  [widgetSource, 'iOS WidgetKit source'],
  [widgetInfo, 'iOS WidgetKit Info.plist'],
  [widgetEntitlements, 'iOS WidgetKit entitlements'],
]) {
  if (!fs.existsSync(file)) fail(`${label} is missing.`);
}

if (fs.existsSync(project)) {
  const source = fs.readFileSync(project, 'utf8');
  if (!source.includes('com.inkydameinteractive.inkbound')) fail('Xcode project does not use the Inkbound bundle identifier.');
  if (!source.includes('CODE_SIGN_ENTITLEMENTS')) fail('Xcode target is missing an entitlements file.');
  const buildNumbers = [...source.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => Number(match[1]));
  if (buildNumbers.length !== 4 || buildNumbers.some((value) => !Number.isSafeInteger(value) || value < 1 || value !== buildNumbers[0])) fail('iOS app and widget Debug/Release configurations must all use the same positive build number.');
  const marketingVersions = [...source.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1].trim());
  if (marketingVersions.length === 0 || !/^[0-9]+[.][0-9]+[.][0-9]+$/.test(marketingVersions[0]) || marketingVersions.some((value) => value !== marketingVersions[0])) fail('All iOS app/widget configurations must use the same valid marketing version (major.minor.patch).');
}

if (fs.existsSync(infoPlist)) {
  const source = fs.readFileSync(infoPlist, 'utf8');
  for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription']) {
    if (!source.includes(`<key>${key}</key>`)) fail(`Info.plist is missing ${key}.`);
  }
  if (!source.includes('<key>ITSAppUsesNonExemptEncryption</key>') || !/ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(source)) {
    fail('Info.plist must declare ITSAppUsesNonExemptEncryption = false so App Store Connect does not require export-compliance management for exempt encryption.');
  }

  if (fs.existsSync(googleService)) {
    const googleSource = fs.readFileSync(googleService, 'utf8');
    const reversedMatch = googleSource.match(new RegExp('<key>REVERSED_CLIENT_ID</key>\\s*<string>([^<]+)</string>'));
    const reversedClientId = reversedMatch?.[1]?.trim();
    if (!reversedClientId) {
      fail('GoogleService-Info.plist is missing REVERSED_CLIENT_ID.');
    } else if (!source.includes(`<string>${reversedClientId}</string>`)) {
      fail('Info.plist is missing the Google sign-in callback URL scheme. Run npm run ios:google-signin:configure.');
    }
  }
}

// Native launch on iOS 27 requires an actual scene manifest and compiled delegate.
// Checking this at packaging time prevents a valid archive that immediately SIGTRAPs.
if (fs.existsSync(infoPlist)) {
  const plist = fs.readFileSync(infoPlist, 'utf8');
  for (const required of [
    'UIApplicationSceneManifest',
    'UISceneConfigurations',
    'UIWindowSceneSessionRoleApplication',
    '$(PRODUCT_MODULE_NAME).SceneDelegate',
    'UISceneStoryboardFile',
  ]) {
    if (!plist.includes(required)) fail(`iOS 27 launch configuration missing ${required}.`);
  }
}
if (fs.existsSync(project) && !fs.readFileSync(project, 'utf8').includes('SceneDelegate.swift in Sources')) {
  fail('UIKit SceneDelegate must be compiled into the app target.');
}
if (fs.existsSync(sceneDelegate)) {
  const source = fs.readFileSync(sceneDelegate, 'utf8');
  if (!source.includes('connectionOptions.urlContexts') || !source.includes('openURLContexts')) {
    fail('SceneDelegate must route cold and warm widget/auth URL callbacks.');
  }
}

const entitlementCandidates = fs.existsSync(appRoot)
  ? fs.readdirSync(appRoot).filter((name) => name.endsWith('.entitlements')).map((name) => path.join(appRoot, name))
  : [];
if (entitlementCandidates.length === 0) {
  fail('App target entitlements are missing. Add Sign in with Apple and App Attest capabilities in Xcode.');
} else {
  const entitlements = entitlementCandidates.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  if (!entitlements.includes('com.apple.developer.applesignin')) fail('Sign in with Apple capability is missing.');
  if (!entitlements.includes('com.apple.developer.devicecheck.appattest-environment')) fail('App Attest capability is missing.');
  if (!entitlements.includes('<string>production</string>')) fail('App Attest must use the production environment for App Check.');
  if (!entitlements.includes('group.com.inkydameinteractive.inkbound')) fail('App target must join the Inkbound App Group used by the reading widget.');
}

if (fs.existsSync(project)) {
  const projectSource = fs.readFileSync(project, 'utf8');
  for (const required of [
    'InkboundBridgeViewController.swift',
    'InkboundBarcodeScannerPlugin.swift',
    'LoanReminderPlugin.swift',
    'ReadingWidgetPlugin.swift',
    'InkboundReadingWidget.appex',
    'com.inkydameinteractive.inkbound.ReadingWidget',
    'Embed App Extensions',
  ]) {
    if (!projectSource.includes(required)) fail(`Xcode project is missing iOS parity wiring: ${required}.`);
  }
}

if (fs.existsSync(widgetEntitlements)) {
  const widgetEntitlementSource = fs.readFileSync(widgetEntitlements, 'utf8');
  if (!widgetEntitlementSource.includes('group.com.inkydameinteractive.inkbound')) {
    fail('Reading widget extension must join the same Inkbound App Group as the app.');
  }
}

if (process.exitCode) process.exit(process.exitCode);

console.log('Inkbound iOS native project readiness checks passed.');
console.log('Inkbound iOS scanner, loan reminders, and WidgetKit reading widget wiring verified.');
console.log('App Store Connect metadata, privacy answers, screenshots, age rating, agreements, and TestFlight device testing still require manual verification.');
