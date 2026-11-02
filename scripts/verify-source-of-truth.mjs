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

// Law 1: private-tag identity has exactly one implementation (features/library/privateTags.ts).
// Components must import tagIdentity instead of re-deriving it with trim()/toLowerCase().
for (const file of sourceFiles) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (relative === 'src/features/library/privateTags.ts') continue;
  const source = fs.readFileSync(file, 'utf8');
  if (/const\s+(?:normalizeTag|tagKey|canonicalTag)\s*=\s*\(\s*\w+\s*:\s*string\s*\)[^=]*=>\s*\w+\.trim\(\)\.toLocale(?:Lower|Upper)Case\(\)/.test(source)) {
    violations.push(`${relative}: defines a private tag identity; import tagIdentity from features/library/privateTags`);
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
if (!/if\s*\(!replaceCanonicalLibrary\(next(?:,\s*options)?\)\)/.test(app) || !/if\s*\(!replaceCanonicalSessions\(next(?:,\s*options)?\)\)/.test(app)) {
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

const sessionBookReconciliationSource = read('src/features/reading/sessionBookReconciliation.ts');
if (!sessionBookReconciliationSource.includes('getSessionProgressEndpoint')) {
  violations.push('sessionBookReconciliation.ts: canonical session progress endpoint logic must remain owned by the reconciliation module.');
}
if (app.includes('getSessionProgressEndpoint')) {
  violations.push('App.tsx: direct progress edits must not consume session endpoints; session history stays owned by sessionBookReconciliation.ts.');
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

const librarySectionSortSource = read('src/features/library/librarySectionSort.ts');
const seriesLibraryPanelSource = read('src/components/library/SeriesLibraryPanel.tsx');
const loansLibraryPanelSource = read('src/components/library/LoansLibraryPanel.tsx');
const collectionsScreenSource = read('src/components/CollectionsScreen.tsx');

if (!librarySectionSortSource.includes("export type LibrarySectionSortMode = 'az' | 'za' | 'newest' | 'oldest'")) {
  violations.push('librarySectionSort.ts: Series, Collections, and Loans must share the canonical library-section sort modes');
}
for (const [relative, source] of [
  ['SeriesLibraryPanel.tsx', seriesLibraryPanelSource],
  ['LoansLibraryPanel.tsx', loansLibraryPanelSource],
  ['CollectionsScreen.tsx', collectionsScreenSource],
]) {
  if (!source.includes('LIBRARY_SECTION_SORT_OPTIONS')) {
    violations.push(`${relative}: library-section sorting must consume the shared canonical sort options`);
  }
}

const sessionAnalyticsSource = read('src/features/reading/sessionAnalytics.ts');
const progressActivitySource = read('src/features/reading/progressActivity.ts');
const appSource = read('src/App.tsx');
if (!sessionAnalyticsSource.includes('getDailyPagesRead') || !sessionAnalyticsSource.includes('isRecordedReadingActivity')) {
  violations.push('sessionAnalytics.ts: daily page goals and reading-day credit must derive from canonical ReadingSession activity.');
}
if (!progressActivitySource.includes("activitySource: 'progress-confirmation'") || !progressActivitySource.includes('addConfirmedProgressActivity')) {
  violations.push('progressActivity.ts: confirmed manual progress must persist as canonical ReadingSession activity with idempotent confirmation.');
}
if (!appSource.includes('buildProgressActivityPrompt') || !appSource.includes('confirmProgressActivity') || !appSource.includes('declineProgressActivity')) {
  violations.push('App.tsx: current progress edits must remain separate from optional daily-activity confirmation.');
}
if (appSource.includes('getSessionProgressEndpoint(latest') || appSource.includes('sessionSortKey(a).localeCompare(sessionSortKey(b))')) {
  violations.push('App.tsx: direct book-progress edits must not rewrite historical session endpoints.');
}

const homeDashboardSource = read('src/components/HomeDashboard.tsx');
const readingRecencySource = read('src/features/reading/readingRecency.ts');
if (!homeDashboardSource.includes('sortCurrentlyReadingByRecency')) {
  violations.push('HomeDashboard.tsx: Currently Reading must use the canonical reading-recency helper.');
}
if (!readingRecencySource.includes('lastProgressUpdatedAt') || !readingRecencySource.includes('getReadingSessionTimestamp')) {
  violations.push('readingRecency.ts: Currently Reading order must consider both exact progress updates and canonical session recency.');
}

const cloudServerRefreshSource = read('src/features/sync/CloudServerRefreshBridge.tsx');
const cloudServerMergePolicySource = read('src/features/sync/cloudServerMergePolicy.ts');
if (!cloudServerRefreshSource.includes('mergeServerCollectionById') || !cloudServerRefreshSource.includes('mergeBooksFromServer')) {
  violations.push('CloudServerRefreshBridge.tsx: explicit cloud refresh must use the canonical cross-device merge policy.');
}
if (!cloudServerMergePolicySource.includes('mergeIncomingManualCoverState') || !cloudServerMergePolicySource.includes('mergeIncomingBookQuoteState') || !cloudServerMergePolicySource.includes('mergeIncomingBookLoanState')) {
  violations.push('cloudServerMergePolicy.ts: cross-device reconciliation must preserve protected manual covers, quotes, and loan state.');
}
if (cloudServerRefreshSource.includes('mergeMissingById(currentSessions')) {
  violations.push('CloudServerRefreshBridge.tsx: manual refresh must not ignore newer server edits to existing sessions.');
}

const nativeLoanReminderSource = read('src/features/loans/nativeLibraryLoanReminders.ts');
const loanReminderControlSource = read('src/components/library/LibraryLoanReminderControl.tsx');
if (!appSource.includes('syncNativeLibraryLoanReminders(books)')) {
  violations.push('App.tsx: native library-loan reminders must reconcile from canonical library state.');
}
if (!nativeLoanReminderSource.includes('buildNativeLoanReminderPlan') || !nativeLoanReminderSource.includes('NATIVE_LOAN_REMINDER_BOOK_IDS_KEY')) {
  violations.push('nativeLibraryLoanReminders.ts: reminder scheduling must dedupe and cancel stale canonical loan alarms.');
}
if (loanReminderControlSource.includes('syncNativeLibraryLoanReminder(')) {
  violations.push('LibraryLoanReminderControl.tsx: UI controls must not own native reminder scheduling.');
}

const readingSessionsScreenSource = read('src/components/ReadingSessionsScreen.tsx');
const bulkHistoricalSessionsSource = read('src/components/BulkHistoricalSessionsModal.tsx');
if (!readingSessionsScreenSource.includes('onSaveManualSessions') || !readingSessionsScreenSource.includes('BulkHistoricalSessionsModal')) {
  violations.push('ReadingSessionsScreen.tsx: Build 28 manual session entry must preserve both single and bulk historical session paths');
}
if (!bulkHistoricalSessionsSource.includes('onSave(nextSessions)')) {
  violations.push('BulkHistoricalSessionsModal.tsx: bulk historical sessions must save through the parent canonical session mutation path');
}

const fullCloudReconciliationSource = read('src/features/sync/FullCloudReconciliationBridge.tsx');
const oneShotCloudHydrationSource = read('src/features/sync/OneShotCloudHydrationBridge.tsx');
const accountLibraryMigrationSource = read('src/features/sync/accountLibraryMigration.ts');

if (
  !fullCloudReconciliationSource.includes('uploadMissingMigrationRecords')
  || !fullCloudReconciliationSource.includes('accountLibraryMigrationSnapshotKey')
  || !fullCloudReconciliationSource.includes('verifiedBookSnapshot')
) {
  violations.push('FullCloudReconciliationBridge.tsx: local-only account libraries must snapshot, upload, and verify before migration completes');
}
if (!cloudServerRefreshSource.includes('canReportCloudLibraryHealthy')) {
  violations.push('CloudServerRefreshBridge.tsx: manual refresh must block empty cloud from masquerading as a synced non-empty local library');
}
if (!oneShotCloudHydrationSource.includes('accountLibraryMigrationVersionKey(uid)')) {
  violations.push('OneShotCloudHydrationBridge.tsx: verified cloud hydration must mark account-library migration safe for returning devices');
}
if (!accountLibraryMigrationSource.includes('if (!migrationVerified) return true')) {
  violations.push('accountLibraryMigration.ts: non-empty local libraries must remain migration-pending until round-trip verification completes');
}

const addBookModalSource = read('src/components/AddBookModal.tsx');
if (!/import\s*\{[\s\S]*?\bsearchGoogleBooks\b[\s\S]*?\}\s*from\s*['"]\.\.\/features\/book-search\/data\/googleBooksApi['"]/.test(addBookModalSource)) {
  violations.push('AddBookModal.tsx: clean Build 28 must keep the proven Build 27 general Search boundary');
}
if (!addBookModalSource.includes('const response = await searchGoogleBooks(trimmedQuery);')) {
  violations.push('AddBookModal.tsx: normal Search must keep the proven Build 27 search call');
}
if (!addBookModalSource.includes("type AddBookTab = 'search' | 'scan' | 'manual';")) {
  violations.push('AddBookModal.tsx: Build 28 scanner must remain additive to the proven Search UI');
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
if (!applicationEntry.includes('void hydrateLargeBrowserStorage()') ||
    !applicationEntry.includes('hydrateDeferredLargeBrowserStorage()') ||
    !applicationEntry.includes(".catch((error) => {") ||
    !applicationEntry.includes('Startup halted to protect existing library data.')) {
  violations.push('applicationEntry.tsx: every runtime must hydrate canonical storage and fail closed on hydration errors');
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
const syncReadiness = read('src/features/sync/syncReadiness.ts');
for (const required of ['hasEstablishedLocalWorkingCopy', 'notifyCloudDataUpdated']) {
  if (!refreshBoundary.includes(required)) violations.push(`CloudDataRefreshBoundary.tsx: missing local-first startup safety ${required}`);
}
for (const required of ['SYNC_STORAGE_KEYS.localOwnerUid', 'SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid']) {
  if (!syncReadiness.includes(required)) violations.push(`syncReadiness.ts: missing local-first startup safety ${required}`);
}
if (refreshBoundary.includes('getCloudDataRevision')) {
  violations.push('CloudDataRefreshBoundary.tsx: startup readiness must not depend on a global cloud revision from unrelated sync bridges');
}

for (const required of ['shouldRemoteReplacePendingMutation', 'shouldApplyRemoteTombstone', 'subscribeToRuntimeResume', 'SYNC_STORAGE_KEYS', 'syncPendingStateKey', 'syncBaselineStateKey', 'crossDeviceCursorKey', 'hydrationRequiredOwnerUid']) {
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

if (!crossDeviceSync.includes('const FOREGROUND_FALLBACK_MS = 600000;')) {
  violations.push('CrossDeviceDeltaSyncBridge.tsx: foreground safety polling must remain cost-safe at 10 minutes while live listeners provide immediate wakeups');
}

const readerDirectoryMaintenance = read('functions/src/readerDirectoryMaintenance.ts');
const adminDashboardStart = readerDirectoryMaintenance.indexOf('export const getAdminDashboard');
const adminDashboardEnd = readerDirectoryMaintenance.indexOf('export const ', adminDashboardStart + 10);
const adminDashboardSource = readerDirectoryMaintenance.slice(
  adminDashboardStart,
  adminDashboardEnd > adminDashboardStart ? adminDashboardEnd : readerDirectoryMaintenance.length,
);
if (adminDashboardSource.includes('reconcileDirectory()')) {
  violations.push('readerDirectoryMaintenance.ts: opening Admin Dashboard must not trigger full directory reconciliation');
}
if (!adminDashboardSource.includes('const authUsers = await listAllAuthUsers();')) {
  violations.push('readerDirectoryMaintenance.ts: Admin Dashboard must read Auth directly without write-producing reconciliation');
}
if (!readerDirectoryMaintenance.includes('directoryRecordChanged(existing, record)')) {
  violations.push('readerDirectoryMaintenance.ts: explicit directory reconciliation must skip unchanged userDirectory writes');
}

const bookshelfThroughTime = read('src/components/BookshelfThroughTimeScreen.tsx');
for (const required of [
  'shareRuntimeBinaryFile',
  'exportRuntimeBinaryFile',
  'fetchRuntimeMediaDataUrl',
  'createShelfPng',
  'Share Shelf',
]) {
  if (!bookshelfThroughTime.includes(required)) {
    violations.push(`BookshelfThroughTimeScreen.tsx: shareable shelf export must retain ${required}`);
  }
}
if (bookshelfThroughTime.includes('navigator.share') || bookshelfThroughTime.includes('document.createElement(\'a\')')) {
  violations.push('BookshelfThroughTimeScreen.tsx: sharing/export must stay behind runtimeExport instead of direct browser APIs');
}

const runtimeMediaSource = read('src/platform/runtimeMedia.ts');
const shareMediaFunctionSource = read('functions/src/shareMedia.ts');
for (const required of ['fetchShareImage', 'httpsCallable', 'fetch(url, { mode: \'cors\'']) {
  if (!runtimeMediaSource.includes(required)) {
    violations.push(`runtimeMedia.ts: share export media fallback must retain ${required}`);
  }
}
for (const required of ['enforceAppCheck: ENFORCE_APP_CHECK', 'request.auth', 'MAX_IMAGE_BYTES', 'ALLOWED_HOST_SUFFIXES']) {
  if (!shareMediaFunctionSource.includes(required)) {
    violations.push(`shareMedia.ts: protected share-image proxy must retain ${required}`);
  }
}

const readingWidgetSource = read('src/features/reading/readingWidget.ts');
const readingWidgetBridgeSource = read('src/features/reading/ReadingWidgetSyncBridge.tsx');
for (const required of [
  "ACTIVE_READING_DRAFT_KEY = 'inkbound_active_session_draft'",
  'readRuntimeJson<ActiveReadingDraft',
  'writeRuntimeJson(ACTIVE_READING_DRAFT_KEY, next)',
  'buildReadingWidgetSnapshot',
]) {
  if (!readingWidgetSource.includes(required)) {
    violations.push(`readingWidget.ts: Android widget must mirror/control the canonical reading draft through runtimeStorage (${required})`);
  }
}
if (readingWidgetSource.includes('localStorage.')) {
  violations.push('readingWidget.ts: Android widget must not create a direct localStorage side channel.');
}
for (const required of [
  'applyReadingWidgetAction',
  'syncReadingWidget',
  'INKBOUND_LOCAL_DATA_CHANGED_EVENT',
]) {
  if (!readingWidgetBridgeSource.includes(required)) {
    violations.push(`ReadingWidgetSyncBridge.tsx: missing canonical shared widget bridge behavior ${required}`);
  }
}

const readingWidgetBridge = read('src/features/reading/ReadingWidgetSyncBridge.tsx');
const readingWidgetRuntime = read('src/features/reading/readingWidget.ts');
const androidReadingWidgetPlugin = read('android/app/src/main/java/com/inkydameinteractive/inkbound/ReadingWidgetPlugin.java');
const iosReadingWidgetPlugin = read('ios/App/App/ReadingWidgetPlugin.swift');
for (const required of ['INKBOUND_CLOUD_DATA_EVENT', 'widgetSignatureRef.current = \'\';', 'window.setTimeout']) {
  if (!readingWidgetBridge.includes(required)) {
    violations.push(`ReadingWidgetSyncBridge.tsx: widget canonical-refresh invariant missing ${required}`);
  }
}
if (!readingWidgetRuntime.includes('await ReadingWidget.readState()')) {
  violations.push('readingWidget.ts: native widget writes must be verified against canonical reading state.');
}
if (!androidReadingWidgetPlugin.includes('public void readState')) {
  violations.push('ReadingWidgetPlugin.java: Android widget state readback is required for canonical verification.');
}
if (!iosReadingWidgetPlugin.includes('@objc func readState')) {
  violations.push('ReadingWidgetPlugin.swift: iOS widget state readback is required for canonical verification.');
}
if (!iosReadingWidgetPlugin.includes('reloadAllTimelines()')) {
  violations.push('ReadingWidgetPlugin.swift: iOS widget sync must force a full timeline refresh after canonical writes.');
}

const primaryReadingSelection = read('src/features/reading/primaryReadingSelection.ts');
const homeDashboard = read('src/components/HomeDashboard.tsx');
const readingWidgetSelection = read('src/features/reading/readingWidgetSelection.ts');
if (!primaryReadingSelection.includes('selectPrimaryCurrentlyReadingBook')) {
  violations.push('primaryReadingSelection.ts: canonical primary Currently Reading selector is missing.');
}
if (!homeDashboard.includes('selectPrimaryCurrentlyReadingBook(books, sessions)')) {
  violations.push('HomeDashboard.tsx: Home must consume the canonical primary Currently Reading selector.');
}
if (!readingWidgetSelection.includes('selectPrimaryCurrentlyReadingBook(books, sessions)')) {
  violations.push('readingWidgetSelection.ts: native widget must consume the canonical primary Currently Reading selector.');
}

const costSafeSync = read('src/features/sync/CostSafeCloudPersistenceBridge.tsx');
for (const required of ['SYNC_STORAGE_KEYS', 'syncPendingStateKey', 'syncBaselineStateKey', 'localClearIntentKey', 'subscribeToRuntimeResume', 'syncTombstones', 'deletedAt: serverTimestamp()', 'clientUpdatedAt: mutation.clientUpdatedAt']) {
  if (!costSafeSync.includes(required)) violations.push(`CostSafeCloudPersistenceBridge.tsx: persistence must consume canonical/durable ${required}`);
}
if (!costSafeSync.includes('shouldCaptureReaderMutation')) {
  violations.push('CostSafeCloudPersistenceBridge.tsx: local mutation capture must use the canonical syncMutationPolicy gate.');
}
if (!costSafeSync.includes('createTrustedUpsertMutation') || !costSafeSync.includes('createTrustedDeleteMutation')) {
  violations.push('CostSafeCloudPersistenceBridge.tsx: book/session mutations must use canonical trusted mutation constructors.');
}
if (!costSafeSync.includes('detail?.trustedReaderIntent === true')) {
  violations.push('CostSafeCloudPersistenceBridge.tsx: explicit offline reader intent must bypass only the pre-reconciliation cache-churn gate.');
}
const syncMutationPolicy = read('src/features/sync/syncMutationPolicy.ts');
for (const required of ['capturedAfterCloudReconcile: true', 'coreReconciled || trustedReaderIntent', '!localClearIntent']) {
  if (!syncMutationPolicy.includes(required)) {
    violations.push(`syncMutationPolicy.ts: trusted local intent invariant missing ${required}`);
  }
}

const fullReconciliation = read('src/features/sync/FullCloudReconciliationBridge.tsx');
if (!fullReconciliation.includes('shouldRemoteReplacePendingMutation')) {
  violations.push('FullCloudReconciliationBridge.tsx: full repair must use the canonical trust-aware pending conflict policy.');
}
if (!fullReconciliation.includes('mergeIncomingBookLoanState')) {
  violations.push('FullCloudReconciliationBridge.tsx: full repair must preserve active loan metadata omitted by partial legacy records.');
}

const checkpointSync = read('src/features/sync/LibrarySyncCheckpointBridge.tsx');
for (const required of [
  "checkpoint?.direction === 'grow'",
  "checkpoint?.direction === 'shrink'",
  'localIds.size === cloudIds.size',
  '[...localIds].every((id) => cloudIds.has(id))',
  'expectedBookCount: complete ? uploadedBookCount : checkpoint!.expectedBookCount',
  'verified.matches',
  'if (!checkpoint && !complete) return;',
]) {
  if (!checkpointSync.includes(required)) {
    violations.push(`LibrarySyncCheckpointBridge.tsx: checkpoint completion must verify cloud/local book IDs and only rebase an exactly verified inventory (${required})`);
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

const sessionEvidenceRecovery = read('src/features/sync/SessionEvidenceRecoveryBridge.tsx');
for (const required of [
  "where('kind', '==', 'sessions')",
  '!cloudIds.has(session.id)',
  '!tombstonedIds.has(session.id)',
  'baseline.sessions[session.id] === undefined',
  "setDoc(",
  "users', uid, 'sessions'",
]) {
  if (!sessionEvidenceRecovery.includes(required)) {
    violations.push(`SessionEvidenceRecoveryBridge.tsx: safe one-time local session recovery missing ${required}`);
  }
}
if (!applicationEntry.includes('<SessionEvidenceRecoveryBridge />')) {
  violations.push('applicationEntry.tsx: one-time session evidence recovery bridge must remain mounted until the repair generation changes.');
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
const syncReadinessSource = read('src/features/sync/syncReadiness.ts');
if (!cloudDataRefreshBoundary.includes('hasEstablishedLocalWorkingCopy')) {
  violations.push('CloudDataRefreshBoundary.tsx: signed-in UI must use canonical local-working-copy readiness before rendering account data.');
}
if (!syncReadinessSource.includes('fullReconciliationVersionKey(uid)')
  || !syncReadinessSource.includes('FULL_RECONCILIATION_VERSION')
  || !syncReadinessSource.includes('hasCompletedFullReconciliation')) {
  violations.push('syncReadiness.ts: canonical reconciliation readiness must own the current full-reconciliation version check.');
}

const largeBrowserStorage = read('src/platform/largeBrowserStorage.ts');
if (!largeBrowserStorage.includes('originalSetItem!.call(this, key, normalized)')) {
  violations.push('largeBrowserStorage.ts: managed web data must attempt a synchronous localStorage write-ahead copy before IndexedDB persistence.');
}
if (!largeBrowserStorage.includes('let localBackupWritten = false')) {
  violations.push('largeBrowserStorage.ts: managed web persistence must track whether the synchronous write-ahead copy actually fit.');
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
if (!largeBrowserStorage.includes('LARGE_BROWSER_STORAGE_WRITE_FAILED_EVENT')) {
  violations.push('largeBrowserStorage.ts: failed IndexedDB persistence after a rejected localStorage write must surface a recovery event.');
}
if (!largeBrowserStorage.includes('if (!saved && !localBackupWritten')) {
  violations.push('largeBrowserStorage.ts: large writes must restore prior state when neither localStorage nor IndexedDB commits.');
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
