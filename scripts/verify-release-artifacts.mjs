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
  'robots.txt',
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
const robots = fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8');
const builtJavaScript = fs.existsSync(path.join(dist, 'assets'))
  ? fs.readdirSync(path.join(dist, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(dist, 'assets', name), 'utf8'))
    .join('\n')
  : '';

const firebaseBootstrapPath = path.join(root, 'src', 'lib', 'firebase.ts');
const firebaseBootstrap = fs.readFileSync(firebaseBootstrapPath, 'utf8');

const checks = [
  {
    ok: builtJavaScript.includes('G-2LDXP8Z4S0'),
    message: 'production bundle must contain the canonical Inkbound GA4 measurement ID',
  },
  {
    ok: /"display"\s*:\s*"standalone"/.test(manifest),
    message: 'manifest.webmanifest must declare display: standalone',
  },
  {
    ok: /"start_url"\s*:\s*"\/app"/.test(manifest),
    message: 'manifest.webmanifest must launch the web application at /app',
  },
  {
    ok: manifest.includes('/assets/branding/pwa/icon-192.png')
      && manifest.includes('/assets/branding/pwa/icon-512.png'),
    message: 'manifest.webmanifest must use the production Inkbound PWA icons',
  },
  {
    ok: /rel=["']manifest["']/.test(index),
    message: 'index.html must link the web app manifest',
  },
  {
    ok: /name=["']description["']/.test(index)
      && /property=["']og:title["']/.test(index),
    message: 'index.html must include search and social-sharing metadata',
  },
  {
    ok: serviceWorker.includes("const SHELL_CACHE_PREFIX = 'inkbound-shell-';")
      && serviceWorker.includes('key.startsWith(SHELL_CACHE_PREFIX)')
      && serviceWorker.includes('caches.delete(key)'),
    message: 'sw.js must retire legacy Inkbound shell caches so returning readers cannot be trapped on stale builds',
  },
  {
    ok: serviceWorker.includes('self.skipWaiting()')
      && serviceWorker.includes('self.clients.claim()')
      && serviceWorker.includes('self.registration.unregister()'),
    message: 'sw.js must activate immediately, claim existing tabs, and retire itself after stale caches are cleared',
  },
  {
    ok: serviceWorker.includes('event.respondWith(fetch(request))')
      && !serviceWorker.includes('caches.match(request)'),
    message: 'sw.js must remain network-only while the retirement worker is controlling a tab',
  },
  {
    ok: robots.includes('Disallow: /app'),
    message: 'robots.txt must keep the private application surface out of search results',
  },
  {
    ok: firebaseBootstrap.includes('initializeAppCheck(')
      && firebaseBootstrap.includes('ReCaptchaEnterpriseProvider'),
    message: 'src/lib/firebase.ts must remain the production App Check initializer',
  },
];

const sourceFilesWithAppCheckInitialization = [];
const sourceRoot = path.join(root, 'src');
const normalizeRelativePath = (value) => value.split(path.sep).join('/');
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
      sourceFilesWithAppCheckInitialization.push(normalizeRelativePath(path.relative(root, fullPath)));
    }
  });
};
visitSource(sourceRoot);

checks.push({
  ok: sourceFilesWithAppCheckInitialization.length === 1
    && sourceFilesWithAppCheckInitialization[0] === 'src/lib/firebase.ts',
  message: `Firebase App Check must have one source of truth in src/lib/firebase.ts (found: ${sourceFilesWithAppCheckInitialization.join(', ') || 'none'})`,
});

// Release firewall: diagnostic UI must be explicitly gated by Vite's DEV flag.
// This runs on every verified web release, regardless of the source branch.
const addBookSource = fs.readFileSync(path.join(root, 'src', 'components', 'AddBookModal.tsx'), 'utf8');
checks.push({
  ok: addBookSource.includes('import.meta.env.DEV && authorCatalogDiagnostics && (')
    && addBookSource.includes('import.meta.env.DEV && scannerDetails && <details'),
  message: 'scanner and catalog diagnostic panels must be dev-only',
});
checks.push({
  ok: !builtJavaScript.includes('retrieval responses omitted')
    && !builtJavaScript.includes('ranked-identity:')
    && !builtJavaScript.includes('federated-author-identity:'),
  message: 'production bundle must not include scanner retrieval-trace markers',
});

const failures = checks.filter((check) => !check.ok).map((check) => check.message);
if (failures.length > 0) {
  console.error('Inkbound release artifact verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Inkbound release artifacts verified.');
