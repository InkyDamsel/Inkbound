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

// The public website is intentionally code-split from the signed-in app so the
// marketing surface does not download Firebase/persistence code. Web /app and
// Android must still enter the exact same applicationEntry tree.
const main = read('src/main.tsx');
const applicationEntry = read('src/applicationEntry.tsx');
assert(
  main.includes("import('./applicationEntry.tsx')"),
  'src/main.tsx must lazy-load the shared signed-in application entry.',
);
assert(
  main.includes("import('./publicEntry.tsx')") && main.includes("normalizedPath === '/'") && main.includes("normalizedPath === '/faq'"),
  'src/main.tsx may bypass the application tree only for the public marketing and FAQ routes.',
);
assert(
  main.includes('const publicSurface = !isNativeRuntime()'),
  'src/main.tsx must never route the native Android runtime through the public website entry.',
);
assert(
  applicationEntry.includes("import App from './App.tsx'") && applicationEntry.includes('<App />'),
  'src/applicationEntry.tsx must mount the shared <App /> for the signed-in application.',
);
assert(
  applicationEntry.includes('<InkboundApplication />'),
  'src/applicationEntry.tsx must mount the same InkboundApplication tree for web and Android.',
);

const navbar = read('src/components/Navbar.tsx');
const app = read('src/App.tsx');
assert(navbar.includes('mobileNavigationGroups = visibleNavigationGroups'), 'Mobile navigation must be derived from the same visibleNavigationGroups used by desktop.');
assert(navbar.includes('mobilePrimaryItems = [homeItem, ...navigationGroups[0].items.slice(0, 2)]'), 'Mobile primary navigation must be derived from the canonical navigation groups.');
assert(
  navbar.includes("Switch to Light Mode") && navbar.includes("Switch to Dark Mode"),
  'Compact/mobile navigation must expose the same light/dark theme control available in the desktop top bar.',
);
assert(
  !navbar.includes("{ id: 'collections', label: 'Collections'"),
  'Collections belongs inside My Library and must not drift into a separate web/Android navigation destination.',
);

// Every canonical navigation item must be handled by the shared App. Parse only
// item arrays so group IDs such as "reading" and "journal" are not mistaken for
// navigable destinations merely because they also have labels.
const navIds = new Set();
for (const itemsMatch of navbar.matchAll(/items:\s*\[([\s\S]*?)\]\s*}/g)) {
  const itemsBlock = itemsMatch[1];
  for (const itemMatch of itemsBlock.matchAll(/\{\s*id:\s*'([a-z-]+)'\s*,\s*label:/g)) {
    navIds.add(itemMatch[1]);
  }
}
navIds.add('home');
const redirectedNavIds = new Set(['import-history', 'help']);
for (const id of navIds) {
  if (redirectedNavIds.has(id)) continue;
  const routePattern = new RegExp(`activeTab\\s*===\\s*['"]${id}['"]`);
  if (!routePattern.test(app)) errors.push(`Navigation destination "${id}" is declared but has no shared App route.`);
}

// Responsive styles may compact top-bar chrome. Shared feature actions in the
// page canvas must still win the cascade at every compact viewport. App-only
// CSS now lives in applicationEntry so the public website stays lightweight.
const responsiveParity = read('src/styles/responsive-parity.css');
const parityImportedAfterAppShell = applicationEntry.indexOf("./styles/responsive-parity.css") > applicationEntry.indexOf("./styles/app-shell.css");
const hasCompactActionOverride = /@media\s*\(max-width:\s*1199px\)[\s\S]*?\.inkbound-main-content\s+\.quiet-shelf-primary-action,[\s\S]*?\.inkbound-main-content\s+\.quiet-shelf-secondary-action\s*\{[\s\S]*?display\s*:\s*inline-flex\s*!important/.test(responsiveParity);
assert(parityImportedAfterAppShell, 'responsive-parity.css must load after app-shell.css so shared feature-action visibility wins the compact cascade.');
assert(hasCompactActionOverride, 'responsive-parity.css must force shared primary/secondary feature actions visible through tablet and phone widths.');
const bookDetailsResponsive = read('src/components/bookDetailsResponsive.css');
assert(
  bookDetailsResponsive.includes('--book-details-safe-top: max(env(safe-area-inset-top), 24px)'),
  'Book Details mobile layout must keep a minimum Android status-bar safe inset even when WebView reports zero.',
);
assert(
  bookDetailsResponsive.includes("button[aria-label='Close book details']") &&
  bookDetailsResponsive.includes('top: calc(var(--book-details-safe-top) + 0.75rem) !important'),
  'Book Details close control must be anchored below the canonical mobile safe-top inset.',
);

for (const file of sourceFiles.filter((candidate) => candidate.endsWith('.css'))) {
  const relative = rel(file);
  const contents = fs.readFileSync(file, 'utf8');
  const rules = contents.matchAll(/([^{}]+)\{([^{}]*display\s*:\s*none[^{}]*)\}/g);
  for (const match of rules) {
    const selector = match[1];
    if (selector.includes('.quiet-shelf-secondary-action') && !selector.includes('.quiet-shelf-topbar')) {
      errors.push(`${relative} hides .quiet-shelf-secondary-action outside the top bar. Shared feature actions must remain reachable on Android.`);
    }
    if (selector.includes('.quiet-shelf-primary-action') && !selector.includes('.quiet-shelf-topbar')) {
      errors.push(`${relative} hides .quiet-shelf-primary-action or its label outside the top bar. Shared feature actions and labels must remain reachable on Android.`);
    }
  }
}

// Light mode is a release surface, not a best-effort skin. Dark-only shared
// form rules must be scoped to .dark, and the final light-theme layer must
// contain explicit contrast guardrails for legacy hard-coded utilities.
const corePagesCss = read('src/styles/core-pages.css');
const lightThemeCss = read('src/styles/light-theme-2.css');
assert(
  !/(^|\n)main input\[type='search'\],[\s\S]*?background-color:\s*rgba\(13,\s*9,\s*16/.test(corePagesCss),
  'core-pages.css must not apply dark form surfaces to light mode; scope dark form rules under :root.dark.',
);
for (const requiredLightGuard of [
  "html:not(.dark) main .inkbound-kicker",
  "html:not(.dark) main [class*='text-[#f4efe6]']",
  "html:not(.dark) main .text-stone-400",
  "html:not(.dark) main header[class*='overflow-hidden'] [class*='text-white']",
  "html:not(.dark) main .inkbound-artwork-hero",
  "html:not(.dark) main .inkbound-artwork-hero [class*='bg-black']",
]) {
  assert(lightThemeCss.includes(requiredLightGuard), `Light Theme 2.0 is missing contrast guardrail: ${requiredLightGuard}`);
}

const studioScreen = read('src/components/InkboundStudioScreen.tsx');
assert(studioScreen.includes('inkbound-studio-theme-swatch'), 'Studio theme swatches must be explicitly protected from app light-mode remapping.');
assert(studioScreen.includes('inkbound-studio-preview') && studioScreen.includes('inkbound-studio-preview-panel'), 'Studio share-card preview must remain theme-authentic in app light mode.');
assert(lightThemeCss.includes('html:not(.dark) main .inkbound-studio-theme-swatch'), 'Light theme must preserve Studio theme swatch backgrounds.');
assert(lightThemeCss.includes('html:not(.dark) main .inkbound-studio-preview-panel'), 'Light theme must preserve Studio preview contrast.');
for (const themedPreviewFile of [
  'src/components/MonthlyWrappedScreen.tsx',
  'src/components/YearInBooksScreen.tsx',
  'src/components/BookshelfThroughTimeScreen.tsx',
]) {
  const themedPreviewSource = read(themedPreviewFile);
  assert(
    themedPreviewSource.includes('inkbound-themed-preview'),
    `${themedPreviewFile} must mark its authored preview/scene so app light mode cannot recolor it.`,
  );
}
assert(lightThemeCss.includes('html:not(.dark) main button.inkbound-themed-preview-swatch'), 'Light theme must preserve authored recap theme swatches even when the selected-state rule also matches.');
assert(lightThemeCss.includes("color: var(--preview-theme-text) !important"), 'Authored recap previews must retain their selected theme text color in app light mode.');
assert(lightThemeCss.includes("html:not(.dark) main .inkbound-themed-preview [class*='text-white']"), 'Light theme must preserve white text inside authored recap/shelf previews.');
const statisticsScreen = read('src/components/StatisticsScreen.tsx');
assert(statisticsScreen.includes('inkbound-light-warning-chip'), 'Statistics review warning must use the shared light-mode warning contrast treatment.');

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

const libraryScreen = read('src/components/LibraryScreen.tsx');
assert(
  libraryScreen.includes("['books', 'series', 'collections', 'loans']") && libraryScreen.includes("section === 'collections'") && libraryScreen.includes('<CollectionsScreen'),
  'Collections must remain reachable through the canonical My Library Books/Series/Collections/Loans tabs on both web and Android.',
);

const collectionsScreen = read('src/components/CollectionsScreen.tsx');
for (const artworkHeroFile of [
  'src/components/LibraryScreen.tsx',
  'src/components/ReadingMemoriesScreen.tsx',
  'src/components/PhotoMemoriesScreen.tsx',
  'src/components/ReadingTimeCapsulesScreen.tsx',
  'src/components/MyDragonScreen.tsx',
]) {
  assert(read(artworkHeroFile).includes('inkbound-artwork-hero'), `${artworkHeroFile} must mark its artwork banner so light mode cannot replace it with a parchment surface.`);
}
assert(collectionsScreen.includes("import { PaginationControls } from './PaginationControls'"), 'Collections must use shared pagination on web and Android.');
assert(collectionsScreen.includes('const COLLECTION_SHELF_PAGE_SIZE = 24'), 'Open Collection must expose collection books in the same 24-item pages used by the live web experience.');
assert(collectionsScreen.includes('totalItems={selectedBooks.length}'), 'Open Collection pagination must use the complete canonical collection membership.');
assert(collectionsScreen.includes('const COLLECTION_MANAGER_PAGE_SIZE = 24'), 'Manage Books must use 24-item pages so large libraries remain usable on Android.');
assert(collectionsScreen.includes('paginatedVisibleBooks.map'), 'Manage Books must render the paginated library slice rather than the entire library at once.');
assert(collectionsScreen.includes('totalItems={visibleBooks.length}'), 'Manage Books pagination must be based on the full filtered library result set.');
assert(!/selectedBooks\.slice\(0,\s*\d+\)/.test(collectionsScreen), 'Collections must not hide books behind a fixed preview-only slice.');

const readingSessionsScreen = read('src/components/ReadingSessionsScreen.tsx');
const sessionEditor = read('src/components/SessionEditorModal.tsx');
const bulkHistoricalSessions = read('src/components/BulkHistoricalSessionsModal.tsx');
assert(readingSessionsScreen.includes('Add Past Session'), 'Reading Sessions must expose historical single-session entry on web and Android.');
assert(readingSessionsScreen.includes('Add Multiple'), 'Reading Sessions must expose bulk historical-session entry on web and Android.');
assert(sessionEditor.includes('date > localDateKey()'), 'Historical session entry must reject future dates.');
assert(sessionEditor.includes('parsedEndProgress < parsedStartProgress'), 'Historical session entry must keep canonical progress endpoints ordered.');
assert(bulkHistoricalSessions.includes('const nextSessions: ReadingSession[] = []'), 'Bulk historical entry must create canonical ReadingSession records.');
assert(bulkHistoricalSessions.includes('pagesRead: isAudiobook ? undefined : Math.max(0, endProgress - startProgress)'), 'Bulk historical page totals must derive from start/end endpoints.');
assert(bulkHistoricalSessions.includes('minutesListened: isAudiobook ? Math.max(0, endProgress - startProgress) : undefined'), 'Bulk historical audiobook totals must derive from timestamp endpoints.');

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
