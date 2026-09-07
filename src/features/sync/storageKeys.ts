export const SYNC_STORAGE_KEYS = {
  books: 'inkbound_books',
  sessions: 'inkbound_sessions',
  profile: 'inkbound_reader_profile',
  theme: 'inkbound_theme',
  localOwnerUid: 'inkbound_local_data_owner_uid',
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
} as const;

export const syncPendingStateKey = (uid: string) => `inkbound_pending_sync_${uid}_v1`;
export const syncBaselineStateKey = (uid: string) => `inkbound_sync_baseline_${uid}_v2`;
export const localClearIntentKey = (uid: string) => `inkbound_local_clear_intent_${uid}`;

/**
 * Canonical persistent collections used by the app shell. UI screens should read
 * the local working copy; cloud bridges own hydration/persistence of these keys.
 */
export const CANONICAL_SYNC_COLLECTION_KEYS = [
  SYNC_STORAGE_KEYS.books,
  SYNC_STORAGE_KEYS.sessions,
  SYNC_STORAGE_KEYS.profile,
] as const;
