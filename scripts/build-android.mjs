import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';

const cwd = process.cwd();

// Match production env precedence before overriding the one browser-only
// credential that must never be packaged into the Android application.
for (const filename of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  const filepath = path.join(cwd, filename);
  if (fs.existsSync(filepath)) loadDotenv({ path: filepath, override: true });
}

const browserGoogleBooksKey = String(process.env.VITE_GOOGLE_BOOKS_API_KEY ?? '').trim();
const env = {
  ...process.env,
  VITE_GOOGLE_BOOKS_API_KEY: '',
  VITE_RUNTIME_TARGET: 'android',
};

// A native debug APK still embeds a Vite production bundle by default.
// The explicit scanner test path uses its own Vite mode; standard builds remain clean.
const scannerDebug = process.argv.includes('--scanner-debug');
const buildArgs = scannerDebug
  ? ['run', 'build:scanner-debug']
  : ['run', 'build'];
const result = spawnSync('npm', buildArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

if (result.status !== 0) process.exit(result.status ?? 1);

if (browserGoogleBooksKey) {
  const assetsDir = path.join(cwd, 'dist', 'assets');
  const bundledFiles = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir).filter((name) => name.endsWith('.js'))
    : [];
  const leakedInto = bundledFiles.filter((name) =>
    fs.readFileSync(path.join(assetsDir, name), 'utf8').includes(browserGoogleBooksKey),
  );
  if (leakedInto.length > 0) {
    console.error(`Inkbound Android build blocked: web-only Google Books key leaked into ${leakedInto.join(', ')}.`);
    process.exit(1);
  }
}

console.log(scannerDebug
  ? 'Inkbound Android scanner-debug bundle built without the web-only Google Books API key (testing only).'
  : 'Inkbound Android web bundle built without the web-only Google Books API key.');
