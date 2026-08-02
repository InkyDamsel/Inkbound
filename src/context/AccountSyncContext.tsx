import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../lib/firebase';

type SyncStatus = 'idle' | 'working' | 'success' | 'error';

interface AccountSyncContextValue {
  user: User | null;
  isConfigured: boolean;
  status: SyncStatus;
  message: string;
  signInWithGoogle: () => Promise<void>;
  signOutAccount: () => Promise<void>;
  uploadSnapshot: () => Promise<void>;
  restoreSnapshot: () => Promise<void>;
}

const AccountSyncContext = createContext<AccountSyncContextValue | undefined>(undefined);

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
] as const;

const collectSnapshot = () =>
  Object.fromEntries(
    SYNC_KEYS.map((key) => [key, localStorage.getItem(key)]).filter(([, value]) => value !== null),
  );

export const AccountSyncProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!auth) return undefined;
    return onAuthStateChanged(auth, setUser);
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
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      setStatus('success');
      setMessage('Google account connected. You can now sync or restore your Inkbound data.');
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
      await setDoc(
        doc(db, 'users', user.uid, 'sync', 'current'),
        {
          data: collectSnapshot(),
          provider: 'google',
          updatedAt: serverTimestamp(),
          version: 1,
        },
        { merge: true },
      );
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

      const data = snapshot.data().data as Record<string, string> | undefined;
      if (!data) throw new Error('Cloud backup is empty.');

      Object.entries(data).forEach(([key, value]) => localStorage.setItem(key, value));
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
      status,
      message,
      signInWithGoogle,
      signOutAccount: async () => {
        if (auth) await signOut(auth);
        setStatus('idle');
        setMessage('');
      },
      uploadSnapshot,
      restoreSnapshot,
    }),
    [message, status, user],
  );

  return <AccountSyncContext.Provider value={value}>{children}</AccountSyncContext.Provider>;
};

export const useAccountSync = () => {
  const context = useContext(AccountSyncContext);
  if (!context) throw new Error('useAccountSync must be used within AccountSyncProvider.');
  return context;
};
