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
  activeTab: 'inkbound_active_tab',
  timerOpen: 'inkbound_timer_open',
  timerBookId: 'inkbound_timer_book_id',
  daytimeLibraryMaintenance: 'inkbound_last_daytime_library_maintenance',
  scannerReviewDraft: 'inkbound_scanner_review_draft_v1',
  photoMemoryMetadata: 'inkbound_photo_memories_v2',
  importHistory: 'inkbound_import_history_v1',
  importVerificationResult: 'inkbound_import_verification_result_v2',
  importMetadataPending: 'inkbound_import_metadata_pending_v1',
  importCenterView: 'inkbound_import_center_view',
  notificationsRead: 'inkbound_notifications_read',
  libraryLoanRemindersRead: 'inkbound_library_loan_reminders_read',
  navigationCollapsedGroups: 'inkbound_navigation_collapsed_groups',
  sidebarCollapsed: 'inkbound_sidebar_collapsed',
  activeSessionDraft: 'inkbound_active_session_draft',
  collectionView: 'inkbound_collection_view',
  collectionSort: 'inkbound_collection_sort',
  loansSort: 'inkbound_loans_sort',
  seriesSort: 'inkbound_series_sort',
  librarySection: 'inkbound_library_section',
  librarySeriesFocusTarget: 'inkbound_library_series_focus_target',
  importEnrichmentAutopauseCleanup: 'inkbound_import_enrichment_autopause_cleanup_v1',
} as const;

export const LEGACY_DEVICE_STORAGE_KEYS = {
  importVerificationResult: 'inkbound_import_verification_result_v1',
  importEnrichmentRetryRequest: 'inkbound_import_enrichment_retry_request_v1',
  librarySeriesFocusBook: 'inkbound_library_series_focus_book',
} as const;

export const ACCOUNT_DATA_STORAGE_KEYS = {
  collectionDefinitions: 'inkbound_collection_definitions',
  seriesOverrides: 'inkbound_series_overrides_v1',
  customOwnershipCategories: 'inkbound_custom_ownership_categories_v1',
  ignoredDuplicateGroups: 'inkbound_duplicate_groups_ignored_v2',
  annualReadingGoal: 'inkbound_annual_goal',
  dailyReadingGoalMinutes: 'inkbound_daily_goal_minutes',
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
  profileMediaSyncQueue: 'inkbound_profile_media_sync_queue_v1',
} as const;

export const LEGACY_ACCOUNT_DATA_STORAGE_KEYS = {
  photoMemories: 'inkbound_photo_memories',
  syncBaselineV1: (uid: string) => `inkbound_sync_baseline_${uid}_v1`,
} as const;

export const INKBOUND_STORAGE_NAMESPACE_PREFIX = 'inkbound_';

export const SYNC_STORAGE_PREFIXES = {
  pending: 'inkbound_pending_sync_',
  baseline: 'inkbound_sync_baseline_',
  auxiliaryPending: 'inkbound_auxiliary_pending_',
  auxiliaryBaseline: 'inkbound_auxiliary_baseline_',
} as const;

export const syncPendingStateKey = (uid: string) => `${SYNC_STORAGE_PREFIXES.pending}${uid}_v1`;
// v3 intentionally invalidates only the cached comparison baseline. Pending
// local mutations and the cross-device cursor keep their existing versions so
// an older account can rebuild a clean baseline without losing unsynced edits
// or replaying its full delta history.
export const syncBaselineStateKey = (uid: string) => `${SYNC_STORAGE_PREFIXES.baseline}${uid}_v3`;
export const crossDeviceCursorKey = (uid: string) => `inkbound_cross_device_cursor_${uid}_v2`;
export const localClearIntentKey = (uid: string) => `inkbound_local_clear_intent_${uid}`;
export const fullReconciliationVersionKey = (uid: string) => `inkbound_full_reconciliation_${uid}_v1`;
export const librarySyncCheckpointKey = (uid: string) => `inkbound_library_sync_checkpoint_v1_${uid}`;
export const auxiliaryPendingStateKey = (uid: string) => `${SYNC_STORAGE_PREFIXES.auxiliaryPending}${uid}_v2`;
export const auxiliaryBaselineStateKey = (uid: string) => `${SYNC_STORAGE_PREFIXES.auxiliaryBaseline}${uid}_v2`;
export const legacyAuxiliaryPendingStateKey = (uid: string) => `${SYNC_STORAGE_PREFIXES.auxiliaryPending}${uid}_v1`;
export const legacyAuxiliaryBaselineStateKey = (uid: string) => `${SYNC_STORAGE_PREFIXES.auxiliaryBaseline}${uid}_v1`;

// Single source of truth for the one-time full account reconciliation. Bumping
// this value deliberately forces existing browser/device working copies through
// one fresh full comparison before returning to low-cost delta sync.
export const FULL_RECONCILIATION_VERSION = '3';

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
  ACCOUNT_DATA_STORAGE_KEYS.seriesOverrides,
  ACCOUNT_DATA_STORAGE_KEYS.customOwnershipCategories,
  ACCOUNT_DATA_STORAGE_KEYS.ignoredDuplicateGroups,
  ACCOUNT_DATA_STORAGE_KEYS.annualReadingGoal,
  ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalMinutes,
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
