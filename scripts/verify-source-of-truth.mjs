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
  'replaceCanonicalLibrary',
  'replaceCanonicalSessions',
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
if (/useEffect\(\(\) => \{[\s\S]{0,260}writeRuntimeJson\(BOOKS_STORAGE_KEY, books\)[\s\S]{0,160}\}, \[books\]\)/.test(app)) {
  violations.push('App.tsx: canonical library must persist at the mutation boundary, never from a books-state effect');
}
if (!app.includes('if (!replaceCanonicalLibrary(next))') || !app.includes('if (!replaceCanonicalSessions(next))')) {
  violations.push('App.tsx: canonical books/sessions mutations must fail closed when persistence fails');
}
if (/safeWriteLocalStorage/.test(app)) {
  violations.push('App.tsx: direct browser persistence helper must not bypass runtimeStorage');
}
if (!app.includes('onUpdateSession={handleUpdateSession}') || !app.includes('onDeleteSession={handleDeleteSession}')) {
  violations.push('App.tsx: Book Details session edits/deletes must flow through the canonical App session mutation path');
}

const libraryMutations = read('src/features/library/libraryMutations.ts');
for (const required of ['replaceCanonicalLibrary', 'replaceCanonicalSessions', 'writeRuntimeJson']) {
  if (!libraryMutations.includes(required)) {
    violations.push(`libraryMutations.ts: persist-first canonical mutation boundary is missing ${required}`);
  }
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

const bookDetailsCore = read('src/components/BookDetailsModalCore.tsx');
for (const required of ['withReadingStatus', 'getActiveEdition', 'SYNC_STORAGE_KEYS', 'localDateKey']) {
  if (!bookDetailsCore.includes(required)) violations.push(`BookDetailsModalCore.tsx: missing canonical ${required} consumer`);
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

const sessionEditor = read('src/components/SessionEditorModal.tsx');
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
if (!applicationEntry.includes('prepareLargeBrowserStorageForStartup();')) {
  violations.push('applicationEntry.tsx: every current runtime must install large-storage protection before React mounts');
}
if (/if \(!isNativeRuntime\(\)\) prepareLargeBrowserStorageForStartup\(\)/.test(applicationEntry)) {
  violations.push('applicationEntry.tsx: Android must not bypass canonical large-storage startup protection');
}
if (!applicationEntry.includes('void hydrateLargeBrowserStorage().finally')) {
  violations.push('applicationEntry.tsx: every current runtime must hydrate canonical large storage');
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

const canonicalInput = read('src/components/form/CanonicalInput.tsx');
const webReadingSession = read('src/components/ReadingSessionModal.tsx');
const webSessionEditor = read('src/components/SessionEditorModal.tsx');
if (!canonicalInput.includes('CanonicalNumberInput')) {
  violations.push('CanonicalInput.tsx: canonical numeric draft/commit editor is missing');
}
for (const [relative, source] of [
  ['src/components/ReadingSessionModal.tsx', webReadingSession],
  ['src/components/SessionEditorModal.tsx', webSessionEditor],
]) {
  if (!source.includes('CanonicalNumberInput')) {
    violations.push(`${relative}: web reading progress must use CanonicalNumberInput`);
  }
}
if (/CanonicalInput[^>]*type=["']number["']/.test(webReadingSession) || /CanonicalInput[^>]*type=["']number["']/.test(webSessionEditor)) {
  violations.push('reading progress: editable numeric fields must not bypass CanonicalNumberInput');
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
if (!largeBrowserStorage.includes('originalSetItem!.call(this, key, normalized)')) {
  violations.push('largeBrowserStorage.ts: managed web data must synchronously write the canonical write-ahead copy before IndexedDB mirroring.');
}
if (!largeBrowserStorage.includes('const verified = originalGetItem!.call(this, key)')) {
  violations.push('largeBrowserStorage.ts: managed web data must read back the synchronous write-ahead copy before reporting success.');
}
if (!largeBrowserStorage.includes('cache.get(key) !== value')) {
  violations.push('largeBrowserStorage.ts: startup must let newer localStorage repair stale IndexedDB cache state.');
}
if (!largeBrowserStorage.includes('Promise<boolean>')) {
  violations.push('largeBrowserStorage.ts: IndexedDB writes must report commit success before oversized write-ahead copies are removed.');
}
if (largeBrowserStorage.includes('if (startupHydrationPending && isStartupKey(key)) return;')) {
  violations.push('largeBrowserStorage.ts: startup-protected writes must fail loudly instead of being silently discarded');
}
if (!largeBrowserStorage.includes('Inkbound blocked a write to')) {
  violations.push('largeBrowserStorage.ts: blocked startup writes must surface failure to the canonical mutation boundary');
}
if (!largeBrowserStorage.includes('const verified = originalGetItem!.call(this, key)')) {
  violations.push('largeBrowserStorage.ts: canonical writes must read back the synchronous write-ahead copy before reporting success');
}
if (!largeBrowserStorage.includes('if (verified !== normalized)')) {
  violations.push('largeBrowserStorage.ts: failed write verification must fail closed before the UI publishes canonical state');
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

const packageJson = JSON.parse(read('package.json'));
const analyticsConfigSource = read('src/config/analytics.ts');
if (!analyticsConfigSource.includes("INKBOUND_GA4_MEASUREMENT_ID = 'G-2LDXP8Z4S0'")) {
  violations.push('analytics.ts: canonical Inkbound GA4 measurement ID must remain G-2LDXP8Z4S0');
}
const firebaseSource = read('src/lib/firebase.ts');
for (const required of [
  "getAnalytics, logEvent",
  "measurementId: INKBOUND_GA4_MEASUREMENT_ID",
  "analytics = getAnalytics(app)",
  "logEvent(analytics, 'page_view'",
  "export { app, appCheck, auth, readDb, db, functions, storage, analytics }",
]) {
  if (!firebaseSource.includes(required)) {
    violations.push(`firebase.ts: shipped web analytics wiring is missing ${required}`);
  }
}
const envExampleSource = read('.env.example');
if (!envExampleSource.includes('VITE_FIREBASE_MEASUREMENT_ID=G-2LDXP8Z4S0')) {
  violations.push('.env.example: canonical Inkbound GA4 measurement ID must remain documented');
}
if (firebaseSource.includes('VITE_FIREBASE_MEASUREMENT_ID')) {
  violations.push('firebase.ts: production GA4 stream must not be overridden by local env drift');
}
if (!firebaseSource.includes("import { INKBOUND_GA4_MEASUREMENT_ID } from '../config/analytics';")) {
  violations.push('firebase.ts: must consume the canonical GA4 measurement ID from src/config/analytics.ts');
}
if (packageJson.scripts?.['firebase:deploy:web'] !== 'npm run verify:web-release && npx firebase-tools deploy --only hosting --project inkbound-app') {
  violations.push('package.json: web hosting deploy must remain on the web-only release path');
}
const firebaseHostingSource = read('firebase.json');
if (!firebaseHostingSource.includes('https://www.googletagmanager.com')) {
  violations.push('firebase.json: production CSP must allow the GA4 Google Tag Manager runtime');
}
const releaseVerifyCommand = String(packageJson.scripts?.['release:verify'] ?? '');
const aggregateReleaseVerifier = read('scripts/release-verify.mjs');
if (releaseVerifyCommand !== 'node scripts/release-verify.mjs') {
  violations.push('package.json: release:verify must delegate to the aggregate release verifier');
}
if (!aggregateReleaseVerifier.includes("script: 'verify:parity'")) {
  violations.push('scripts/release-verify.mjs: aggregate release verification must include the web/Android parity gate');
}
if (!aggregateReleaseVerifier.includes("script: 'verify:source-boundary'")
  || !aggregateReleaseVerifier.includes("script: 'verify:domain-taxonomy'")) {
  violations.push('scripts/release-verify.mjs: aggregate release verification must include both source-of-truth gates');
}

if (violations.length) {
  console.error('Inkbound source-of-truth verification failed.');
  for (const violation of [...new Set(violations)].sort()) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Inkbound source-of-truth boundary verification passed.');
