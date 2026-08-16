import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
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
const firebaseBootstrapPath = path.join(root, 'src', 'lib', 'firebase.ts');
const firebaseBootstrap = fs.readFileSync(firebaseBootstrapPath, 'utf8');

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
  {
    ok: firebaseBootstrap.includes('initializeAppCheck(')
      && firebaseBootstrap.includes('ReCaptchaEnterpriseProvider'),
    message: 'src/lib/firebase.ts must remain the production App Check initializer',
  },
];

const sourceFilesWithAppCheckInitialization = [];
const sourceRoot = path.join(root, 'src');
const visitSource = (directory) => {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visitSource(fullPath);
      return;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) return;
    const content = fs.readFileSync(fullPath, 'utf8');
    if (content.includes('initializeAppCheck(')) {
      sourceFilesWithAppCheckInitialization.push(path.relative(root, fullPath));
    }
  });
};
visitSource(sourceRoot);

checks.push({
  ok: sourceFilesWithAppCheckInitialization.length === 1
    && sourceFilesWithAppCheckInitialization[0] === 'src/lib/firebase.ts',
  message: `Firebase App Check must have one source of truth in src/lib/firebase.ts (found: ${sourceFilesWithAppCheckInitialization.join(', ') || 'none'})`,
});

const failures = checks.filter((check) => !check.ok).map((check) => check.message);
if (failures.length > 0) {
  console.error('Inkbound release artifact verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Inkbound release artifacts verified.');
