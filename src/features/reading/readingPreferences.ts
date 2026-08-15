import { readRuntimeJson } from '../../platform/runtimeStorage';

export const ANNUAL_READING_GOAL_KEY = 'inkbound_annual_goal';
export const DAILY_READING_GOAL_MINUTES_KEY = 'inkbound_daily_goal_minutes';

const readPositiveInteger = (key: string, fallback: number, maximum: number): number => {
  const raw = readRuntimeJson<unknown>(key, fallback);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(maximum, Math.max(1, Math.round(parsed)));
};

export const getAnnualReadingGoal = (): number => readPositiveInteger(ANNUAL_READING_GOAL_KEY, 25, 1000);

export const getDailyReadingGoalMinutes = (): number => readPositiveInteger(DAILY_READING_GOAL_MINUTES_KEY, 30, 1440);
