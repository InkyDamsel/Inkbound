import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import {
  allowProductionFirebaseWrites,
  auth,
  functions,
  useFirebaseEmulators,
} from '../lib/firebase';

const OWNER_EMAILS = new Set([
  'blackdame494@gmail.com',
  'inkbound@inkydameinteractive.com',
]);

export function SecurityBootstrap() {
  useEffect(() => {
    if (!auth || !functions || !allowProductionFirebaseWrites) return;

    const syncUserDirectory = httpsCallable(functions, 'syncUserDirectory');
    const bootstrapOwner = httpsCallable(functions, 'bootstrapOwner');
    const grantVip = httpsCallable(functions, 'grantVip');

    return onAuthStateChanged(auth, (user) => {
      if (!user) return;

      const email = user.email?.trim().toLowerCase();
      const isProtectedOwner = Boolean(
        email && OWNER_EMAILS.has(email) && user.emailVerified,
      );

      void (async () => {
        try {
          // Keep account initialization strictly ordered. syncUserDirectory creates
          // a Free entitlement when none exists; if it races grantVip, its initial
          // Free write can land after the VIP write and make Settings/sidebar show
          // Free even while Administration reports VIP. Finish the base account
          // record first, then apply owner/admin access and finally the entitlement.
          await syncUserDirectory();

          if (!isProtectedOwner || !email) return;

          await bootstrapOwner();

          // DEV and production render the same product behavior. The emulator has
          // isolated data, so seed the protected owner with the same VIP entitlement
          // used in production through the real server-authoritative grant flow.
          if (useFirebaseEmulators) {
            await grantVip({
              targetUserId: user.uid,
              targetEmail: email,
              reason: 'Development parity seed for protected owner account',
            });
          }
        } catch (error) {
          console.error('Inkbound could not bootstrap secure account access.', error);
        }
      })();
    });
  }, []);

  return null;
}
