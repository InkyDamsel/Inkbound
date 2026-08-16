import fs from 'node:fs';

const path = 'android-release.json';
const requestedVersionName = process.argv[2]?.trim();

if (!requestedVersionName || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(requestedVersionName)) {
  console.error('Usage: npm run android:bump -- <versionName>  (example: npm run android:bump -- 0.2.0)');
  process.exit(1);
}

if (!fs.existsSync(path)) {
  console.error('android-release.json is missing.');
  process.exit(1);
}

const current = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!Number.isInteger(current.versionCode) || current.versionCode < 1) {
  console.error('android-release.json has an invalid versionCode.');
  process.exit(1);
}

const next = {
  versionCode: current.versionCode + 1,
  versionName: requestedVersionName,
};
fs.writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
console.log(`Inkbound Android version is now ${next.versionName} (${next.versionCode}).`);
console.log('Run npm run android:sync before producing the next Android build.');
