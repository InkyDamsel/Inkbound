export const INKBOUND_STORAGE_NAMESPACE_PREFIX = 'inkbound_';

export const DEVICE_FEATURE_STORAGE_KEYS = {
  photoMemoryCloudRevisions: 'inkbound_photo_memory_cloud_revisions_v1',
  photoMemories: 'inkbound_photo_memories_v2',
  legacyPhotoMemories: 'inkbound_photo_memories',
  photoMemorySyncQueue: 'inkbound_photo_memory_sync_queue_v1',
  onboardingComplete: 'inkbound_onboarding_complete_v1',
  onboardingProfile: 'inkbound_onboarding_profile_v1',
  legacyLibrarySanctuary: 'inkbound_library_sanctuary_v1',
  legacyProfileMediaSyncQueue: 'inkbound_profile_media_sync_queue_v1',
  pendingRecoveryRestore: 'inkbound_pending_recovery_restore_v1',
  scannerReviewDraft: 'inkbound_scanner_review_draft_v1',
  lastDaytimeLibraryMaintenance: 'inkbound_last_daytime_library_maintenance',
  legacyImportEnrichmentAutopauseCleanup: 'inkbound_import_enrichment_autopause_cleanup_v1',
  runtimeStorageMode: 'inkbound_runtime_storage_mode_v1',
} as const;

export const DEVICE_FEATURE_STORAGE_PREFIXES = {
  profileMediaSyncQueue: 'inkbound_profile_media_sync_queue_',
  runtimeModeArchive: 'inkbound_runtime_mode_archive_v2_',
  manualCoverLedgerBaseline: 'inkbound_manual_cover_ledger_baseline_v1_',
  librarySyncCheckpoint: 'inkbound_library_sync_checkpoint_v1_',
} as const;

export const DEVICE_UI_STORAGE_KEYS = {
  activeTab: 'inkbound_active_tab',
  librarySection: 'inkbound_library_section',
  librarySeriesFocusTarget: 'inkbound_library_series_focus_target',
  legacyLibrarySeriesFocusBook: 'inkbound_library_series_focus_book',
  achievementFilter: 'inkbound_achievement_filter',
  bookshelfThroughTimePreferences: 'inkbound_bookshelf_through_time_preferences',
  collectionView: 'inkbound_collection_view',
  collectionSort: 'inkbound_collection_sort',
  libraryMaintenanceCollapsedSections: 'inkbound_library_maintenance_collapsed_sections',
  sharePreferences: 'inkbound_share_preferences',
  monthlyWrappedPreferences: 'inkbound_monthly_wrapped_preferences',
  photoMemoryFilter: 'inkbound_photo_memory_filter',
  notificationsRead: 'inkbound_notifications_read',
  libraryLoanRemindersRead: 'inkbound_library_loan_reminders_read',
  navigationCollapsedGroups: 'inkbound_navigation_collapsed_groups',
  sidebarCollapsed: 'inkbound_sidebar_collapsed',
  readerPersonalityView: 'inkbound_reader_personality_view',
  readerPersonalityHiddenTraits: 'inkbound_reader_personality_hidden_traits',
  readingInsightsRange: 'inkbound_reading_insights_range',
  readingInsightsCategory: 'inkbound_reading_insights_category',
  readingInsightsDismissed: 'inkbound_reading_insights_dismissed',
  memorySelectedBook: 'inkbound_memory_selected_book',
  activeSessionDraft: 'inkbound_active_session_draft',
  timeCapsuleFilter: 'inkbound_time_capsule_filter',
  timelineFilter: 'inkbound_timeline_filter',
  timelineSearch: 'inkbound_timeline_search',
  timelineCollapsedMonths: 'inkbound_timeline_collapsed_months',
  yearInBooksPreferences: 'inkbound_year_in_books_preferences',
  seriesSort: 'inkbound_series_sort',
  loansSort: 'inkbound_loans_sort',
  timerOpen: 'inkbound_timer_open',
  timerBookId: 'inkbound_timer_book_id',
} as const;

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

export const IMPORT_STORAGE_KEYS = {
  history: 'inkbound_import_history_v1',
  verificationSnapshot: 'inkbound_import_verification_result_v2',
  legacyVerificationSnapshot: 'inkbound_import_verification_result_v1',
  metadataPending: 'inkbound_import_metadata_pending_v1',
  legacyMetadataPurge: 'inkbound_legacy_import_metadata_purge_v1',
  centerView: 'inkbound_import_center_view',
  historyLibraryCollapsed: 'inkbound_import_history_library_collapsed_v1',
  legacyEnrichmentRetryRequest: 'inkbound_import_enrichment_retry_request_v1',
} as const;

export const LEGACY_SYNC_STORAGE_KEYS = {
  books: 'bookhaven_books',
  sessions: 'bookhaven_sessions',
  libraryCustomLists: 'inkbound_library_custom_lists',
  libraryCustomListMembers: 'inkbound_library_custom_list_members',
  ignoredDuplicateGroups: 'inkbound_duplicate_groups_ignored',
} as const;

export const SYNC_STORAGE_PREFIXES = {
  pending: 'inkbound_pending_sync_',
  baseline: 'inkbound_sync_baseline_',
  legacyBaselineV1: 'inkbound_sync_baseline_',
} as const;

export const syncPendingStateKey = (uid: string) => `${SYNC_STORAGE_PREFIXES.pending}${uid}_v1`;
// v3 intentionally invalidates only the cached comparison baseline. Pending
// local mutations and the cross-device cursor keep their existing versions so
// an older account can rebuild a clean baseline without losing unsynced edits
// or replaying its full delta history.
export const syncBaselineStateKey = (uid: string) => `${SYNC_STORAGE_PREFIXES.baseline}${uid}_v3`;
export const legacySyncBaselineV1Key = (uid: string) => `${SYNC_STORAGE_PREFIXES.legacyBaselineV1}${uid}_v1`;
export const crossDeviceCursorKey = (uid: string) => `inkbound_cross_device_cursor_${uid}_v2`;
export const localClearIntentKey = (uid: string) => `inkbound_local_clear_intent_${uid}`;
export const fullReconciliationVersionKey = (uid: string) => `inkbound_full_reconciliation_${uid}_v1`;

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
