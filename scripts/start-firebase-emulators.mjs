import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const exportDirectory = '.firebase-emulator-data';
const exportMetadata = path.join(exportDirectory, 'firebase-export-metadata.json');
const npmExecPath = process.env.npm_execpath;
const npxExecPath = npmExecPath ? path.join(path.dirname(npmExecPath), 'npx-cli.js') : undefined;
const npxInvocation = process.platform === 'win32' && npxExecPath
  ? { command: process.execPath, prefixArgs: [npxExecPath] }
  : { command: 'npx', prefixArgs: [] };
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

const child = spawn(npxInvocation.command, [...npxInvocation.prefixArgs, ...args], {
  stdio: 'inherit',
  shell: false,
});

let shutdownRequested = false;

const requestShutdown = (signal) => {
  if (shutdownRequested) return;
  shutdownRequested = true;
  console.log(`\nInkbound DEV: stopping Firebase emulators and saving local emulator data...`);

  if (!child.killed) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));

child.on('error', (error) => {
  console.error('Inkbound could not start the Firebase emulators.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (shutdownRequested) {
    if (code && code !== 0) {
      console.warn(`Inkbound DEV: Firebase emulators exited with code ${code} while shutting down.`);
      process.exitCode = code;
      return;
    }
    console.log('Inkbound DEV: Firebase emulators stopped. Local emulator data is ready for the next DEV session.');
    process.exitCode = 0;
    return;
  }

  if (signal) {
    console.error(`Inkbound DEV: Firebase emulators stopped unexpectedly (${signal}).`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
