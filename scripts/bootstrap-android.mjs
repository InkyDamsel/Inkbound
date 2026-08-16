import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const CAPACITOR_VERSION = '8.4.0';
const CAPACITOR_APP_VERSION = '8.1.1';
const CAPACITOR_FILESYSTEM_VERSION = '8.1.2';
const CAPACITOR_SHARE_VERSION = '8.0.1';
const minimumNodeMajor = 22;
const nodeMajor = Number(process.versions.node.split('.')[0]);

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
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
]);
run('npm', ['install', '--save-dev', '--save-exact', `@capacitor/cli@${CAPACITOR_VERSION}`]);
run('npm', ['run', 'release:verify']);

if (!fs.existsSync('android')) {
  run('npx', ['cap', 'add', 'android']);
} else {
  run('npx', ['cap', 'sync', 'android']);
}

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

run('npm', ['run', 'verify:android']);

console.log('Inkbound Android shell is ready: API 24 minimum, API 36 compile/target.');
console.log('Native lifecycle/export plugin dependencies are installed for the next adapter pass.');
console.log('Next: add the Firebase Android app configuration, then open android/ in Android Studio for the first Gradle/device run.');
