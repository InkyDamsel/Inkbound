import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import {
  allowProductionFirebaseWrites,
  auth,
  functions,
  useFirebaseEmulators,
} from '../lib/firebase';
import { isAndroidRuntime } from '../platform/runtimePlatform';

const OWNER_EMAILS = new Set([
  'blackdame494@gmail.com',
  'inkbound@inkydameinteractive.com',
]);

async function supportRuntimeContext() {
  const base = {
    platform: isAndroidRuntime() ? 'android' : 'web',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : '',
    appVersion: '',
    buildNumber: '',
  };

  if (!isAndroidRuntime()) return base;

  try {
    const info = await CapacitorApp.getInfo();
    return {
      ...base,
      appVersion: info.version ?? '',
      buildNumber: info.build ?? '',
    };
  } catch {
    return base;
  }
}

export function SecurityBootstrap() {
  useEffect(() => {
    if (!auth || !functions || !allowProductionFirebaseWrites) return;

    const syncUserDirectory = httpsCallable(functions, 'syncUserDirectory');
    const bootstrapOwner = httpsCallable(functions, 'bootstrapOwner');
    const grantVip = httpsCallable(functions, 'grantVip');

    return onAuthStateChanged(auth, (user) => {
      if (!user) return;

      const email = user.email?.trim().toLowerCase();

      void (async () => {
        try {
          // Keep account creation and entitlement creation deterministic. The
          // directory call must finish before any access changes are applied.
          await syncUserDirectory(await supportRuntimeContext());

          if (email && OWNER_EMAILS.has(email) && user.emailVerified) {
            await bootstrapOwner();

            if (useFirebaseEmulators) {
              await grantVip({
                targetUserId: user.uid,
                targetEmail: email,
                reason: 'Development parity seed for protected owner account',
              });
            }
          }

          // UserPlanContext listens for this event and immediately re-reads the
          // authoritative entitlement after bootstrap/grants finish. This avoids
          // rendering stale Free access while Administration already sees VIP.
          window.dispatchEvent(new Event('inkbound:entitlement-refresh'));
        } catch (error) {
          console.error('Inkbound could not bootstrap secure account access.', error);
        }
      })();
    });
  }, []);

  return null;
}
