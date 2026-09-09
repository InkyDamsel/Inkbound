import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function rel(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

const errors = [];
const warnings = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };

const sourceFiles = walk(srcRoot).filter((file) => /\.(?:ts|tsx|css)$/.test(file));
const sharedUiFiles = sourceFiles.filter((file) => {
  const relative = rel(file);
  return relative === 'src/App.tsx'
    || relative.startsWith('src/components/')
    || relative.startsWith('src/layout/');
});

// Web and Android intentionally mount the exact same React application. A
// user-facing component may request a capability through a platform adapter,
// but it must not decide to remove a feature because the runtime is Android.
for (const file of sharedUiFiles.filter((candidate) => /\.(?:ts|tsx)$/.test(candidate))) {
  const relative = rel(file);
  const contents = fs.readFileSync(file, 'utf8');

  if (/from\s+['"][^'"]*platform\/runtimePlatform['"]/.test(contents)) {
    errors.push(`${relative} imports runtimePlatform directly. Shared UI must not branch on web versus Android; use a capability adapter instead.`);
  }
  if (/from\s+['"]@capacitor\//.test(contents)) {
    errors.push(`${relative} imports a Capacitor plugin directly. Native capabilities belong behind src/platform adapters so the same feature surface stays mounted on web and Android.`);
  }
  if (/from\s+['"]firebase\/firestore['"]/.test(contents)) {
    errors.push(`${relative} reads Firestore directly. User-facing UI must consume canonical Inkbound state rather than creating a second cloud-backed source of truth.`);
  }
}

const main = read('src/main.tsx');
assert(main.includes('<App />'), 'src/main.tsx must mount the shared <App /> for the signed-in application.');
assert(!/isAndroidRuntime\([^)]*\)[\s\S]{0,160}<[^>]*App/.test(main), 'src/main.tsx must not select a different application tree for Android.');

const navbar = read('src/components/Navbar.tsx');
const app = read('src/App.tsx');
assert(navbar.includes('mobileNavigationGroups = visibleNavigationGroups'), 'Mobile navigation must be derived from the same visibleNavigationGroups used by desktop.');
assert(navbar.includes('mobilePrimaryItems = [homeItem, ...navigationGroups[0].items.slice(0, 2)]'), 'Mobile primary navigation must be derived from the canonical navigation groups.');

// Every canonical navigation destination must be handled by the shared App.
const navIds = new Set([...navbar.matchAll(/\{\s*id:\s*'([a-z-]+)'\s*,\s*label:/g)].map((match) => match[1]));
const redirectedNavIds = new Set(['import-history']);
for (const id of navIds) {
  if (redirectedNavIds.has(id)) continue;
  const routePattern = new RegExp(`activeTab\\s*===\\s*['"]${id}['"]`);
  if (!routePattern.test(app)) errors.push(`Navigation destination "${id}" is declared but has no shared App route.`);
}

// A responsive stylesheet may compact top-bar chrome, but it must never hide
// a reusable action class globally. That previously made Edit/Delete disappear
// from Android/landscape dialogs while the same controls remained on web.
for (const file of sourceFiles.filter((candidate) => candidate.endsWith('.css'))) {
  const relative = rel(file);
  const contents = fs.readFileSync(file, 'utf8');
  const rules = contents.matchAll(/([^{}]+)\{([^{}]*display\s*:\s*none[^{}]*)\}/g);
  for (const match of rules) {
    const selector = match[1];
    if (selector.includes('.quiet-shelf-secondary-action') && !selector.includes('.quiet-shelf-topbar')) {
      errors.push(`${relative} hides .quiet-shelf-secondary-action outside the top bar. Shared feature actions must remain reachable on Android.`);
    }
    if (selector.includes('.quiet-shelf-primary-action') && !selector.includes('.quiet-shelf-topbar') && !selector.includes('span')) {
      errors.push(`${relative} hides .quiet-shelf-primary-action outside the top bar. Shared feature actions must remain reachable on Android.`);
    }
  }
}

const androidRuntime = read('src/platform/initializeAndroidRuntime.ts');
for (const capability of [
  'configureRuntimeAuthentication',
  'configureRuntimeExport',
  'configureRuntimeLifecycle',
  'configureRuntimeReauthentication',
  'configureRuntimePremiumPurchase',
  'configureRuntimeSubscriptionManagement',
  'initializeNativeSecurityRuntime',
]) {
  assert(androidRuntime.includes(capability), `Android runtime is missing ${capability}; the corresponding shared web capability would not have a native implementation.`);
}

const premiumRuntime = read('src/platform/runtimePremiumPurchase.ts');
assert(premiumRuntime.includes('createStripeCheckoutSession'), 'Web Premium purchase adapter must route subscription checkout through the secure Stripe callable.');
assert(androidRuntime.includes('verifyGooglePlaySubscription'), 'Android Premium purchases must be server-verified before entitlement is granted.');
assert(androidRuntime.includes('PlayBilling.acknowledge'), 'Android Premium purchases must be acknowledged after secure verification.');

const subscriptionRuntime = read('src/platform/runtimeSubscriptionManagement.ts');
assert(subscriptionRuntime.includes('createStripeBillingPortalSession'), 'Web subscription management must use a server-created Stripe Billing Portal session.');
assert(androidRuntime.includes('PlayBilling.manage'), 'Android subscription management must stay inside Google Play.');

const bookDetailsCore = read('src/components/BookDetailsModalCore.tsx');
assert(bookDetailsCore.includes('onUpdateSession'), 'Book Details must expose reading-session editing on every viewport.');
assert(bookDetailsCore.includes('onDeleteSession'), 'Book Details must expose reading-session deletion on every viewport.');

const batchEdit = read('src/components/BatchEditModal.tsx');
assert(batchEdit.includes('readCustomOwnershipCategories'), 'Batch Edit must load the same custom ownership categories available in single-book editing.');
assert(batchEdit.includes('Custom categories'), 'Batch Edit must expose custom ownership categories in its shared UI.');

const recoveryPanel = read('src/components/admin/AdminDataSafetyPanel.tsx');
assert(recoveryPanel.includes('AdminSelectiveRecoveryPanel'), 'Administration must expose selective recovery rather than forcing whole-account rollback.');

// Keep a visible inventory of persistence boundaries. These are warnings here,
// not duplicate data stores by themselves. Source-of-truth verification owns
// the stricter canonical-storage rules.
for (const file of sharedUiFiles.filter((candidate) => /\.(?:ts|tsx)$/.test(candidate))) {
  const contents = fs.readFileSync(file, 'utf8');
  if (/\blocalStorage\./.test(contents)) warnings.push(`${rel(file)} accesses browser storage directly; prefer runtimeStorage/usePersistentState when that code is next touched.`);
}

if (errors.length > 0) {
  console.error('\nInkbound cross-platform parity verification FAILED:\n');
  errors.forEach((error) => console.error(`- ${error}`));
  if (warnings.length) {
    console.error('\nAudit notes:\n');
    warnings.forEach((warning) => console.error(`- ${warning}`));
  }
  process.exit(1);
}

console.log('Inkbound web/Android feature-parity verification passed.');
if (warnings.length) {
  console.log('\nNon-blocking storage-boundary notes:');
  warnings.forEach((warning) => console.log(`- ${warning}`));
}
