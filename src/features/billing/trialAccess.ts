const DAY_MS = 24 * 60 * 60 * 1000;

export function getTrialDaysRemaining(trialPremiumUntil: string | null | undefined): number | null {
  if (!trialPremiumUntil) return null;

  const expiresAt = new Date(trialPremiumUntil).getTime();
  if (Number.isNaN(expiresAt)) return null;

  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return 0;

  return Math.max(1, Math.ceil(remainingMs / DAY_MS));
}

export function formatTrialDaysRemaining(trialPremiumUntil: string | null | undefined): string | null {
  const daysRemaining = getTrialDaysRemaining(trialPremiumUntil);
  if (daysRemaining === null) return null;
  if (daysRemaining <= 0) return 'Trial ending now';
  return `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} remaining`;
}
