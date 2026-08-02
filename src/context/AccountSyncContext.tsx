import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  User,
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../lib/firebase';

type SyncStatus = 'idle' | 'working' | 'success' | 'error';

interface AccountSyncContextValue {
  user: User | null;
  isConfigured: boolean;
  isAuthReady: boolean;
  status: SyncStatus;
  message: string;
  lastSyncedAt: string | null;
  signInWithGoogle: () => Promise<void>;
  signOutAccount: () => Promise<void>;
  uploadSnapshot: () => Promise<void>;
  restoreSnapshot: () => Promise<void>;
}

const AccountSyncContext = createContext<AccountSyncContextValue | undefined>(undefined);

const LAST_SYNC_STORAGE_KEY = 'inkbound_last_cloud_sync_at';

const SYNC_KEYS = [
  'inkbound_books',
  'inkbound_sessions',
  'inkbound_theme',
  'inkbound_user_plan',
  'inkbound_reader_profile',
  'inkbound_active_tab',
  'inkbound_annual_goal',
  'inkbound_daily_goal_minutes',
  'inkbound_notifications_read',
  'inkbound_reading_session_draft',
  'inkbound_joined_challenges',
  'inkbound_achievement_unlocks',
  'inkbound_achievement_seen',
  'inkbound_achievement_filter',
] as const;

const collectSnapshot = () =>
  Object.fromEntries(
    SYNC_KEYS.map((key) => [key, localStorage.getItem(key)]).filter(([, value]) => value !== null),
  );

export const AccountSyncProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(!auth);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [message, setMessage] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() =>
    localStorage.getItem(LAST_SYNC_STORAGE_KEY),
  );

  useEffect(() => {
    if (!auth) return undefined;

    let unsubscribe: (() => void) | undefined;

    void setPersistence(auth, browserLocalPersistence)
      .then(() => {
        unsubscribe = onAuthStateChanged(auth, (nextUser) => {
          setUser(nextUser);
          setIsAuthReady(true);
        });
      })
      .catch((error) => {
        setStatus('error');
        setMessage(
          error instanceof Error
            ? error.message
            : 'Inkbound could not restore the saved Google session.',
        );
        setIsAuthReady(true);
      });

    return () => unsubscribe?.();
  }, []);

  const signInWithGoogle = async () => {
    if (!auth) {
      setStatus('error');
      setMessage('Google sync is not configured yet.');
      return;
    }

    try {
      setStatus('working');
      setMessage('Opening Google sign-in...');
      await setPersistence(auth, browserLocalPersistence);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      setStatus('success');
      setMessage(
        'Google account connected. Inkbound will remember this account on this browser until you sign out.',
      );
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Google sign-in failed.');
    }
  };

  const uploadSnapshot = async () => {
    if (!user || !db) {
      setStatus('error');
      setMessage('Sign in with Google before syncing this device.');
      return;
    }

    try {
      setStatus('working');
      setMessage('Uploading this device...');
      const syncedAt = new Date().toISOString();
      await setDoc(
        doc(db, 'users', user.uid, 'sync', 'current'),
        {
          data: collectSnapshot(),
          provider: 'google',
          updatedAt: serverTimestamp(),
          clientUpdatedAt: syncedAt,
          version: 1,
        },
        { merge: true },
      );
      localStorage.setItem(LAST_SYNC_STORAGE_KEY, syncedAt);
      setLastSyncedAt(syncedAt);
      setStatus('success');
      setMessage('This device is synced to your Google-connected Inkbound account.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Upload failed.');
    }
  };

  const restoreSnapshot = async () => {
    if (!user || !db) {
      setStatus('error');
      setMessage('Sign in with Google before restoring cloud data.');
      return;
    }

    try {
      setStatus('working');
      setMessage('Restoring your Inkbound data...');
      const snapshot = await getDoc(doc(db, 'users', user.uid, 'sync', 'current'));
      if (!snapshot.exists()) {
        setStatus('error');
        setMessage('No cloud backup exists for this Google account yet.');
        return;
      }

      const snapshotData = snapshot.data();
      const data = snapshotData.data as Record<string, string> | undefined;
      if (!data) throw new Error('Cloud backup is empty.');

      Object.entries(data).forEach(([key, value]) => localStorage.setItem(key, value));

      const restoredAt =
        typeof snapshotData.clientUpdatedAt === 'string'
          ? snapshotData.clientUpdatedAt
          : new Date().toISOString();
      localStorage.setItem(LAST_SYNC_STORAGE_KEY, restoredAt);
      setLastSyncedAt(restoredAt);
      setStatus('success');
      setMessage('Restored. Reloading Inkbound...');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Restore failed.');
    }
  };

  const value = useMemo<AccountSyncContextValue>(
    () => ({
      user,
      isConfigured: isFirebaseConfigured,
      isAuthReady,
      status,
      message,
      lastSyncedAt,
      signInWithGoogle,
      signOutAccount: async () => {
        if (auth) await signOut(auth);
        setStatus('idle');
        setMessage('Signed out. Your local Inkbound data remains on this device.');
      },
      uploadSnapshot,
      restoreSnapshot,
    }),
    [isAuthReady, lastSyncedAt, message, status, user],
  );

  return <AccountSyncContext.Provider value={value}>{children}</AccountSyncContext.Provider>;
};

export const useAccountSync = () => {
  const context = useContext(AccountSyncContext);
  if (!context) throw new Error('useAccountSync must be used within AccountSyncProvider.');
  return context;
};
