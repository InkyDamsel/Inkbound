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

export const LEGACY_SYNC_STORAGE_KEYS = {
  books: 'bookhaven_books',
  sessions: 'bookhaven_sessions',
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
