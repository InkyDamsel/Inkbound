/**
 * Account-owned runtime keys that must follow an authenticated reader across
 * devices. Keep UI-only state (filters, collapsed sections, selected tabs,
 * onboarding state) device-local and out of this list.
 */
export const AUXILIARY_ACCOUNT_KEYS = {
  collectionDefinitions: 'inkbound_collection_definitions',
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
