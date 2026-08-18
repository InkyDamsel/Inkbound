import fs from 'node:fs';

const metadataPath = 'android-release.json';
const appGradlePath = 'android/app/build.gradle';
const requestedVersionName = process.argv[2]?.trim();

if (!requestedVersionName || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(requestedVersionName)) {
  console.error('Usage: npm run android:bump -- <versionName>  (example: npm run android:bump -- 0.1.0-beta.1)');
  process.exit(1);
}

if (!fs.existsSync(metadataPath)) {
  console.error('android-release.json is missing.');
  process.exit(1);
}
if (!fs.existsSync(appGradlePath)) {
  console.error('android/app/build.gradle is missing. Run npm run android:bootstrap first.');
  process.exit(1);
}

const current = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
if (!Number.isInteger(current.versionCode) || current.versionCode < 1) {
  console.error('android-release.json has an invalid versionCode.');
  process.exit(1);
}

const next = {
  versionCode: current.versionCode + 1,
  versionName: requestedVersionName,
};

let gradle = fs.readFileSync(appGradlePath, 'utf8');
if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+["'][^"']+["']/.test(gradle)) {
  console.error('Could not locate versionCode/versionName in android/app/build.gradle.');
  process.exit(1);
}

gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${next.versionCode}`)
  .replace(/versionName\s+["'][^"']+["']/, `versionName "${next.versionName}"`);

// Keep the release metadata and generated Gradle project aligned in the same
// operation. Play Console requires every uploaded bundle to use a unique,
// monotonically increasing versionCode, so a partial version bump is unsafe.
fs.writeFileSync(metadataPath, `${JSON.stringify(next, null, 2)}\n`);
fs.writeFileSync(appGradlePath, gradle);

console.log(`Inkbound Android version is now ${next.versionName} (${next.versionCode}).`);
console.log('android-release.json and android/app/build.gradle are synchronized.');
console.log('Run npm run android:sync before producing the next Android build.');
