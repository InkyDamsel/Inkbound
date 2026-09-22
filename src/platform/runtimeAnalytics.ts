import { FirebaseAnalytics } from '@capacitor-firebase/analytics';
import { isAndroidRuntime } from './runtimePlatform';

let initialized = false;

export async function initializeNativeAnalytics(): Promise<void> {
  if (!isAndroidRuntime() || initialized) return;
  initialized = true;

  await FirebaseAnalytics.setCurrentScreen({
    screenName: 'Inkbound',
    screenClassOverride: 'MainActivity',
  });

  await FirebaseAnalytics.logEvent({
    name: 'inkbound_app_open',
    params: {
      platform: 'android',
      runtime: 'capacitor',
    },
  });
}
