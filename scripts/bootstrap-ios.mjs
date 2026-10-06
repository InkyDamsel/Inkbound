import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const iosDir = path.join(root, 'ios');
const xcodeProject = path.join(iosDir, 'App', 'App.xcodeproj');
const infoPlist = path.join(iosDir, 'App', 'App', 'Info.plist');
const privacyManifest = path.join(iosDir, 'App', 'App', 'PrivacyInfo.xcprivacy');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform !== 'darwin') {
  console.error('Inkbound iOS bootstrap must run on macOS with Xcode installed.');
  process.exit(1);
}

const xcode = spawnSync('xcodebuild', ['-version'], { encoding: 'utf8' });
if (xcode.status !== 0) {
  console.error('Xcode is required before Inkbound can create the iOS project.');
  process.exit(1);
}
console.log(xcode.stdout.trim());

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!packageJson.dependencies?.['@capacitor/ios']) {
  run('npm', ['install', '@capacitor/ios@8.4.0', '--save-exact']);
}

if (!fs.existsSync(xcodeProject)) {
  run('npx', ['cap', 'add', 'ios']);
}

run('npm', ['run', 'build:ios']);
run('npx', ['cap', 'sync', 'ios']);

if (fs.existsSync(infoPlist)) {
  const source = fs.readFileSync(infoPlist, 'utf8');
  const additions = [
    ['NSCameraUsageDescription', 'Inkbound uses the camera only when you choose to scan a book barcode.'],
    ['NSPhotoLibraryUsageDescription', 'Inkbound lets you choose images for your reader profile and reading memories.'],
  ];

  let next = source;
  if (!next.includes('<key>ITSAppUsesNonExemptEncryption</key>')) {
    next = next.replace(
      '</dict>',
      '\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n</dict>',
    );
  }
  for (const [key, value] of additions) {
    if (next.includes(`<key>${key}</key>`)) continue;
    next = next.replace(
      '</dict>',
      `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>`,
    );
  }
  if (next !== source) fs.writeFileSync(infoPlist, next);
}

if (!fs.existsSync(privacyManifest)) {
  fs.writeFileSync(
    privacyManifest,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key>
  <false/>
  <key>NSPrivacyTrackingDomains</key>
  <array/>
  <key>NSPrivacyCollectedDataTypes</key>
  <array/>
  <key>NSPrivacyAccessedAPITypes</key>
  <array/>
</dict>
</plist>
`,
  );
}

console.log('\nInkbound iOS project is created and synced.');
console.log('Next in Xcode:');
console.log('1. Set the Team for com.inkydameinteractive.inkbound.');
console.log('2. Add Sign in with Apple capability.');
console.log('3. Add App Attest capability and set the production environment.');
console.log('4. Add In-App Purchase capability before opening Premium subscriptions on iOS.');
console.log('5. Add GoogleService-Info.plist from Firebase to the App target.');
console.log('6. Confirm PrivacyInfo.xcprivacy belongs to the App target.');
