/**
 * Account-owned runtime keys that must follow an authenticated reader across
 * devices. Keep UI-only state (filters, collapsed sections, selected tabs,
 * onboarding state) device-local and out of this list.
 */
export const AUXILIARY_ACCOUNT_KEYS = {
  collectionDefinitions: 'inkbound_collection_definitions',
  libraryCustomLists: 'inkbound_library_custom_lists',
  libraryCustomListMembers: 'inkbound_library_custom_list_members',
  annualReadingGoal: 'inkbound_annual_goal',
  dailyReadingGoalMinutes: 'inkbound_daily_goal_minutes',
  readingMemories: 'inkbound_book_memories',
  timelineMemories: 'inkbound_timeline_memories',
  readingTimeCapsules: 'inkbound_reading_time_capsules',
  joinedChallenges: 'inkbound_joined_challenges',
} as const;

/**
 * Canonical reader state uses shared runtime keys while Firestore remains the
 * cross-device authority. These keys must never remain populated with another
 * authenticated reader's data during an account transition.
 */
export const CORE_ACCOUNT_RUNTIME_KEYS = [
  'inkbound_books',
  'inkbound_sessions',
  'inkbound_reader_profile',
] as const;

export const ACCOUNT_OWNER_UID_KEY = 'inkbound_local_data_owner_uid';

export type AuxiliaryAccountKeyName = keyof typeof AUXILIARY_ACCOUNT_KEYS;

export const getAuxiliaryPendingKey = (uid: string) => `inkbound_auxiliary_pending_${uid}_v1`;
export const getAuxiliaryBaselineKey = (uid: string) => `inkbound_auxiliary_baseline_${uid}_v1`;

/**
 * Account-owned auxiliary values use shared runtime keys so existing feature
 * stores can remain the UI-facing adapters. When the authenticated UID changes,
 * those shared keys must be cleared before the new account hydrates; otherwise
 * the previous reader's collections/goals/memories can remain visible when the
 * new account has no cloud value for the same key.
 */
export const getAuxiliaryKeysToClearForOwnerChange = (
  previousOwnerUid: string | null,
  nextOwnerUid: string,
) => previousOwnerUid && previousOwnerUid !== nextOwnerUid
  ? Object.values(AUXILIARY_ACCOUNT_KEYS)
  : [];

/**
 * Full account-transition isolation boundary. Do not set the owner marker while
 * clearing these keys: CloudPersistenceBridge uses the previous owner marker to
 * know the newly-empty cache does not represent intentional deletions by the new
 * reader. The marker changes only after canonical cloud hydration succeeds.
 */
export const getAccountOwnedKeysToClearForOwnerChange = (
  previousOwnerUid: string | null,
  nextOwnerUid: string,
) => previousOwnerUid && previousOwnerUid !== nextOwnerUid
  ? [...CORE_ACCOUNT_RUNTIME_KEYS, ...Object.values(AUXILIARY_ACCOUNT_KEYS)]
  : [];
