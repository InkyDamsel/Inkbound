import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const CAPACITOR_VERSION = '8.4.0';
const CAPACITOR_APP_VERSION = '8.1.1';
const CAPACITOR_FILESYSTEM_VERSION = '8.1.2';
const CAPACITOR_SHARE_VERSION = '8.0.1';
const CAPACITOR_FIREBASE_VERSION = '8.3.0';
const minimumNodeMajor = 22;
const nodeMajor = Number(process.versions.node.split('.')[0]);

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function readAndroidReleaseMetadata() {
  const path = 'android-release.json';
  if (!fs.existsSync(path)) {
    console.error('Inkbound Android bootstrap requires android-release.json.');
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!Number.isInteger(parsed.versionCode) || parsed.versionCode < 1) {
    console.error('android-release.json versionCode must be a positive integer.');
    process.exit(1);
  }
  if (typeof parsed.versionName !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(parsed.versionName)) {
    console.error('android-release.json versionName must use semantic version format.');
    process.exit(1);
  }
  return parsed;
}

function applyAndroidReleaseVersion() {
  const metadata = readAndroidReleaseMetadata();
  const appGradlePath = 'android/app/build.gradle';
  if (!fs.existsSync(appGradlePath)) {
    console.error('Inkbound Android bootstrap could not find android/app/build.gradle.');
    process.exit(1);
  }

  let gradle = fs.readFileSync(appGradlePath, 'utf8');
  if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+["'][^"']+["']/.test(gradle)) {
    console.error('Inkbound Android bootstrap could not locate versionCode/versionName in app/build.gradle.');
    process.exit(1);
  }
  gradle = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${metadata.versionCode}`)
    .replace(/versionName\s+["'][^"']+["']/, `versionName "${metadata.versionName}"`);
  fs.writeFileSync(appGradlePath, gradle);
  console.log(`Applied Android release version ${metadata.versionName} (${metadata.versionCode}).`);
}

if (!Number.isFinite(nodeMajor) || nodeMajor < minimumNodeMajor) {
  console.error(`Inkbound Android bootstrap requires Node ${minimumNodeMajor}+ (current: ${process.versions.node}).`);
  process.exit(1);
}

console.log(`Preparing Inkbound Android with Capacitor ${CAPACITOR_VERSION}...`);

run('npm', [
  'install',
  '--save-exact',
  `@capacitor/core@${CAPACITOR_VERSION}`,
  `@capacitor/android@${CAPACITOR_VERSION}`,
  `@capacitor/app@${CAPACITOR_APP_VERSION}`,
  `@capacitor/filesystem@${CAPACITOR_FILESYSTEM_VERSION}`,
  `@capacitor/share@${CAPACITOR_SHARE_VERSION}`,
  `@capacitor-firebase/authentication@${CAPACITOR_FIREBASE_VERSION}`,
  `@capacitor-firebase/app-check@${CAPACITOR_FIREBASE_VERSION}`,
]);
run('npm', ['install', '--save-dev', '--save-exact', `@capacitor/cli@${CAPACITOR_VERSION}`]);

// First prove the shared application is green, then rebuild specifically for
// Android so web-only browser credentials are not copied into the native bundle.
run('npm', ['run', 'release:verify']);
run('npm', ['run', 'build:android']);

if (!fs.existsSync('android')) {
  run('npx', ['cap', 'add', 'android']);
} else {
  run('npx', ['cap', 'sync', 'android']);
}

applyAndroidReleaseVersion();

const variablesPath = 'android/variables.gradle';
if (!fs.existsSync(variablesPath)) {
  console.error('Inkbound Android bootstrap could not find android/variables.gradle after Capacitor setup.');
  process.exit(1);
}

const variables = fs.readFileSync(variablesPath, 'utf8');
const target36 = /targetSdkVersion\s*=\s*36/.test(variables);
const compile36 = /compileSdkVersion\s*=\s*36/.test(variables);
const min24 = /minSdkVersion\s*=\s*24/.test(variables);

if (!target36 || !compile36 || !min24) {
  console.error('Inkbound Android SDK configuration does not match the Capacitor 8 / Google Play baseline (min 24, compile 36, target 36).');
  process.exit(1);
}

run('npm', ['run', 'verify:android-config']);

console.log('Inkbound Android shell is ready: API 24 minimum, API 36 compile/target.');
console.log('Native lifecycle/export plus Firebase Authentication/App Check dependencies are installed for the adapter pass.');
console.log('The copied Android web bundle excludes the web-only Google Books API key.');
console.log('Next: add the Firebase Android app configuration, then wire Google credentials and Play Integrity into the shared Firebase JS session.');
