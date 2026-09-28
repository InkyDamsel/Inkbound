import React, { useEffect, useRef } from 'react';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { persistInkboundTheme, readInkboundTheme, type InkboundTheme } from './themePreference';

const THEME_POLL_MS = 1500;

interface CloudThemeRecord {
  theme?: InkboundTheme;
  clientUpdatedAt?: string;
}

export const ThemePersistenceBridge: React.FC = () => {
  const sync = useAccountSync();
  const lastTheme = useRef<InkboundTheme>(readInkboundTheme());
  const hydrated = useRef(false);

  useEffect(() => {
    lastTheme.current = readInkboundTheme();
    hydrated.current = false;
    persistInkboundTheme(lastTheme.current);

    if (!sync.user || !db) return undefined;

    const preferenceRef = doc(db, 'users', sync.user.uid, 'preferences', 'appearance');
    let disposed = false;

    const initialize = async () => {
      const snapshot = await getDoc(preferenceRef);
      if (disposed) return;

      if (snapshot.exists()) {
        const cloudTheme = (snapshot.data() as CloudThemeRecord).theme;
        if (cloudTheme === 'dark' || cloudTheme === 'light') {
          lastTheme.current = cloudTheme;
          persistInkboundTheme(cloudTheme);
        }
      } else {
        const localTheme = readInkboundTheme();
        lastTheme.current = localTheme;
        await setDoc(preferenceRef, {
          theme: localTheme,
          updatedAt: serverTimestamp(),
          clientUpdatedAt: new Date().toISOString(),
        });
      }

      hydrated.current = true;
    };

    void initialize();

    const unsubscribe = onSnapshot(preferenceRef, (snapshot) => {
      if (!hydrated.current || !snapshot.exists()) return;
      const cloudTheme = (snapshot.data() as CloudThemeRecord).theme;
      if ((cloudTheme !== 'dark' && cloudTheme !== 'light') || cloudTheme === lastTheme.current) return;
      lastTheme.current = cloudTheme;
      persistInkboundTheme(cloudTheme);
    });

    const poll = window.setInterval(() => {
      if (!hydrated.current || disposed) return;
      const localTheme = readInkboundTheme();
      if (localTheme === lastTheme.current) return;
      lastTheme.current = localTheme;
      void setDoc(
        preferenceRef,
        {
          theme: localTheme,
          updatedAt: serverTimestamp(),
          clientUpdatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    }, THEME_POLL_MS);

    return () => {
      disposed = true;
      window.clearInterval(poll);
      unsubscribe();
    };
  }, [sync.user?.uid]);

  return null;
};
