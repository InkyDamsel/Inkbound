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

for (const [file, label] of [
  [project, 'Xcode project'],
  [infoPlist, 'Info.plist'],
  [privacyManifest, 'PrivacyInfo.xcprivacy'],
  [googleService, 'GoogleService-Info.plist'],
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
}

if (process.exitCode) process.exit(process.exitCode);

console.log('Inkbound iOS native project readiness checks passed.');
console.log('App Store Connect metadata, privacy answers, screenshots, age rating, agreements, and TestFlight device testing still require manual verification.');
