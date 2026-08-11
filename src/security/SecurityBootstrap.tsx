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

      void syncUserDirectory().catch((error) => {
        console.error('Inkbound could not synchronize the secure account directory.', error);
      });

      const email = user.email?.trim().toLowerCase();
      if (!email || !OWNER_EMAILS.has(email) || !user.emailVerified) return;

      void (async () => {
        try {
          await bootstrapOwner();

          // DEV and production must render the same product behavior. The local
          // emulator has a completely separate database, so seed this protected
          // owner account with the same VIP entitlement it has in production.
          // This changes only emulator test data; no UI or feature code branches
          // between DEV and production.
          if (useFirebaseEmulators) {
            await grantVip({
              targetUserId: user.uid,
              targetEmail: email,
              reason: 'Development parity seed for protected owner account',
            });
          }
        } catch (error) {
          console.error('Inkbound could not bootstrap owner access.', error);
        }
      })();
    });
  }, []);

  return null;
}
