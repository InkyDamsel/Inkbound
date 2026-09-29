import fs from 'node:fs';

const metadataPath = 'android-release.json';
const gradlePath = 'android/app/build.gradle';

if (!fs.existsSync(metadataPath) || !fs.existsSync(gradlePath)) {
  console.error('Android version sync failed: required release metadata or Gradle file is missing.');
  process.exit(1);
}

const release = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
if (!Number.isInteger(release.versionCode) || release.versionCode < 1 || typeof release.versionName !== 'string') {
  console.error('Android version sync failed: android-release.json is invalid.');
  process.exit(1);
}

let gradle = fs.readFileSync(gradlePath, 'utf8');
if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+["'][^"']+["']/.test(gradle)) {
  console.error('Android version sync failed: versionCode/versionName were not found in build.gradle.');
  process.exit(1);
}

gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${release.versionCode}`)
  .replace(/versionName\s+["'][^"']+["']/, `versionName "${release.versionName}"`);

fs.writeFileSync(gradlePath, gradle);
console.log(`Inkbound Android generated version synchronized to ${release.versionName} (${release.versionCode}).`);
