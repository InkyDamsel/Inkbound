import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!fs.existsSync('android')) {
  console.error('Inkbound Android signing report requires the generated android/ project. Run npm run android:bootstrap first.');
  process.exit(1);
}

const windows = process.platform === 'win32';
const result = windows
  ? spawnSync('gradlew.bat signingReport', {
      cwd: 'android',
      stdio: 'inherit',
      shell: true,
    })
  : spawnSync('./gradlew', ['signingReport'], {
      cwd: 'android',
      stdio: 'inherit',
    });

if (result.status !== 0) process.exit(result.status ?? 1);

console.log('\nInkbound: copy the debug SHA-1 and SHA-256 fingerprints above into the Firebase Android app settings.');
console.log('For Google Play production, also add the Play App Signing certificate fingerprints after Play Console creates them.');
