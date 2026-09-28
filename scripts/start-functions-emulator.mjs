import { spawn } from 'node:child_process';
import path from 'node:path';

const npmExecPath = process.env.npm_execpath;
const npxExecPath = npmExecPath ? path.join(path.dirname(npmExecPath), 'npx-cli.js') : undefined;
const npxInvocation = process.platform === 'win32' && npxExecPath
  ? { command: process.execPath, prefixArgs: [npxExecPath] }
  : { command: 'npx', prefixArgs: [] };

const args = [
  'firebase-tools',
  'emulators:start',
  '--only',
  'functions',
  '--project',
  'inkbound-app',
];

const child = spawn(npxInvocation.command, [...npxInvocation.prefixArgs, ...args], {
  stdio: 'inherit',
  shell: false,
});

let shutdownRequested = false;

const requestShutdown = (signal) => {
  if (shutdownRequested) return;
  shutdownRequested = true;
  console.log('\nInkbound DEV: stopping local Functions emulator...');
  if (!child.killed) child.kill(signal);
};

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));

child.on('error', (error) => {
  console.error('Inkbound could not start the Functions emulator.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (shutdownRequested) {
    process.exitCode = code ?? 0;
    return;
  }
  if (signal) {
    console.error(`Inkbound Functions emulator stopped unexpectedly (${signal}).`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
