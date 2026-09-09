import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const violations = [];

const retiredCollectionKeys = [
  'inkbound_library_custom_lists',
  'inkbound_library_custom_list_members',
];

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
if (/from ['"].*CloudPersistenceBridge['"]/.test(main) && !main.includes('AdaptiveCloudPersistenceBridge')) {
  violations.push('main.tsx: legacy CloudPersistenceBridge must not replace the adaptive canonical sync path');
}
if (!main.includes('<CanonicalLibraryNormalizationBridge />')) {
  violations.push('main.tsx: canonical library normalization must run at the persistence boundary');
}
if (!main.includes('<CrossDeviceDeltaSyncBridge />') || !main.includes('<AuxiliaryAccountSyncBridge />')) {
  violations.push('main.tsx: both canonical core and auxiliary cross-device sync bridges must remain mounted');
}

const adaptiveSync = read('src/features/sync/AdaptiveCloudPersistenceBridge.tsx');
for (const required of ['SYNC_STORAGE_KEYS.localOwnerUid', 'SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid', 'OneShotCloudHydrationBridge', 'CostSafeCloudPersistenceBridge']) {
  if (!adaptiveSync.includes(required)) violations.push(`AdaptiveCloudPersistenceBridge.tsx: missing safe hydration boundary ${required}`);
}

const oneShotHydration = read('src/features/sync/OneShotCloudHydrationBridge.tsx');
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

const crossDeviceSync = read('src/features/sync/CrossDeviceDeltaSyncBridge.tsx');
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

const checkpointSync = read('src/features/sync/LibrarySyncCheckpointBridge.tsx');
if (!checkpointSync.includes('uploadedBookCount === checkpoint.expectedBookCount')) {
  violations.push('LibrarySyncCheckpointBridge.tsx: shrinking/delete-all libraries require exact cloud-count verification');
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

const normalizer = read('src/features/library/libraryNormalization.ts');
if (!normalizer.includes('normalizeCanonicalLibraryRecords')) {
  violations.push('libraryNormalization.ts: canonical library record normalizer is missing');
}
if (/ownership\s*===\s*['"]wishlist['"][\s\S]{0,180}status\s*:\s*['"]wishlist['"]/.test(normalizer)) {
  violations.push('libraryNormalization.ts: ownership Wishlist must not erase independent reading status/history');
}

const sourceOfTruthDoc = read('docs/DATA_SOURCE_OF_TRUTH.md');
for (const required of [
  'src/domain/libraryTaxonomy.ts',
  'src/config/productPolicy.ts',
  'src/features/series/seriesLibrary.ts',
  'src/features/export/libraryExport.ts',
  'src/features/sync/storageKeys.ts',
  'src/features/reading/bookReadingState.ts',
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
