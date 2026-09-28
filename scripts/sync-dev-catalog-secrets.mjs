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

function readExistingSecrets() {
  if (!fs.existsSync(targetPath)) return {};
  const contents = fs.readFileSync(targetPath, 'utf8');
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
      .filter(([name, value]) => name && value),
  );
}

function readSecret(secretName) {
  const fromEnvironment = String(process.env[secretName] || '').trim();
  if (fromEnvironment) return fromEnvironment;

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

  if (result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

try {
  console.log('Inkbound DEV: preparing local catalog credentials...');
  const existing = readExistingSecrets();
  const values = {};

  for (const name of SECRET_NAMES) {
    const existingValue = String(existing[name] || '').trim();
    if (existingValue) {
      values[name] = existingValue;
      continue;
    }

    const fetched = readSecret(name);
    if (!fetched) {
      throw new Error(
        `Missing ${name}. Add it once to functions/.secret.local or provide it as an environment variable.`,
      );
    }
    values[name] = fetched;
  }

  const contents = SECRET_NAMES
    .map((name) => `${name}=${values[name].replace(/\r?\n/g, '')}`)
    .join('\n');

  fs.writeFileSync(targetPath, `${contents}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  console.log('Inkbound DEV: local catalog credentials are ready.');
} catch (error) {
  console.error('Inkbound DEV could not prepare local catalog credentials.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
