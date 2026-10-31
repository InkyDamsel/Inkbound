export const SYNC_STORAGE_KEYS = {
  books: 'inkbound_books',
  sessions: 'inkbound_sessions',
  profile: 'inkbound_reader_profile',
  theme: 'inkbound_theme',
  localOwnerUid: 'inkbound_local_data_owner_uid',
  hydrationRequiredOwnerUid: 'inkbound_cloud_hydration_required_uid',
  lastCloudSyncAt: 'inkbound_last_cloud_sync_at',
  importEnrichmentQueue: 'inkbound_import_enrichment_queue_v3',
  importEnrichmentPaused: 'inkbound_import_enrichment_paused_v1',
  importEnrichmentRetryProgress: 'inkbound_import_enrichment_retry_progress_v1',
  importEnrichmentActiveRetry: 'inkbound_import_enrichment_active_retry_v1',
} as const;

export const DEVICE_STORAGE_KEYS = {
  collectionSort: 'inkbound_collection_sort',
  loansSort: 'inkbound_loans_sort',
  seriesSort: 'inkbound_series_sort',
} as const;

export const ACCOUNT_DATA_STORAGE_KEYS = {
  collectionDefinitions: 'inkbound_collection_definitions',
  customLibraryOrders: 'inkbound_custom_library_orders_v1',
  seriesOverrides: 'inkbound_series_overrides_v1',
  customOwnershipCategories: 'inkbound_custom_ownership_categories_v1',
  customReadingStatuses: 'inkbound_custom_reading_statuses_v1',
  ignoredDuplicateGroups: 'inkbound_duplicate_groups_ignored_v2',
  annualReadingGoal: 'inkbound_annual_goal',
  dailyReadingGoalMinutes: 'inkbound_daily_goal_minutes',
  dailyReadingGoalPages: 'inkbound_daily_goal_pages',
  timelineMemories: 'inkbound_timeline_memories',
  readingTimeCapsules: 'inkbound_reading_time_capsules',
  joinedChallenges: 'inkbound_joined_challenges',
  customChallenges: 'inkbound_custom_challenges_v1',
  challengeRotation: 'inkbound_challenge_rotation_v2',
  joinedChallengeSnapshots: 'inkbound_joined_challenge_snapshots_v2',
  dragonProfile: 'inkbound_dragon',
  achievementUnlocks: 'inkbound_achievement_unlocks_v5',
  achievementReveals: 'inkbound_achievement_reveals_v5',
  achievementSeen: 'inkbound_achievement_seen_v5',
  readingMemories: 'inkbound_book_memories',
} as const;

export const LEGACY_SYNC_STORAGE_KEYS = {
  books: 'bookhaven_books',
  sessions: 'bookhaven_sessions',
  libraryCustomLists: 'inkbound_library_custom_lists',
  libraryCustomListMembers: 'inkbound_library_custom_list_members',
} as const;

export const syncPendingStateKey = (uid: string) => `inkbound_pending_sync_${uid}_v1`;
// v3 intentionally invalidates only the cached comparison baseline. Pending
// local mutations and the cross-device cursor keep their existing versions so
// an older account can rebuild a clean baseline without losing unsynced edits
// or replaying its full delta history.
export const syncBaselineStateKey = (uid: string) => `inkbound_sync_baseline_${uid}_v3`;
export const crossDeviceCursorKey = (uid: string) => `inkbound_cross_device_cursor_${uid}_v2`;
export const localClearIntentKey = (uid: string) => `inkbound_local_clear_intent_${uid}`;
export const fullReconciliationVersionKey = (uid: string) => `inkbound_full_reconciliation_${uid}_v1`;
export const accountLibraryMigrationVersionKey = (uid: string) => `inkbound_account_library_migration_${uid}_v1`;
export const accountLibraryMigrationSnapshotKey = (uid: string) => `inkbound_account_library_migration_snapshot_${uid}_v1`;
export const manualCoverLedgerBaselineKey = (uid: string) => `inkbound_manual_cover_ledger_baseline_v1_${uid}`;

// Single source of truth for the one-time full account reconciliation. Bumping
// this value deliberately forces existing browser/device working copies through
// one fresh full comparison before returning to low-cost delta sync.
export const ACCOUNT_LIBRARY_MIGRATION_VERSION = '1';
export const FULL_RECONCILIATION_VERSION = '5';

/**
 * Runtime keys whose local mutations should emit the debounced Inkbound change
 * signal. Core library persistence and auxiliary bridges can then react to real
 * edits instead of waking up every couple of seconds to poll storage.
 */
export const CANONICAL_SYNC_COLLECTION_KEYS = [
  SYNC_STORAGE_KEYS.books,
  SYNC_STORAGE_KEYS.sessions,
  SYNC_STORAGE_KEYS.profile,
  ACCOUNT_DATA_STORAGE_KEYS.collectionDefinitions,
  ACCOUNT_DATA_STORAGE_KEYS.customLibraryOrders,
  ACCOUNT_DATA_STORAGE_KEYS.seriesOverrides,
  ACCOUNT_DATA_STORAGE_KEYS.customOwnershipCategories,
  ACCOUNT_DATA_STORAGE_KEYS.customReadingStatuses,
  ACCOUNT_DATA_STORAGE_KEYS.ignoredDuplicateGroups,
  ACCOUNT_DATA_STORAGE_KEYS.annualReadingGoal,
  ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalMinutes,
  ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalPages,
  ACCOUNT_DATA_STORAGE_KEYS.timelineMemories,
  ACCOUNT_DATA_STORAGE_KEYS.readingTimeCapsules,
  ACCOUNT_DATA_STORAGE_KEYS.joinedChallenges,
  ACCOUNT_DATA_STORAGE_KEYS.customChallenges,
  ACCOUNT_DATA_STORAGE_KEYS.challengeRotation,
  ACCOUNT_DATA_STORAGE_KEYS.joinedChallengeSnapshots,
  ACCOUNT_DATA_STORAGE_KEYS.dragonProfile,
  ACCOUNT_DATA_STORAGE_KEYS.achievementUnlocks,
  ACCOUNT_DATA_STORAGE_KEYS.achievementReveals,
  ACCOUNT_DATA_STORAGE_KEYS.achievementSeen,
  ACCOUNT_DATA_STORAGE_KEYS.readingMemories,
] as const;
