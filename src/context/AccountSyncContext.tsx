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
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
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

interface StoredPhotoMemory {
  id: string;
  imageData: string;
  caption: string;
  date: string;
  location: string;
  bookId?: string;
  createdAt: string;
}

const AccountSyncContext = createContext<AccountSyncContextValue | undefined>(undefined);
const LAST_SYNC_STORAGE_KEY = 'inkbound_last_cloud_sync_at';
const PHOTO_MEMORIES_STORAGE_KEY = 'inkbound_photo_memories';

function readPhotoMemories(): StoredPhotoMemory[] {
  try {
    const stored = localStorage.getItem(PHOTO_MEMORIES_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as StoredPhotoMemory[]) : [];
  } catch {
    return [];
  }
}

export const AccountSyncProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(!auth);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [message, setMessage] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => localStorage.getItem(LAST_SYNC_STORAGE_KEY));

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
        setMessage(error instanceof Error ? error.message : 'Inkbound could not restore the saved Google session.');
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
      setMessage('Google account connected. Inkbound will remember this account on this browser until you sign out.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Google sign-in failed.');
    }
  };

  // Kept under the legacy method name for compatibility with older UI code.
  // Books and sessions are intentionally excluded: CloudPersistenceBridge is
  // now their only synchronization path, preventing whole-device overwrites.
  const uploadSnapshot = async () => {
    if (!user || !db) {
      setStatus('error');
      setMessage('Sign in with Google before syncing account extras.');
      return;
    }
    try {
      setStatus('working');
      setMessage('Backing up photo memories...');
      const syncedAt = new Date().toISOString();
      const localPhotos = readPhotoMemories();
      const photoCollection = collection(db, 'users', user.uid, 'photoMemories');
      const cloudPhotos = await getDocs(photoCollection);
      const localIds = new Set(localPhotos.map((photo) => photo.id));

      await Promise.all(
        cloudPhotos.docs
          .filter((photoDocument) => !localIds.has(photoDocument.id))
          .map((photoDocument) => deleteDoc(photoDocument.ref)),
      );
      await Promise.all(
        localPhotos.map((photo) =>
          setDoc(
            doc(photoCollection, photo.id),
            { ...photo, updatedAt: serverTimestamp() },
            { merge: true },
          ),
        ),
      );

      localStorage.setItem(LAST_SYNC_STORAGE_KEY, syncedAt);
      setLastSyncedAt(syncedAt);
      setStatus('success');
      setMessage('Photo memories backed up. Books and reading sessions sync automatically record by record.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Photo-memory backup failed.');
    }
  };

  // Legacy compatibility method. It restores photo memories only and never
  // replaces local books, sessions, preferences, or the active library.
  const restoreSnapshot = async () => {
    if (!user || !db) {
      setStatus('error');
      setMessage('Sign in with Google before restoring account extras.');
      return;
    }
    try {
      setStatus('working');
      setMessage('Restoring photo memories...');
      const photoSnapshot = await getDocs(collection(db, 'users', user.uid, 'photoMemories'));
      const restoredPhotos = photoSnapshot.docs.map((photoDocument) => {
        const photo = photoDocument.data() as StoredPhotoMemory;
        return {
          id: photoDocument.id,
          imageData: photo.imageData,
          caption: photo.caption ?? '',
          date: photo.date,
          location: photo.location ?? '',
          bookId: photo.bookId,
          createdAt: photo.createdAt,
        } satisfies StoredPhotoMemory;
      });
      localStorage.setItem(PHOTO_MEMORIES_STORAGE_KEY, JSON.stringify(restoredPhotos));

      const restoredAt = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_STORAGE_KEY, restoredAt);
      setLastSyncedAt(restoredAt);
      setStatus('success');
      setMessage('Photo memories restored. Books and reading sessions already sync automatically.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Photo-memory restore failed.');
    }
  };

  const value = useMemo<AccountSyncContextValue>(() => ({
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
  }), [isAuthReady, lastSyncedAt, message, status, user]);

  return <AccountSyncContext.Provider value={value}>{children}</AccountSyncContext.Provider>;
};

export const useAccountSync = () => {
  const context = useContext(AccountSyncContext);
  if (!context) throw new Error('useAccountSync must be used within AccountSyncProvider.');
  return context;
};
