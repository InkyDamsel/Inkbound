import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const violations = [];

const retiredCollectionKeys = [
  'inkbound_library_custom_lists',
  'inkbound_library_custom_list_members',
];

const canonicalRegisteredKeyLiterals = new Map([
  ['inkbound_reader_profile', 'SYNC_STORAGE_KEYS.profile'],
  ['inkbound_annual_goal', 'ACCOUNT_DATA_STORAGE_KEYS.annualReadingGoal'],
  ['inkbound_daily_goal_minutes', 'ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalMinutes'],
]);

const sourceFiles = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) sourceFiles.push(absolute);
  }
};
walk(path.join(root, 'src'));

for (const file of sourceFiles) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (relative === 'src/features/sync/storageKeys.ts') continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const key of retiredCollectionKeys) {
    if (source.includes(key)) violations.push(`${relative}: references retired collection store ${key}`);
  }
  for (const [literal, owner] of canonicalRegisteredKeyLiterals) {
    if (source.includes(`'${literal}'`) || source.includes(`"${literal}"`)) {
      violations.push(`${relative}: redefines registered storage key ${literal}; use ${owner}`);
    }
  }
}

const cloudRefreshBoundarySource = read('src/features/sync/CloudDataRefreshBoundary.tsx');
if (cloudRefreshBoundarySource.includes('recoverIncompleteLatestImport')) {
  violations.push('CloudDataRefreshBoundary.tsx: import history is operational metadata and must never auto-recreate canonical library books');
}

const startDev = read('scripts/start-dev.mjs');
const packageJson = JSON.parse(read('package.json'));
if (packageJson.scripts?.dev !== 'node scripts/start-dev.mjs') {
  violations.push('package.json: npm run dev must use the app-parity DEV launcher');
}
if (packageJson.scripts?.['dev:emulator'] !== 'node scripts/start-dev.mjs --emulator') {
  violations.push('package.json: npm run dev:emulator must remain the isolated Firebase emulator path');
}
for (const required of [
  "const requestedMode = process.argv.includes('--emulator') ? 'emulator' : 'production'",
  "VITE_RUNTIME_TARGET: 'web'",
  "VITE_FIREBASE_MODE: requestedMode",
  "VITE_PREMIUM_SUBSCRIPTIONS_OPEN: 'false'",
]) {
  if (!startDev.includes(required)) {
    violations.push(`start-dev.mjs: DEV parity/safety contract is missing (${required})`);
  }
}

const runtimePlatformSource = read('src/platform/runtimePlatform.ts');
if (!runtimePlatformSource.includes("if (import.meta.env.DEV) return false;")) {
  violations.push('runtimePlatform.ts: Vite DEV must always resolve as a web runtime');
}
if (!runtimePlatformSource.includes("if (import.meta.env.DEV) return 'web';")) {
  violations.push('runtimePlatform.ts: getRuntimePlatform must keep Vite DEV on web');
}

const googleBooksSource = read('src/features/book-search/data/googleBooksApi.ts');
const googleSeriesResolverSource = read('src/features/book-search/mapping/googleSeriesMetadata.ts');
const bookDetailsCoreSource = read('src/components/BookDetailsModalCore.tsx');
if (!googleBooksSource.includes("resolveGoogleSeriesMetadata")) {
  violations.push('googleBooksApi.ts: Google Books series metadata must use the canonical resolver');
}
if (/seriesName\s*:\s*[^\n]*shortSeriesBookTitle/.test(googleBooksSource)) {
  violations.push('googleBooksApi.ts: shortSeriesBookTitle is a book title, not a canonical series name');
}
for (const required of ['seriesId', 'orderNumber', 'seriesTitlesById']) {
  if (!googleSeriesResolverSource.includes(required)) {
    violations.push(`googleSeriesMetadata.ts: missing canonical Google series field ${required}`);
  }
}
if (!bookDetailsCoreSource.includes('seriesName: book.work.seriesName || matchedEdition.seriesName')) {
  violations.push('BookDetailsModalCore.tsx: metadata sync must repair missing canonical series metadata');
}
if (!bookDetailsCoreSource.includes('matchedEdition.pageCount ?? activeEdition.pageCount')) {
  violations.push('BookDetailsModalCore.tsx: exact-ISBN metadata sync must be able to repair stale provider page counts');
}

const helpContent = read('src/content/helpContent.ts');
const navbarSource = read('src/components/Navbar.tsx');
for (const required of [
  "id: 'start-here'",
  "id: 'add-books'",
  "id: 'change-cover'",
  "id: 'tags'",
  "id: 'organize-series'",
  "id: 'add-multiple'",
  "id: 'import-goodreads'",
  "id: 'library-limit'",
  "id: 'free-vs-premium'",
  "id: 'status-vs-ownership'",
]) {
  if (!helpContent.includes(required)) violations.push(`helpContent.ts: canonical new-reader help is missing (${required})`);
}
if (!navbarSource.includes("label: 'Help & Guides'") || !navbarSource.includes("href: '/faq'")) {
  violations.push('Navbar.tsx: Account must expose the canonical /faq Help & Guides destination');
}
if (!navbarSource.includes('aria-label="Help & Guides"')) {
  violations.push('Navbar.tsx: the top Help shortcut must route to the canonical Help & Guides destination');
}

const crossDeviceSync = read('src/features/sync/CrossDeviceDeltaSyncBridge.tsx');
const firstHydrationSync = read('src/features/sync/OneShotCloudHydrationBridge.tsx');
const oneShotHydration = read('src/features/sync/OneShotCloudHydrationBridge.tsx');
const auxiliarySyncBridge = read('src/features/sync/AuxiliaryAccountSyncBridge.tsx');
const persistentStateHook = read('src/hooks/usePersistentState.ts');
const libraryNormalization = read('src/features/library/libraryNormalization.ts');
const ownershipControl = read('src/components/ownership/CustomOwnershipBookControl.tsx');
const ownershipTransition = read('src/features/ownership/bookOwnership.ts');
if (/ownership\s*!==\s*['"]borrowed-library['"][\s\S]{0,160}libraryLoan:\s*undefined/.test(libraryNormalization)) {
  violations.push('libraryNormalization.ts: Passive normalization must never clear libraryLoan; only explicit ownership transitions may erase loan data.');
}
if (!ownershipControl.includes('withBookOwnership')) {
  violations.push('CustomOwnershipBookControl.tsx: ownership changes must use the canonical loan-safe withBookOwnership boundary.');
}
if (!ownershipTransition.includes("libraryLoan: ownership === 'borrowed-library' ? book.libraryLoan : undefined")) {
  violations.push('bookOwnership.ts: explicit ownership transitions must own library-loan clearing.');
}
if (!crossDeviceSync.includes('mergeIncomingBookLoanState') || !firstHydrationSync.includes('mergeIncomingBookLoanState')) {
  violations.push('sync: canonical book hydration/delta paths must use the loan-safe cross-device merge.');
}
if (!oneShotHydration.includes('fullReconciliationVersionKey(uid)') || !oneShotHydration.includes('FULL_RECONCILIATION_VERSION')) {
  violations.push('OneShotCloudHydrationBridge.tsx: established local caches must prove the current full reconciliation version before bypassing cloud hydration.');
}
if (!crossDeviceSync.includes('fullReconciliationVersionKey(uid)') || !crossDeviceSync.includes('FULL_RECONCILIATION_VERSION')) {
  violations.push('CrossDeviceDeltaSyncBridge.tsx: delta sync must wait for the current full reconciliation version before declaring core sync reconciled.');
}
if (!auxiliarySyncBridge.includes('legacyCloudDocNameById') || !auxiliarySyncBridge.includes('legacyOnlyCloudNames')) {
  violations.push('AuxiliaryAccountSyncBridge.tsx: legacy account-owned Firestore docs must remain readable and copy-forward into canonical auxiliary ids.');
}
if (/useEffect\([\s\S]{0,260}writeRuntimeJson\(key,\s*value\)/.test(persistentStateHook)) {
  violations.push('usePersistentState.ts: fallback state must not be persisted on mount; only explicit mutations may become account sync writes.');
}

const app = read('src/App.tsx');
for (const required of [
  'withReadingStatus',
  'getActiveEdition',
  'applySessionProgressToBook',
  'reconcileBookAfterSessionMutation',
  'getSessionProgressEndpoint',
  'SYNC_STORAGE_KEYS',
  'LEGACY_SYNC_STORAGE_KEYS',
  'ACCOUNT_DATA_STORAGE_KEYS',
  'subscribeToRuntimeResume',
  'writeRuntimeJson',
]) {
  if (!app.includes(required)) violations.push(`App.tsx: missing canonical ${required} consumer`);
}
if (/function\s+applyReadingStatus\s*\(/.test(app)) {
  violations.push('App.tsx: must not maintain a second reading-status transition implementation');
}
if (/function\s+sessionSortKey\s*\(|function\s+sessionProgress\s*\(/.test(app)) {
  violations.push('App.tsx: session progress/sort rules must come from sessionBookReconciliation.ts');
}
if (/shouldUnfinishTrackedCompletion/.test(app)) {
  violations.push('App.tsx: session edits/deletes must not silently unfinish an explicit Finished status');
}
for (const literal of ["const BOOKS_STORAGE_KEY = 'inkbound_books'", "const SESSIONS_STORAGE_KEY = 'inkbound_sessions'", "const THEME_STORAGE_KEY = 'inkbound_theme'"]) {
  if (app.includes(literal)) violations.push(`App.tsx: canonical storage key was redefined (${literal})`);
}
if (/\blocalStorage\./.test(app)) {
  violations.push('App.tsx: canonical app persistence must go through runtimeStorage so Android and web emit the same sync events');
}
if (!app.includes('writeRuntimeJson(BOOKS_STORAGE_KEY, books)') || !app.includes('writeRuntimeJson(SESSIONS_STORAGE_KEY, sessions)')) {
  violations.push('App.tsx: canonical books/sessions persistence must use writeRuntimeJson');
}
if (/safeWriteLocalStorage/.test(app)) {
  violations.push('App.tsx: direct browser persistence helper must not bypass runtimeStorage');
}
if (!app.includes('onUpdateSession={handleUpdateSession}') || !app.includes('onDeleteSession={handleDeleteSession}')) {
  violations.push('App.tsx: Book Details session edits/deletes must flow through the canonical App session mutation path');
}

const bookReadingState = read('src/features/reading/bookReadingState.ts');
for (const required of [
  'getActiveEdition',
  'getBookReadingState',
  'getCanonicalProgressPercentage',
  'getAverageBookProgress',
  'reconcileFinishedBookProgress',
  'withReadingStatus',
]) {
  if (!bookReadingState.includes(`export function ${required}`)) {
    violations.push(`bookReadingState.ts: missing canonical ${required}`);
  }
}

const sessionBookReconciliation = read('src/features/reading/sessionBookReconciliation.ts');
for (const required of ['applySessionProgressToBook', 'reconcileBookAfterSessionMutation', 'getSessionProgressEndpoint', 'sessionSortKey']) {
  if (!sessionBookReconciliation.includes(`export function ${required}`)) {
    violations.push(`sessionBookReconciliation.ts: missing canonical ${required}`);
  }
}

const canonicalInputSource = read('src/components/form/CanonicalInput.tsx');
if (!canonicalInputSource.includes('CanonicalNumberInput')) {
  violations.push('CanonicalInput.tsx: canonical numeric draft/commit editor is missing');
}
if (!canonicalInputSource.includes('CanonicalTextarea')) {
  violations.push('CanonicalInput.tsx: canonical multiline text editor is missing');
}

const readingSessionsScreen = read('src/components/ReadingSessionsScreen.tsx');
const sessionEditor = read('src/components/SessionEditorModal.tsx');
const bulkHistoricalSessions = read('src/components/BulkHistoricalSessionsModal.tsx');
const readingSessionModal = read('src/components/ReadingSessionModal.tsx');
for (const [relative, source] of [
  ['src/components/ReadingSessionModal.tsx', readingSessionModal],
  ['src/components/SessionEditorModal.tsx', sessionEditor],
  ['src/components/BulkHistoricalSessionsModal.tsx', bulkHistoricalSessions],
]) {
  if (!source.includes('CanonicalNumberInput')) {
    violations.push(`${relative}: editable reading progress must use CanonicalNumberInput`);
  }
  if (/CanonicalInput[^>]*type=["']number["']/.test(source)) {
    violations.push(`${relative}: editable reading progress must not bypass CanonicalNumberInput with a raw numeric CanonicalInput`);
  }
}
if (/<input[^>]*type=["']number["'][^>]*(?!readOnly)[^>]*onChange=/.test(readingSessionModal)) {
  violations.push('ReadingSessionModal.tsx: editable numeric progress must not use a raw number input');
}
const appSource = read('src/App.tsx');
for (const required of ['commitCanonicalBooks', 'replaceCanonicalLibrary', 'commitCanonicalSessions', 'replaceCanonicalSessions']) {
  if (!appSource.includes(required)) {
    violations.push(`App.tsx: reader mutations must persist through the canonical mutation boundary (${required})`);
  }
}
const directBookStateWrites = (appSource.match(/\bsetBooks\(/g) ?? []).length;
const directSessionStateWrites = (appSource.match(/\bsetSessions\(/g) ?? []).length;
if (directBookStateWrites > 2) {
  violations.push('App.tsx: feature handlers must not bypass commitCanonicalBooks; only cloud hydration and the canonical helper may call setBooks');
}
if (directSessionStateWrites > 2) {
  violations.push('App.tsx: feature handlers must not bypass commitCanonicalSessions; only cloud hydration and the canonical helper may call setSessions');
}


for (const required of ['Add Past Session', 'Add Multiple', 'SessionEditorModal', 'BulkHistoricalSessionsModal']) {
  if (!readingSessionsScreen.includes(required)) {
    violations.push(`ReadingSessionsScreen.tsx: manual session entry is a Build 28 capability and must remain visible (${required})`);
  }
}
for (const relativeSource of [sessionEditor, bulkHistoricalSessions, readingSessionsScreen]) {
  if (!relativeSource.includes('CanonicalInput')) {
    violations.push('Manual session and reading-journal editable fields must consume CanonicalInput');
  }
}
for (const required of ['onSaveManualSession={handleSaveManualSession}', 'onSaveManualSessions={handleSaveManualSessions}']) {
  if (!appSource.includes(required)) {
    violations.push(`App.tsx: manual session persistence wiring missing (${required})`);
  }
}

const bookDetailsCore = read('src/components/BookDetailsModalCore.tsx');
for (const required of ['withReadingStatus', 'getActiveEdition', 'SYNC_STORAGE_KEYS', 'localDateKey']) {
  if (!bookDetailsCore.includes(required)) violations.push(`BookDetailsModalCore.tsx: missing canonical ${required} consumer`);
}
if (!bookDetailsCore.includes('CanonicalNumberInput')) {
  violations.push('BookDetailsModalCore.tsx: editable numeric progress/edition fields must use the canonical numeric input boundary');
}
if (!bookDetailsCore.includes('getEffectiveBookProgressPages')) {
  violations.push('BookDetailsModalCore.tsx: finished books with trustworthy page totals must use canonical effective page progress');
}
if (!bookDetailsCore.includes('CanonicalTextarea')) {
  violations.push('BookDetailsModalCore.tsx: multiline reader text must use the canonical textarea boundary');
}
if (!bookDetailsCore.includes('isValidCatalogIsbn10') || !bookDetailsCore.includes('isValidCatalogIsbn13')) {
  violations.push('BookDetailsModalCore.tsx: metadata refresh must prefer canonical exact-ISBN edition identity when available');
}

for (const required of ['READING_STATUS_OPTIONS', 'OWNERSHIP_OPTIONS', 'PRIORITY_OPTIONS', 'FORMAT_OPTIONS']) {
  if (!bookDetailsCore.includes(required)) {
    violations.push(`BookDetailsModalCore.tsx: library selector options must consume canonical libraryTaxonomy ${required}`);
  }
}
if (/const\s+localDateKey\s*=/.test(bookDetailsCore)) {
  violations.push('BookDetailsModalCore.tsx: must use the canonical reading date helper');
}
if (bookDetailsCore.includes("const ENRICHMENT_QUEUE_KEY = 'inkbound_import_enrichment_queue_v3'")) {
  violations.push('BookDetailsModalCore.tsx: import-enrichment storage key must come from SYNC_STORAGE_KEYS');
}

const bookDetailsWrapper = read('src/components/BookDetailsModal.tsx');
for (const forbidden of ['writeRuntimeJson', 'notifyRuntimeStorageChanged', 'notifyCloudDataUpdated', 'fallbackUpdateSession', 'fallbackDeleteSession']) {
  if (bookDetailsWrapper.includes(forbidden)) violations.push(`BookDetailsModal.tsx: session mutation must stay App-owned; found ${forbidden}`);
}
if (!bookDetailsWrapper.includes('normalizeLibraryRecord')) {
  violations.push('BookDetailsModal.tsx: ownership cleanup must use canonical normalizeLibraryRecord');
}
if (/ownership\s*===\s*['"]wishlist['"][\s\S]{0,180}status\s*:\s*['"]wishlist['"]/.test(bookDetailsWrapper)) {
  violations.push('BookDetailsModal.tsx: Wishlist ownership must not rewrite reading status/history');
}

const catalogHardening = read('src/features/book-search/catalogHardening.ts');
for (const required of [
  'hardenCatalogEdition',
  'hardenCatalogGroups',
  'hardenCatalogResponse',
  'isValidCatalogIsbn10',
  'isValidCatalogIsbn13',
  'catalogEditionQualityScore',
  'inferCatalogAuthorIntent',
]) {
  if (!catalogHardening.includes(`export const ${required}`)) {
    violations.push(`catalogHardening.ts: missing canonical ${required}`);
  }
}
for (const providerFile of [
  'src/features/book-search/data/googleBooksApi.ts',
  'src/features/book-search/data/openLibraryApi.ts',
  'src/features/book-search/data/hardcoverApi.ts',
  'src/features/catalog/metadataContributions.ts',
]) {
  if (!read(providerFile).includes('catalogHardening')) {
    violations.push(`${providerFile}: catalog data must pass through the canonical catalogHardening boundary`);
  }
}
const googleBooksApi = read('src/features/book-search/data/googleBooksApi.ts');
if (!googleBooksApi.includes('mergeCatalogEditionData(current, edition)')) {
  violations.push('googleBooksApi.ts: paged catalog merging must use the canonical edition resolver.');
}
if (!catalogHardening.includes('supplementExactIsbnEdition') || !catalogHardening.includes('languageCompatible')) {
  violations.push('catalogHardening.ts: exact ISBN resolution must isolate edition-specific metadata from conflicting language records.');
}

const addBookModal = read('src/components/AddBookModal.tsx');
if (!addBookModal.includes('if (isValidIsbn(trimmedQuery))') || !addBookModal.includes('const exactResponse = await searchGoogleBooks(trimmedQuery)')) {
  violations.push('AddBookModal.tsx: ISBN entry and scanner must share the canonical exact-edition resolver.');
}

const bookSearchMapper = read('src/features/book-search/mapping/bookSearchMapper.ts');
if (!bookSearchMapper.includes('hardenCatalogEdition') || !bookSearchMapper.includes('hardenCatalogGroups')) {
  violations.push('bookSearchMapper.ts: external catalog data must be hardened again at the library persistence boundary');
}
const canonicalInput = read('src/components/form/CanonicalInput.tsx');
if (!canonicalInput.includes("onValueChange") || !canonicalInput.includes("event.currentTarget.value")) {
  violations.push('CanonicalInput.tsx: editable input behavior must preserve raw reader-entered values including empty state');
}
for (const relative of ['src/components/AddBookModal.tsx', 'src/components/ReadingSessionModal.tsx']) {
  if (!read(relative).includes('CanonicalInput')) {
    violations.push(`${relative}: editable text/numeric fields must consume the canonical input boundary`);
  }
}

for (const required of ['ADD_TO_LIST_OPTIONS', 'withReadingStatus(item.book, scannerCategory)', 'Add scanned books to']) {
  if (!addBookModal.includes(required)) {
    violations.push(`AddBookModal.tsx: every add flow must consume the canonical reading-list destination (${required})`);
  }
}
if (!addBookModal.includes('isValidCatalogIsbn10') || !addBookModal.includes('isValidCatalogIsbn13')) {
  violations.push('AddBookModal.tsx: scanner ISBN validation must use canonical catalog hardening rules');
}
if (/const\s+isValidIsbn10\s*=|const\s+isValidIsbn13\s*=/.test(addBookModal)) {
  violations.push('AddBookModal.tsx: must not maintain duplicate ISBN checksum implementations');
}
if (/Reading status \/ category/.test(addBookModal) || /setCategory\(`custom:/.test(addBookModal)) {
  violations.push('AddBookModal.tsx: reader-defined ownership categories must not be stored as reading status');
}
if (!addBookModal.includes('ownershipStatus') || !addBookModal.includes('ownershipCategoryId')) {
  violations.push('AddBookModal.tsx: custom ownership selection must persist through the canonical ownership fields');
}


if (!sessionEditor.includes('localDateKey')) violations.push('SessionEditorModal.tsx: must use the canonical reading date helper');
if (/const\s+localDate\s*=/.test(sessionEditor)) violations.push('SessionEditorModal.tsx: must not maintain a second local-date formatter');

const auxiliaryConfig = read('src/features/sync/auxiliaryAccountSyncConfig.ts');
if (/libraryCustomLists\s*:|libraryCustomListMembers\s*:/.test(auxiliaryConfig)) {
  violations.push('auxiliaryAccountSyncConfig.ts: retired collection stores must not be cloud-synced');
}

const libraryScreen = read('src/components/LibraryScreen.tsx');
if (/customListMemberships|inkbound_library_custom_lists|inkbound_library_custom_list_members/.test(libraryScreen)) {
  violations.push('LibraryScreen.tsx: My Library must not own a second collection-membership store');
}
if (!libraryScreen.includes('<CollectionsScreen')) {
  violations.push('LibraryScreen.tsx: My Library Collections must render the canonical CollectionsScreen');
}

const collectionsScreen = read('src/components/CollectionsScreen.tsx');
if (!collectionsScreen.includes('ACCOUNT_DATA_STORAGE_KEYS.collectionDefinitions')) {
  violations.push('CollectionsScreen.tsx: collection definitions must use the canonical account-data storage key');
}
for (const required of ['getBookReadingState', 'getAverageBookProgress']) {
  if (!collectionsScreen.includes(required)) {
    violations.push(`CollectionsScreen.tsx: derived progress must consume canonical ${required}`);
  }
}
if (/\b(?:book|a|b)\.progressPercentage\b/.test(collectionsScreen)) {
  violations.push('CollectionsScreen.tsx: must not derive display/sort/aggregate progress from raw UserBookRecord.progressPercentage');
}
if (!collectionsScreen.includes("from '../features/collections/smartCollectionRules'")) {
  violations.push('CollectionsScreen.tsx: Smart Collections must consume the canonical smartCollectionRules engine');
}
if (collectionsScreen.includes('const smartMatches =')) {
  violations.push('CollectionsScreen.tsx: must not own a duplicate Smart Collections matching engine');
}
const smartCollectionRules = read('src/features/collections/smartCollectionRules.ts');
for (const required of ['smartCollectionRuleMatches', 'smartCollectionMatches', 'migrateLegacySmartCollectionRule']) {
  if (!smartCollectionRules.includes(required)) {
    violations.push(`smartCollectionRules.ts: missing canonical ${required} behavior`);
  }
}

const tbrScreen = read('src/components/TBRScreen.tsx');
if (!tbrScreen.includes('resolveEffectiveSeriesMetadata')) {
  violations.push('TBRScreen.tsx: series grouping must use the canonical effective-series resolver');
}

const settingsScreen = read('src/components/SettingsScreen.tsx');
for (const required of ['buildInkboundBackup', 'buildLibraryCsv', 'PREMIUM_UPGRADE_REASON']) {
  if (!settingsScreen.includes(required)) violations.push(`SettingsScreen.tsx: missing canonical ${required} consumer`);
}

const upgradeModal = read('src/components/UpgradeModal.tsx');
if (!upgradeModal.includes('PRODUCT_POLICY')) {
  violations.push('UpgradeModal.tsx: pricing and feature tiers must come from PRODUCT_POLICY');
}

const publicWebsite = read('src/components/PublicWebsite.tsx');
if (!publicWebsite.includes('PREMIUM_FEATURE_SUMMARY')) {
  violations.push('PublicWebsite.tsx: Premium marketing summary must use canonical product policy copy');
}

for (const relative of [
  'src/components/AddBookModal.tsx',
  'src/components/BatchEditModal.tsx',
  'src/components/LibraryScreen.tsx',
]) {
  const source = read(relative);
  if (!source.includes('libraryTaxonomy')) {
    violations.push(`${relative}: library value labels/options must consume libraryTaxonomy`);
  }
}

const main = read('src/main.tsx');
if (!main.includes("import('./applicationEntry.tsx')")) {
  violations.push('main.tsx: the non-public runtime must lazy-load the canonical application entry');
}

const applicationEntry = read('src/applicationEntry.tsx');
if (/from ['"].*CloudPersistenceBridge['"]/.test(applicationEntry) && !applicationEntry.includes('AdaptiveCloudPersistenceBridge')) {
  violations.push('applicationEntry.tsx: legacy CloudPersistenceBridge must not replace the adaptive canonical sync path');
}
if (!applicationEntry.includes('<CanonicalLibraryNormalizationBridge />')) {
  violations.push('applicationEntry.tsx: canonical library normalization must run at the persistence boundary');
}
if (!applicationEntry.includes('<CrossDeviceDeltaSyncBridge />') || !applicationEntry.includes('<AuxiliaryAccountSyncBridge />')) {
  violations.push('applicationEntry.tsx: both canonical core and auxiliary cross-device sync bridges must remain mounted');
}

const adaptiveSync = read('src/features/sync/AdaptiveCloudPersistenceBridge.tsx');
for (const required of ['SYNC_STORAGE_KEYS.localOwnerUid', 'SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid', 'OneShotCloudHydrationBridge', 'CostSafeCloudPersistenceBridge']) {
  if (!adaptiveSync.includes(required)) violations.push(`AdaptiveCloudPersistenceBridge.tsx: missing safe hydration boundary ${required}`);
}

for (const required of ['subscribeToRuntimeResume', 'SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid', 'crossDeviceCursorKey', 'newestSnapshotUpdateMillis']) {
  if (!oneShotHydration.includes(required)) violations.push(`OneShotCloudHydrationBridge.tsx: missing safe first-device hydration behavior ${required}`);
}
if (/Math\.max\(\s*0\s*,\s*\.\.\./.test(oneShotHydration)) {
  violations.push('OneShotCloudHydrationBridge.tsx: large-library cursor calculation must not spread an unbounded snapshot into Math.max');
}

const refreshBoundary = read('src/features/sync/CloudDataRefreshBoundary.tsx');
for (const required of ['SYNC_STORAGE_KEYS.localOwnerUid', 'SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid', 'hasEstablishedLocalWorkingCopy', 'notifyCloudDataUpdated']) {
  if (!refreshBoundary.includes(required)) violations.push(`CloudDataRefreshBoundary.tsx: missing local-first startup safety ${required}`);
}
if (refreshBoundary.includes('getCloudDataRevision')) {
  violations.push('CloudDataRefreshBoundary.tsx: startup readiness must not depend on a global cloud revision from unrelated sync bridges');
}

const syncFingerprint = read('src/features/sync/syncFingerprint.ts');
for (const required of ['stableSyncValue', 'fingerprintSyncValue']) {
  if (!syncFingerprint.includes(`export ${required === 'fingerprintSyncValue' ? 'function' : 'const'} ${required}`)) {
    violations.push(`syncFingerprint.ts: missing canonical ${required}`);
  }
}
for (const relative of [
  'src/features/sync/CostSafeCloudPersistenceBridge.tsx',
  'src/features/sync/CrossDeviceDeltaSyncBridge.tsx',
  'src/features/sync/FullCloudReconciliationBridge.tsx',
  'src/features/sync/CloudServerRefreshBridge.tsx',
]) {
  if (!read(relative).includes('syncFingerprint')) {
    violations.push(`${relative}: sync baseline serialization/fingerprints must consume syncFingerprint.ts`);
  }
}

for (const required of ['shouldRemoteChangeReplacePending', 'shouldApplyRemoteTombstone', 'subscribeToRuntimeResume', 'SYNC_STORAGE_KEYS', 'syncPendingStateKey', 'syncBaselineStateKey', 'crossDeviceCursorKey', 'hydrationRequiredOwnerUid']) {
  if (!crossDeviceSync.includes(required)) {
    violations.push(`CrossDeviceDeltaSyncBridge.tsx: core sync must consume canonical ${required}`);
  }
}
if (/inkbound_(?:pending_sync|sync_baseline|cross_device_cursor)_/.test(crossDeviceSync)) {
  violations.push('CrossDeviceDeltaSyncBridge.tsx: sync metadata key strings must come from storageKeys.ts');
}
if (/setDoc\([^\n]*syncTombstones|writeTombstones/.test(crossDeviceSync)) {
  violations.push('CrossDeviceDeltaSyncBridge.tsx: local deletion publication belongs only to the durable persistence bridge');
}

const costSafeSync = read('src/features/sync/CostSafeCloudPersistenceBridge.tsx');
for (const required of ['SYNC_STORAGE_KEYS', 'syncPendingStateKey', 'syncBaselineStateKey', 'localClearIntentKey', 'subscribeToRuntimeResume', 'syncTombstones', 'deletedAt: serverTimestamp()', 'clientUpdatedAt: mutation.clientUpdatedAt']) {
  if (!costSafeSync.includes(required)) violations.push(`CostSafeCloudPersistenceBridge.tsx: persistence must consume canonical/durable ${required}`);
}

const fullReconciliation = read('src/features/sync/FullCloudReconciliationBridge.tsx');
if (!fullReconciliation.includes('mergeIncomingBookLoanState')) {
  violations.push('FullCloudReconciliationBridge.tsx: full repair must preserve active loan metadata omitted by partial legacy records.');
}

const checkpointSync = read('src/features/sync/LibrarySyncCheckpointBridge.tsx');
for (const required of ['checkpoint.direction === \'grow\'', 'uploadedBookCount >= checkpoint.expectedBookCount', 'uploadedBookCount === checkpoint.expectedBookCount']) {
  if (!checkpointSync.includes(required)) {
    violations.push(`LibrarySyncCheckpointBridge.tsx: count verification must preserve safe growth/shrink behavior (${required})`);
  }
}
if (!checkpointSync.includes('subscribeToRuntimeResume')) {
  violations.push('LibrarySyncCheckpointBridge.tsx: incomplete checkpoints must retry through the canonical resume boundary');
}

const serverRefresh = read('src/features/sync/CloudServerRefreshBridge.tsx');
for (const required of ['SYNC_STORAGE_KEYS', 'syncPendingStateKey', 'INKBOUND_FORCE_CLOUD_REFRESH_EVENT']) {
  if (!serverRefresh.includes(required)) violations.push(`CloudServerRefreshBridge.tsx: explicit refresh must consume canonical ${required}`);
}
for (const forbidden of ['pauseAutomaticMetadataWork()', 'recoverBooksIfLocalCacheIsEmpty', 'restoreCatastrophicEmptyLibrary']) {
  if (serverRefresh.includes(forbidden)) violations.push(`CloudServerRefreshBridge.tsx: automatic startup recovery side effect is forbidden (${forbidden})`);
}
if (!serverRefresh.includes('uploaded === 0') || !serverRefresh.includes('uploaded === expected')) {
  violations.push('CloudServerRefreshBridge.tsx: manual refresh must verify shrinking/empty cloud libraries exactly');
}
if (!serverRefresh.includes('syncBaselineStateKey') || !serverRefresh.includes('baseline[id] === undefined')) {
  violations.push('CloudServerRefreshBridge.tsx: explicit refresh must honor baseline-confirmed deletions instead of preserving stale local records');
}
if (!serverRefresh.includes('baseline.books = Object.fromEntries') || !serverRefresh.includes('baseline.sessions = Object.fromEntries')) {
  violations.push('CloudServerRefreshBridge.tsx: verified full snapshots must rebuild the canonical core sync baseline');
}
if (!serverRefresh.includes('mergeIncomingBookLoanState') || !serverRefresh.includes('serverBook')) {
  violations.push('CloudServerRefreshBridge.tsx: server records must remain authoritative while preserving loan metadata omitted by partial legacy records');
}

const auxiliarySync = read('src/features/sync/AuxiliaryAccountSyncBridge.tsx');
for (const required of ['shouldRemoteChangeReplacePending', 'subscribeToRuntimeResume', 'AUXILIARY_ACCOUNT_KEYS', 'hydrationRequiredOwnerUid', "change.type === 'removed'", 'removeLocalValue']) {
  if (!auxiliarySync.includes(required)) {
    violations.push(`AuxiliaryAccountSyncBridge.tsx: auxiliary sync must consume canonical/deletion-safe ${required}`);
  }
}

const accountSync = read('src/context/AccountSyncContext.tsx');
for (const required of ['SYNC_STORAGE_KEYS', 'syncPendingStateKey', 'syncBaselineStateKey', 'crossDeviceCursorKey', 'localClearIntentKey', 'IMPORT_ENRICHMENT_QUEUE_KEY']) {
  if (!accountSync.includes(required)) violations.push(`AccountSyncContext.tsx: account cleanup must use canonical ${required}`);
}
if (!/finally\s*\{[^}]*removeRuntimeValue\(localClearIntentKey\(signingOutUid\)\)/s.test(accountSync)) {
  violations.push('AccountSyncContext.tsx: sign-out clear intent must always be removed after the auth transition');
}

const photoSync = read('src/features/memories/PhotoMemoryAutoSyncBridge.tsx');
if (!photoSync.includes('subscribeToRuntimeResume')) {
  violations.push('PhotoMemoryAutoSyncBridge.tsx: photo-memory sync must use the canonical runtime resume boundary');
}

const seriesLibrary = read('src/features/series/seriesLibrary.ts');
if (/ownership\s*:\s*['"]none['"]/.test(seriesLibrary)) {
  violations.push('seriesLibrary.ts: Series derivation must not invent a second ownership value');
}

const seriesDetective = read('src/features/series/seriesDetective.ts');
for (const required of [
  'resolveEffectiveSeriesMetadata',
  'searchGoogleBooksPage',
  'searchGoogleBooksAuthorPage',
  'searchOpenLibraryPage',
  'searchHardcover',
  'searchInkboundTrustedCatalog',
  'scoreSeriesEvidence',
  'selectVerifiedSeriesEvidence',
]) {
  if (!seriesDetective.includes(required)) {
    violations.push(`seriesDetective.ts: Series Detective must consume canonical ${required}`);
  }
}
const searchModel = read('src/features/book-search/model/bookSearch.ts');
for (const required of ['seriesName?: string', 'seriesOrder?: number']) {
  if (!searchModel.includes(required)) violations.push(`bookSearch.ts: missing canonical series metadata field ${required}`);
}
if (!bookSearchMapper.includes('hardenedEdition.seriesName') || !bookSearchMapper.includes('hardenedEdition.seriesOrder')) {
  violations.push('bookSearchMapper.ts: catalog series metadata must persist through the canonical library mapper');
}

const seriesPanel = read('src/components/library/SeriesLibraryPanel.tsx');
if (!seriesPanel.includes('seriesName: candidate.seriesName') || !seriesPanel.includes('seriesOrder: candidate.position')) {
  violations.push('SeriesLibraryPanel.tsx: Series Detective accepted candidates must persist canonical series metadata on the saved book.');
}
if (!seriesDetective.includes('existingTitleAuthors = new Set(libraryBooks') || !seriesDetective.includes('existingIsbns')) {
  violations.push('seriesDetective.ts: missing-book results must dedupe against the entire canonical library, not only the currently labeled series.');
}
if (!seriesDetective.includes('providerSourcesByWork') || !seriesDetective.includes('hasKnownSeriesContextEvidence')) {
  violations.push('seriesDetective.ts: known-series discovery must preserve multi-provider agreement through catalog hardening.');
}

const collectionsSortSource = read('src/components/CollectionsScreen.tsx');
for (const required of [
  "type CollectionSortMode = 'az' | 'za' | 'newest' | 'oldest' | 'custom'",
  "COLLECTION_SORT_STORAGE_KEY",
  "sortOrder?: number",
  "sortCollectionsForView",
  "moveCollection",
]) {
  if (!collectionsSortSource.includes(required)) {
    violations.push(`CollectionsScreen.tsx: missing canonical collection sort behavior ${required}`);
  }
}

const normalizer = read('src/features/library/libraryNormalization.ts');
if (!normalizer.includes('normalizeCanonicalLibraryRecords')) {
  violations.push('libraryNormalization.ts: canonical library record normalizer is missing');
}
if (/ownership\s*===\s*['"]wishlist['"][\s\S]{0,180}status\s*:\s*['"]wishlist['"]/.test(normalizer)) {
  violations.push('libraryNormalization.ts: ownership Wishlist must not erase independent reading status/history');
}

const cloudDataRefreshBoundary = read('src/features/sync/CloudDataRefreshBoundary.tsx');
if (!cloudDataRefreshBoundary.includes('fullReconciliationVersionKey(uid)') || !cloudDataRefreshBoundary.includes('FULL_RECONCILIATION_VERSION')) {
  violations.push('CloudDataRefreshBoundary.tsx: signed-in UI must wait for the current full reconciliation version before rendering account data.');
}

const largeBrowserStorage = read('src/platform/largeBrowserStorage.ts');
if (!largeBrowserStorage.includes('localStorage is the synchronous write-ahead copy')) {
  violations.push('largeBrowserStorage.ts: managed web data must keep a synchronous write-ahead copy until IndexedDB commits.');
}
if (!largeBrowserStorage.includes('cache.get(key) !== value')) {
  violations.push('largeBrowserStorage.ts: startup must let newer localStorage repair stale IndexedDB cache state.');
}
if (!largeBrowserStorage.includes('Promise<boolean>')) {
  violations.push('largeBrowserStorage.ts: IndexedDB writes must report commit success before oversized write-ahead copies are removed.');
}

const sourceOfTruthDoc = read('docs/DATA_SOURCE_OF_TRUTH.md');
for (const required of [
  'src/domain/libraryTaxonomy.ts',
  'src/config/productPolicy.ts',
  'src/features/series/seriesLibrary.ts',
  'src/features/export/libraryExport.ts',
  'src/features/sync/storageKeys.ts',
  'src/features/reading/bookReadingState.ts',
  'getCanonicalProgressPercentage()',
  'getAverageBookProgress()',
]) {
  if (!sourceOfTruthDoc.includes(required)) violations.push(`DATA_SOURCE_OF_TRUTH.md: missing ${required}`);
}

const releaseAudit = read('docs/RELEASE_READINESS_AUDIT.md');
for (const required of [
  'One application, one source of truth',
  'Web feature = Android feature',
  'Cross-device data matrix',
  'Manual release cases',
  'Paid checkout / subscription management',
]) {
  if (!releaseAudit.includes(required)) violations.push(`RELEASE_READINESS_AUDIT.md: missing release contract section ${required}`);
}

if (!String(packageJson.scripts?.['release:verify'] ?? '').includes('verify:parity')) {
  violations.push('package.json: release:verify must include the web/Android parity gate');
}
if (!String(packageJson.scripts?.['release:verify'] ?? '').includes('verify:source-of-truth')) {
  violations.push('package.json: release:verify must include the source-of-truth gate');
}

if (violations.length) {
  console.error('Inkbound source-of-truth verification failed.');
  for (const violation of [...new Set(violations)].sort()) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Inkbound source-of-truth boundary verification passed.');
