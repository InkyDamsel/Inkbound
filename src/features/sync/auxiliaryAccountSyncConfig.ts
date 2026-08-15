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
