import { readRuntimeJson } from '../../platform/runtimeStorage';
import { DEVICE_FEATURE_STORAGE_KEYS } from '../sync/storageKeys';

const ONBOARDING_PROFILE_KEY = DEVICE_FEATURE_STORAGE_KEYS.onboardingProfile;

interface StoredOnboardingProfile {
  accessibility?: {
    textSize?: 'standard' | 'large';
    reduceMotion?: boolean;
    highContrast?: boolean;
    dyslexiaFriendly?: boolean;
  };
}

export function restoreOnboardingPreferences(): void {
  const profile = readRuntimeJson<StoredOnboardingProfile>(ONBOARDING_PROFILE_KEY, {});
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
}
