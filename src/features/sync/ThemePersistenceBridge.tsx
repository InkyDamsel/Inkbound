import React, { useEffect, useRef } from 'react';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { readRuntimeValue, writeRuntimeValue } from '../../platform/runtimeStorage';

const THEME_STORAGE_KEY = 'inkbound_theme';
const THEME_POLL_MS = 1500;

type InkboundTheme = 'dark' | 'light';

interface CloudThemeRecord {
  theme?: InkboundTheme;
  clientUpdatedAt?: string;
}

const readLocalTheme = (): InkboundTheme =>
  readRuntimeValue(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';

const applyTheme = (theme: InkboundTheme) => {
  writeRuntimeValue(THEME_STORAGE_KEY, theme);
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
};

export const ThemePersistenceBridge: React.FC = () => {
  const sync = useAccountSync();
  const lastTheme = useRef<InkboundTheme>(readLocalTheme());
  const hydrated = useRef(false);

  useEffect(() => {
    lastTheme.current = readLocalTheme();
    hydrated.current = false;
    applyTheme(lastTheme.current);

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
          applyTheme(cloudTheme);
        }
      } else {
        const localTheme = readLocalTheme();
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
      applyTheme(cloudTheme);
    });

    const poll = window.setInterval(() => {
      if (!hydrated.current || disposed) return;
      const localTheme = readLocalTheme();
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
