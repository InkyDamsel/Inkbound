import fs from 'node:fs';
import path from 'node:path';

const gradlePath = path.join(process.cwd(), 'android', 'app', 'build.gradle');

if (!fs.existsSync(gradlePath)) {
  console.error('Inkbound Android Gradle verification failed: android/app/build.gradle is missing.');
  process.exit(1);
}

const gradle = fs.readFileSync(gradlePath, 'utf8');
const failures = [];

if (!gradle.includes("getDefaultProguardFile('proguard-android-optimize.txt')")) {
  failures.push('release build must use proguard-android-optimize.txt with the current Android Gradle Plugin.');
}

if (/getDefaultProguardFile\(['"]proguard-android\.txt['"]\)/.test(gradle)) {
  failures.push('deprecated proguard-android.txt must not be reintroduced.');
}

if (failures.length > 0) {
  console.error('Inkbound Android Gradle verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Inkbound Android Gradle configuration verified.');
