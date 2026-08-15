import { readRuntimeJson } from '../../platform/runtimeStorage';

export const ANNUAL_READING_GOAL_KEY = 'inkbound_annual_goal';
export const DAILY_READING_GOAL_MINUTES_KEY = 'inkbound_daily_goal_minutes';

const readPositiveNumber = (key: string, fallback: number): number => {
  const parsed = readRuntimeJson<unknown>(key, fallback);
  return Math.max(1, Number(parsed) || fallback);
};

export const getAnnualReadingGoal = (): number => readPositiveNumber(ANNUAL_READING_GOAL_KEY, 25);

export const getDailyReadingGoalMinutes = (): number => readPositiveNumber(DAILY_READING_GOAL_MINUTES_KEY, 30);
