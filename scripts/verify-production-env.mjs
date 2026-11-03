import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

const cwd = process.cwd();
// Native build wrappers intentionally set this in the child environment.
// Preserve that explicit choice when loading .env files so iOS is not
// accidentally validated as a web build (which requires a browser-only key).
const explicitRuntimeTarget = String(process.env.VITE_RUNTIME_TARGET ?? '').trim();

// Match Vite's production env precedence without requiring developers to export
// secrets into their shell before running a Firebase deploy command.
for (const filename of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  const filepath = path.join(cwd, filename);
  if (fs.existsSync(filepath)) loadDotenv({ path: filepath, override: true });
}

const runtimeTarget = (explicitRuntimeTarget || String(process.env.VITE_RUNTIME_TARGET ?? 'web')).trim().toLowerCase();
const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_APP_CHECK_SITE_KEY',
  // The browser build calls Google Books directly, so it requires the browser
  // key. Android and iOS deliberately clear that key and route book search through
  // native-safe catalogs/protected backend; requiring it for either native
  // bundle would force a browser credential into the app.
  ...(runtimeTarget === 'android' || runtimeTarget === 'ios' ? [] : ['VITE_GOOGLE_BOOKS_API_KEY']),
];

const missing = required.filter((name) => !String(process.env[name] ?? '').trim());
const placeholders = required.filter((name) => {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  return value.includes('your_') || value.includes('your-project') || value.includes('example.com');
});

if (missing.length || placeholders.length) {
  console.error('\nInkbound production deployment blocked.');
  if (missing.length) console.error(`Missing production variables: ${missing.join(', ')}`);
  if (placeholders.length) console.error(`Placeholder production values: ${placeholders.join(', ')}`);
  console.error('Configure real production values in an ignored env file before deploying.\n');
  process.exit(1);
}

if (process.env.VITE_FIREBASE_PROJECT_ID !== 'inkbound-app') {
  console.error(
    `\nInkbound production deployment blocked: VITE_FIREBASE_PROJECT_ID is ${process.env.VITE_FIREBASE_PROJECT_ID}, expected inkbound-app.\n`,
  );
  process.exit(1);
}

console.log(`Inkbound ${runtimeTarget} production environment verified.`);
