import {
  ACCOUNT_DATA_STORAGE_KEYS,
  CANONICAL_SYNC_COLLECTION_KEYS,
  LEGACY_SYNC_STORAGE_KEYS,
  SYNC_STORAGE_KEYS,
} from './storageKeys';

/**
 * Reading Memories are synced per book instead of as one monolithic auxiliary
 * document. Keeping the runtime key here lets account-transition cleanup remain
 * centralized while avoiding whole-memory-map overwrite conflicts across devices.
 */
export const READING_MEMORIES_ACCOUNT_KEY = ACCOUNT_DATA_STORAGE_KEYS.readingMemories;

/**
 * Account-owned runtime keys that must follow an authenticated reader across
 * devices. Keep UI-only state (filters, collapsed sections, selected tabs,
 * onboarding state) device-local and out of this list.
 *
 * Reading Memories intentionally are not in this object: they use the dedicated
 * ReadingMemoryCloudSyncBridge so separate books can merge safely across devices.
 *
 * Do not add deprecated library custom-list keys here. Manual Collection
 * membership is canonical on UserBookRecord.collections; syncing the retired
 * custom-list stores would recreate a competing collection database.
 */
export const AUXILIARY_ACCOUNT_KEYS = {
  collectionDefinitions: ACCOUNT_DATA_STORAGE_KEYS.collectionDefinitions,
  customLibraryOrders: ACCOUNT_DATA_STORAGE_KEYS.customLibraryOrders,
  seriesOverrides: ACCOUNT_DATA_STORAGE_KEYS.seriesOverrides,
  customOwnershipCategories: ACCOUNT_DATA_STORAGE_KEYS.customOwnershipCategories,
  customReadingStatuses: ACCOUNT_DATA_STORAGE_KEYS.customReadingStatuses,
  ignoredDuplicateGroups: ACCOUNT_DATA_STORAGE_KEYS.ignoredDuplicateGroups,
  annualReadingGoal: ACCOUNT_DATA_STORAGE_KEYS.annualReadingGoal,
  dailyReadingGoalMinutes: ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalMinutes,
  dailyReadingGoalPages: ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalPages,
  timelineMemories: ACCOUNT_DATA_STORAGE_KEYS.timelineMemories,
  readingTimeCapsules: ACCOUNT_DATA_STORAGE_KEYS.readingTimeCapsules,
  joinedChallenges: ACCOUNT_DATA_STORAGE_KEYS.joinedChallenges,
  customChallenges: ACCOUNT_DATA_STORAGE_KEYS.customChallenges,
  challengeRotation: ACCOUNT_DATA_STORAGE_KEYS.challengeRotation,
  joinedChallengeSnapshots: ACCOUNT_DATA_STORAGE_KEYS.joinedChallengeSnapshots,
  dragonProfile: ACCOUNT_DATA_STORAGE_KEYS.dragonProfile,
  achievementUnlocks: ACCOUNT_DATA_STORAGE_KEYS.achievementUnlocks,
  achievementReveals: ACCOUNT_DATA_STORAGE_KEYS.achievementReveals,
  achievementSeen: ACCOUNT_DATA_STORAGE_KEYS.achievementSeen,
} as const;

/** Retired stores are named here only for migration/cleanup tooling. They are never synced. */
export const LEGACY_AUXILIARY_ACCOUNT_KEYS = [
  LEGACY_SYNC_STORAGE_KEYS.libraryCustomLists,
  LEGACY_SYNC_STORAGE_KEYS.libraryCustomListMembers,
] as const;

export const CORE_ACCOUNT_RUNTIME_KEYS = CANONICAL_SYNC_COLLECTION_KEYS;
export const ACCOUNT_OWNER_UID_KEY = SYNC_STORAGE_KEYS.localOwnerUid;
export type AuxiliaryAccountKeyName = keyof typeof AUXILIARY_ACCOUNT_KEYS;

// v2 deliberately rebuilds auxiliary baselines from Firestore. Older v1
// baselines could survive several generations of the sync engine and make a
// legitimate new local edit look like a no-op. Pending user intent is migrated
// separately by AuxiliaryAccountSyncBridge before the new baseline is built.
export const getAuxiliaryPendingKey = (uid: string) => `inkbound_auxiliary_pending_${uid}_v2`;
export const getAuxiliaryBaselineKey = (uid: string) => `inkbound_auxiliary_baseline_${uid}_v2`;
export const getLegacyAuxiliaryPendingKey = (uid: string) => `inkbound_auxiliary_pending_${uid}_v1`;
export const getLegacyAuxiliaryBaselineKey = (uid: string) => `inkbound_auxiliary_baseline_${uid}_v1`;

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
