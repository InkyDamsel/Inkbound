import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ID = 'inkbound-app';
const SECRET_NAMES = ['HARDCOVER_API_TOKEN', 'GOOGLE_BOOKS_API_KEY'];
const targetPath = path.join(process.cwd(), 'functions', '.secret.local');
const npmExecPath = process.env.npm_execpath;
const npxExecPath = npmExecPath ? path.join(path.dirname(npmExecPath), 'npx-cli.js') : undefined;

function firebaseInvocation(args) {
  if (process.platform === 'win32' && npxExecPath) {
    return {
      command: process.execPath,
      args: [npxExecPath, 'firebase-tools', ...args],
    };
  }
  return {
    command: 'npx',
    args: ['firebase-tools', ...args],
  };
}

function readSecret(secretName) {
  const invocation = firebaseInvocation([
    'functions:secrets:access',
    secretName,
    '--project',
    PROJECT_ID,
  ]);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });

  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim().split('\n').slice(-2).join(' ');
    throw new Error(
      `Could not load ${secretName} for local catalog parity.${detail ? ` ${detail}` : ''}`,
    );
  }

  const value = String(result.stdout || '').trim();
  if (!value) throw new Error(`${secretName} returned an empty value.`);
  return value;
}

try {
  console.log('Inkbound DEV: syncing catalog credentials for local emulator parity...');
  const values = Object.fromEntries(SECRET_NAMES.map((name) => [name, readSecret(name)]));
  const contents = SECRET_NAMES
    .map((name) => `${name}=${values[name].replace(/\r?\n/g, '')}`)
    .join('\n');

  fs.writeFileSync(targetPath, `${contents}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  console.log('Inkbound DEV: local catalog providers match the app backend configuration.');
} catch (error) {
  console.error(
    'Inkbound DEV cannot guarantee app-parity catalog behavior because local Functions could not load the required catalog secrets.',
  );
  console.error(error instanceof Error ? error.message : error);
  console.error(
    'Sign in to the Firebase CLI with an account that can access this project, then run npm run dev again.',
  );
  process.exit(1);
}
