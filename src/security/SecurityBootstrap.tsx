import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';

const OWNER_EMAILS = new Set([
  'blackdame494@gmail.com',
  'inkbound@inkydameinteractive.com',
]);

export function SecurityBootstrap() {
  useEffect(() => {
    if (!auth || !functions) return;

    const syncUserDirectory = httpsCallable(functions, 'syncUserDirectory');
    const bootstrapOwner = httpsCallable(functions, 'bootstrapOwner');

    return onAuthStateChanged(auth, (user) => {
      if (!user) return;

      void syncUserDirectory().catch((error) => {
        console.error('Inkbound could not synchronize the secure account directory.', error);
      });

      const email = user.email?.trim().toLowerCase();
      if (email && OWNER_EMAILS.has(email) && user.emailVerified) {
        void bootstrapOwner().catch((error) => {
          console.error('Inkbound could not bootstrap owner access.', error);
        });
      }
    });
  }, []);

  return null;
}
