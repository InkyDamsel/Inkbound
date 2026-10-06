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
const widgetRoot = path.join(iosRoot, 'InkboundReadingWidget');
const widgetSource = path.join(widgetRoot, 'InkboundReadingWidget.swift');
const widgetInfo = path.join(widgetRoot, 'Info.plist');
const widgetEntitlements = path.join(widgetRoot, 'InkboundReadingWidget.entitlements');


for (const [file, label] of [
  [project, 'Xcode project'],
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
}

if (fs.existsSync(infoPlist)) {
  const source = fs.readFileSync(infoPlist, 'utf8');
  for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription']) {
    if (!source.includes(`<key>${key}</key>`)) fail(`Info.plist is missing ${key}.`);
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
