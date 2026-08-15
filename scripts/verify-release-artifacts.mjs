import fs from 'node:fs';
import path from 'node:path';

const dist = path.join(process.cwd(), 'dist');
const requiredFiles = [
  'index.html',
  'privacy.html',
  'terms.html',
  'delete-account.html',
  'support.html',
  'manifest.webmanifest',
  'sw.js',
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(dist, file)));

if (missing.length > 0) {
  console.error(`Inkbound release artifact verification failed. Missing: ${missing.join(', ')}`);
  process.exit(1);
}

const manifest = fs.readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8');
const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');

const checks = [
  {
    ok: /"display"\s*:\s*"standalone"/.test(manifest),
    message: 'manifest.webmanifest must declare display: standalone',
  },
  {
    ok: /rel=["']manifest["']/.test(index),
    message: 'index.html must link the web app manifest',
  },
  {
    ok: serviceWorker.includes('inkbound-shell-v1'),
    message: 'sw.js must contain the current Inkbound shell cache identifier',
  },
  {
    ok: serviceWorker.includes("request.mode === 'navigate'"),
    message: 'sw.js must retain offline navigation fallback behavior',
  },
  {
    ok: serviceWorker.includes("url.pathname.startsWith('/assets/')"),
    message: 'sw.js must retain hashed asset caching behavior',
  },
];

const failures = checks.filter((check) => !check.ok).map((check) => check.message);
if (failures.length > 0) {
  console.error('Inkbound release artifact verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Inkbound release artifacts verified.');
