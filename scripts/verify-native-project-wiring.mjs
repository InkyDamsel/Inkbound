import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const fail = (message) => errors.push(message);
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const requiredFiles = [
  'android/app/src/main/AndroidManifest.xml',
  'android/app/src/main/java/com/inkydameinteractive/inkbound/MainActivity.java',
  'android/app/src/main/java/com/inkydameinteractive/inkbound/InkboundBarcodeScannerPlugin.java',
  'android/app/src/main/java/com/inkydameinteractive/inkbound/LoanReminderPlugin.java',
  'android/app/src/main/java/com/inkydameinteractive/inkbound/ReadingWidgetPlugin.java',
  'android/app/src/main/java/com/inkydameinteractive/inkbound/ReadingWidgetProvider.java',
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/App/Info.plist',
  'ios/App/App/PrivacyInfo.xcprivacy',
  'ios/App/App/InkboundBarcodeScannerPlugin.swift',
  'ios/App/App/LoanReminderPlugin.swift',
  'ios/App/App/ReadingWidgetPlugin.swift',
  'ios/App/App/InkboundBridgeViewController.swift',
  'ios/App/InkboundReadingWidget/InkboundReadingWidget.swift',
  'ios/App/InkboundReadingWidget/Info.plist',
  'ios/App/InkboundReadingWidget/InkboundReadingWidget.entitlements',
];

for (const file of requiredFiles) {
  if (!exists(file)) fail(`Required native project file is missing: ${file}`);
}

if (exists('android/app/src/main/AndroidManifest.xml')) {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  if (!manifest.includes('android.permission.CAMERA')) fail('Android manifest must declare CAMERA for ISBN scanning.');
  if (!manifest.includes('.ReadingWidgetProvider')) fail('Android manifest must register ReadingWidgetProvider.');
}

if (exists('android/app/src/main/java/com/inkydameinteractive/inkbound/MainActivity.java')) {
  const mainActivity = read('android/app/src/main/java/com/inkydameinteractive/inkbound/MainActivity.java');
  for (const required of [
    'registerPlugin(InkboundBarcodeScannerPlugin.class)',
    'registerPlugin(LoanReminderPlugin.class)',
    'registerPlugin(ReadingWidgetPlugin.class)',
  ]) {
    if (!mainActivity.includes(required)) fail(`Android MainActivity is missing ${required}.`);
  }
}

if (exists('ios/App/App.xcodeproj/project.pbxproj')) {
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  const buildNumbers = [...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => Number(match[1]));
  if (buildNumbers.length === 0 || buildNumbers.some((value) => value !== 7)) {
    fail('All iOS app/widget configurations must use build 7.');
  }
  const marketingVersions = [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1].trim());
  if (marketingVersions.length === 0 || marketingVersions.some((value) => value !== '1.0')) {
    fail('All iOS app/widget configurations must remain on marketing version 1.0.');
  }
  for (const required of [
    'InkboundBridgeViewController.swift',
    'InkboundBarcodeScannerPlugin.swift',
    'LoanReminderPlugin.swift',
    'ReadingWidgetPlugin.swift',
    'InkboundReadingWidget.appex',
    'com.inkydameinteractive.inkbound.ReadingWidget',
    'Embed App Extensions',
  ]) {
    if (!project.includes(required)) fail(`iOS Xcode project is missing native wiring: ${required}.`);
  }
}

if (exists('ios/App/App/Info.plist')) {
  const info = read('ios/App/App/Info.plist');
  for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription']) {
    if (!info.includes(`<key>${key}</key>`)) fail(`iOS Info.plist is missing ${key}.`);
  }
}

const iosEntitlementFiles = exists('ios/App/App')
  ? fs.readdirSync(path.join(root, 'ios', 'App', 'App')).filter((name) => name.endsWith('.entitlements'))
  : [];
if (iosEntitlementFiles.length === 0) {
  fail('iOS app target entitlements are missing.');
} else {
  const entitlements = iosEntitlementFiles
    .map((name) => fs.readFileSync(path.join(root, 'ios', 'App', 'App', name), 'utf8'))
    .join('\n');
  for (const required of [
    'com.apple.developer.applesignin',
    'com.apple.developer.devicecheck.appattest-environment',
    'group.com.inkydameinteractive.inkbound',
  ]) {
    if (!entitlements.includes(required)) fail(`iOS app entitlements are missing ${required}.`);
  }
}

if (errors.length) {
  console.error('\nInkbound native project wiring verification FAILED:\n');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('Inkbound cross-platform native project wiring verified.');
console.log('Local signing certificates and platform credential files are intentionally excluded from release:verify.');
