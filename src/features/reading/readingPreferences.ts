export const ANNUAL_READING_GOAL_KEY = 'inkbound_annual_goal';
export const DAILY_READING_GOAL_MINUTES_KEY = 'inkbound_daily_goal_minutes';

const readPositiveNumber = (key: string, fallback: number): number => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Math.max(1, Number(parsed) || fallback);
  } catch {
    return fallback;
  }
};

export const getAnnualReadingGoal = (): number => readPositiveNumber(ANNUAL_READING_GOAL_KEY, 25);

export const getDailyReadingGoalMinutes = (): number => readPositiveNumber(DAILY_READING_GOAL_MINUTES_KEY, 30);
