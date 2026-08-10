import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const exportDirectory = '.firebase-emulator-data';
const exportMetadata = path.join(exportDirectory, 'firebase-export-metadata.json');
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = [
  'firebase-tools',
  'emulators:start',
  '--only',
  'auth,firestore,functions,storage',
  '--project',
  'inkbound-app',
];

if (existsSync(exportMetadata)) {
  args.push(`--import=${exportDirectory}`);
  console.log('Inkbound DEV: restoring the previous local Firebase emulator data.');
} else {
  console.log('Inkbound DEV: starting a fresh local Firebase workspace.');
}

args.push(`--export-on-exit=${exportDirectory}`);

const child = spawn(npxCommand, args, {
  stdio: 'inherit',
  shell: false,
});

child.on('error', (error) => {
  console.error('Inkbound could not start the Firebase emulators.', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
