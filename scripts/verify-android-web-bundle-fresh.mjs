import fs from 'node:fs';
import path from 'node:path';
import { androidWebBundleFingerprint } from './android-web-bundle-fingerprint.mjs';

const root = process.cwd();
const stampPath = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public', '.inkbound-build-stamp.json');

const fail = (message) => {
  console.error(`Inkbound Android bundle freshness check failed: ${message}`);
  console.error('Run: npm run android:sync');
  process.exit(1);
};

if (!fs.existsSync(stampPath)) {
  fail('the Android project has no web-bundle stamp. Its packaged web assets may be stale.');
}

let stamp;
try {
  stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
} catch {
  fail('the Android web-bundle stamp is invalid.');
}

const expected = androidWebBundleFingerprint(root);
if (stamp.sourceFingerprint !== expected) {
  fail('android/app/src/main/assets/public was built from different source than the current checkout.');
}

let release;
try {
  release = JSON.parse(fs.readFileSync(path.join(root, 'android-release.json'), 'utf8'));
} catch {
  fail('android-release.json is invalid.');
}

if (stamp.versionCode !== release.versionCode || stamp.versionName !== release.versionName) {
  fail(`the Android web bundle was stamped for ${stamp.versionName ?? 'unknown'} (${stamp.versionCode ?? 'unknown'}), but this checkout is ${release.versionName} (${release.versionCode}).`);
}

console.log(`Inkbound Android web bundle is fresh for ${release.versionName} (${release.versionCode}).`);
