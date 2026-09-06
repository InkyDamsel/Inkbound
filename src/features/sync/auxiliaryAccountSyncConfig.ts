/**
 * Reading Memories are synced per book instead of as one monolithic auxiliary
 * document. Keeping the runtime key here lets account-transition cleanup remain
 * centralized while avoiding whole-memory-map overwrite conflicts across devices.
 */
export const READING_MEMORIES_ACCOUNT_KEY = 'inkbound_book_memories';

/**
 * Account-owned runtime keys that must follow an authenticated reader across
 * devices. Keep UI-only state (filters, collapsed sections, selected tabs,
 * onboarding state) device-local and out of this list.
 *
 * Reading Memories intentionally are not in this object: they use the dedicated
 * ReadingMemoryCloudSyncBridge so separate books can merge safely across devices.
 */
export const AUXILIARY_ACCOUNT_KEYS = {
  collectionDefinitions: 'inkbound_collection_definitions',
  libraryCustomLists: 'inkbound_library_custom_lists',
  libraryCustomListMembers: 'inkbound_library_custom_list_members',
  seriesOverrides: 'inkbound_series_overrides_v1',
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
} as const;

export const CORE_ACCOUNT_RUNTIME_KEYS = [
  'inkbound_books',
  'inkbound_sessions',
  'inkbound_reader_profile',
] as const;

export const ACCOUNT_OWNER_UID_KEY = 'inkbound_local_data_owner_uid';
export type AuxiliaryAccountKeyName = keyof typeof AUXILIARY_ACCOUNT_KEYS;
export const getAuxiliaryPendingKey = (uid: string) => `inkbound_auxiliary_pending_${uid}_v1`;
export const getAuxiliaryBaselineKey = (uid: string) => `inkbound_auxiliary_baseline_${uid}_v1`;

export const getAuxiliaryKeysToClearForOwnerChange = (
  previousOwnerUid: string | null,
  nextOwnerUid: string,
) => previousOwnerUid && previousOwnerUid !== nextOwnerUid
  ? [...Object.values(AUXILIARY_ACCOUNT_KEYS), READING_MEMORIES_ACCOUNT_KEY]
  : [];

export const getAccountOwnedKeysToClearForOwnerChange = (
  previousOwnerUid: string | null,
  nextOwnerUid: string,
) => previousOwnerUid && previousOwnerUid !== nextOwnerUid
  ? [...CORE_ACCOUNT_RUNTIME_KEYS, ...Object.values(AUXILIARY_ACCOUNT_KEYS), READING_MEMORIES_ACCOUNT_KEY]
  : [];
