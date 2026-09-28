import { readRuntimeJson, writeRuntimeJson } from '../../platform/runtimeStorage';
import { DEVICE_FEATURE_STORAGE_KEYS } from '../sync/storageKeys';

const ONBOARDING_PROFILE_KEY = DEVICE_FEATURE_STORAGE_KEYS.onboardingProfile;

interface StoredOnboardingProfile {
  accessibility?: {
    textSize?: 'standard' | 'large';
    reduceMotion?: boolean;
    highContrast?: boolean;
    dyslexiaFriendly?: boolean;
  };
  readerStyle?: unknown;
  genres?: unknown;
  libraryStart?: unknown;
  completedAt?: unknown;
}

export function restoreOnboardingPreferences(): void {
  const profile = readRuntimeJson<StoredOnboardingProfile>(ONBOARDING_PROFILE_KEY, {});
  const accessibility = profile.accessibility;
  if (!accessibility) return;

  if (
    'readerStyle' in profile
    || 'genres' in profile
    || 'libraryStart' in profile
    || 'completedAt' in profile
  ) {
    writeRuntimeJson(ONBOARDING_PROFILE_KEY, { accessibility });
  }

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
