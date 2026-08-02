const ONBOARDING_PROFILE_KEY = 'inkbound_onboarding_profile_v1';

interface StoredOnboardingProfile {
  accessibility?: {
    textSize?: 'standard' | 'large';
    reduceMotion?: boolean;
    highContrast?: boolean;
    dyslexiaFriendly?: boolean;
  };
}

export function restoreOnboardingPreferences(): void {
  try {
    const stored = window.localStorage.getItem(ONBOARDING_PROFILE_KEY);
    if (!stored) return;

    const profile = JSON.parse(stored) as StoredOnboardingProfile;
    const accessibility = profile.accessibility;
    if (!accessibility) return;

    document.documentElement.dataset.textSize = accessibility.textSize ?? 'standard';
    document.documentElement.classList.toggle(
      'reduce-motion',
      Boolean(accessibility.reduceMotion),
    );
    document.documentElement.classList.toggle(
      'high-contrast',
      Boolean(accessibility.highContrast),
    );
    document.documentElement.classList.toggle(
      'dyslexia-friendly',
      Boolean(accessibility.dyslexiaFriendly),
    );
  } catch {
    // Ignore malformed local data and retain Inkbound's default presentation.
  }
}
