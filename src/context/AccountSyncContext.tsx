import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  EmailAuthProvider,
  User,
  createUserWithEmailAndPassword,
  linkWithCredential,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { flushCloudDataBeforeSignOut } from '../features/sync/cloudSyncEvents';
import { auth, db, isFirebaseConfigured } from '../lib/firebase';
import {
  prepareRuntimeAuthPersistence,
  signInRuntimeWithGoogle,
} from '../platform/runtimeAuthentication';
import {
  readRuntimeJson,
  readRuntimeValue,
  removeRuntimeValue,
  writeRuntimeJson,
  writeRuntimeValue,
} from '../platform/runtimeStorage';

type SyncStatus = 'idle' | 'working' | 'success' | 'error';

interface AccountSyncContextValue {
  user: User | null;
  isConfigured: boolean;
  isAuthReady: boolean;
  status: SyncStatus;
  message: string;
  lastSyncedAt: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  createEmailAccount: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  linkEmailPassword: (email: string, password: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
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
const SIGNED_IN_DATA_KEYS = [
  'inkbound_books',
  'inkbound_sessions',
  'inkbound_reader_profile',
  'inkbound_photo_memories',
  'inkbound_import_enrichment_queue_v1',
  'bookhaven_books',
  'bookhaven_sessions',
] as const;

function clearSignedInDataFromDevice(uid: string) {
  writeRuntimeValue(`inkbound_local_clear_intent_${uid}`, '1');
  SIGNED_IN_DATA_KEYS.forEach((key) => removeRuntimeValue(key));
  removeRuntimeValue('inkbound_local_data_owner_uid');
  removeRuntimeValue(LAST_SYNC_STORAGE_KEY);
  removeRuntimeValue(`inkbound_pending_sync_${uid}_v1`);
  removeRuntimeValue(`inkbound_sync_baseline_${uid}_v1`);
}

function readPhotoMemories(): StoredPhotoMemory[] {
  return readRuntimeJson<StoredPhotoMemory[]>(PHOTO_MEMORIES_STORAGE_KEY, []);
}

function friendlyAuthMessage(error: unknown, fallback: string): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (code.includes('auth/email-already-in-use')) {
    return 'That email already belongs to an Inkbound account. Sign in instead. If you originally used Google, sign in with Google and add an email password from Account Sync.';
  }
  if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password')) {
    return 'The email or password is incorrect.';
  }
  if (code.includes('auth/user-not-found')) return 'No Inkbound account was found for that email.';
  if (code.includes('auth/weak-password')) return 'Choose a stronger password with at least 6 characters.';
  if (code.includes('auth/invalid-email')) return 'Enter a valid email address.';
  if (code.includes('auth/too-many-requests')) return 'Too many attempts. Wait a moment and try again.';
  if (code.includes('auth/provider-already-linked')) return 'Email/password sign-in is already connected to this account.';
  if (code.includes('auth/credential-already-in-use')) return 'That email/password credential already belongs to another account.';
  return error instanceof Error ? error.message : fallback;
}

export const AccountSyncProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => auth?.currentUser ?? null);
  const [isAuthReady, setIsAuthReady] = useState(() => !auth || Boolean(auth.currentUser));
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [message, setMessage] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => readRuntimeValue(LAST_SYNC_STORAGE_KEY));

  useEffect(() => {
    if (!auth) return undefined;

    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setIsAuthReady(true);
      },
      (error) => {
        setStatus('error');
        setMessage(error.message || 'Inkbound could not restore the saved account session.');
        setIsAuthReady(true);
      },
    );

    void prepareRuntimeAuthPersistence(auth).catch((error) => {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Inkbound could not enable persistent sign-in on this device.');
    });

    return unsubscribe;
  }, []);

  const signInWithGoogle = async () => {
    if (!auth) {
      setStatus('error');
      setMessage('Account sign-in is not configured yet.');
      return;
    }
    try {
      setStatus('working');
      setMessage('Opening Google sign-in...');
      await prepareRuntimeAuthPersistence(auth);
      await signInRuntimeWithGoogle(auth);
      setStatus('success');
      setMessage('Google account connected. Inkbound will remember this account on this device until you sign out.');
    } catch (error) {
      setStatus('error');
      setMessage(friendlyAuthMessage(error, 'Google sign-in failed.'));
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    if (!auth) return;
    try {
      setStatus('working');
      setMessage('Signing in...');
      await prepareRuntimeAuthPersistence(auth);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setStatus('success');
      setMessage('Signed in. Your Inkbound account and library are restoring on this device.');
    } catch (error) {
      setStatus('error');
      setMessage(friendlyAuthMessage(error, 'Email sign-in failed.'));
    }
  };

  const createEmailAccount = async (email: string, password: string) => {
    if (!auth) return;
    try {
      setStatus('working');
      setMessage('Creating your Inkbound account...');
      await prepareRuntimeAuthPersistence(auth);
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await sendEmailVerification(credential.user);
      setStatus('success');
      setMessage('Account created. Check your inbox to verify your email. Your library will follow this account across devices.');
    } catch (error) {
      setStatus('error');
      setMessage(friendlyAuthMessage(error, 'Inkbound could not create the account.'));
    }
  };

  const sendPasswordReset = async (email: string) => {
    if (!auth) return;
    try {
      setStatus('working');
      setMessage('Sending password reset email...');
      await sendPasswordResetEmail(auth, email.trim());
      setStatus('success');
      setMessage('Password reset email sent. Check your inbox.');
    } catch (error) {
      setStatus('error');
      setMessage(friendlyAuthMessage(error, 'Inkbound could not send the reset email.'));
    }
  };

  const linkEmailPassword = async (email: string, password: string) => {
    if (!auth?.currentUser) {
      setStatus('error');
      setMessage('Sign in first before adding an email/password login.');
      return;
    }
    try {
      setStatus('working');
      setMessage('Adding email/password sign-in to this Inkbound account...');
      const credential = EmailAuthProvider.credential(email.trim(), password);
      const result = await linkWithCredential(auth.currentUser, credential);
      if (!result.user.emailVerified) await sendEmailVerification(result.user);
      setUser({ ...result.user } as User);
      setStatus('success');
      setMessage('Email/password sign-in added to this same Inkbound account. Check your inbox to verify the email.');
    } catch (error) {
      setStatus('error');
      setMessage(friendlyAuthMessage(error, 'Inkbound could not add email/password sign-in.'));
    }
  };

  const resendVerificationEmail = async () => {
    if (!auth?.currentUser) return;
    try {
      setStatus('working');
      await sendEmailVerification(auth.currentUser);
      setStatus('success');
      setMessage('Verification email sent.');
    } catch (error) {
      setStatus('error');
      setMessage(friendlyAuthMessage(error, 'Inkbound could not send the verification email.'));
    }
  };

  const uploadSnapshot = async () => {
    if (!user || !db) {
      setStatus('error');
      setMessage('Sign in before syncing account extras.');
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

      await Promise.all(cloudPhotos.docs.filter((photoDocument) => !localIds.has(photoDocument.id)).map((photoDocument) => deleteDoc(photoDocument.ref)));
      await Promise.all(localPhotos.map((photo) => setDoc(doc(photoCollection, photo.id), { ...photo, updatedAt: serverTimestamp() }, { merge: true })));

      writeRuntimeValue(LAST_SYNC_STORAGE_KEY, syncedAt);
      setLastSyncedAt(syncedAt);
      setStatus('success');
      setMessage('Photo memories backed up. Books and reading sessions sync automatically record by record.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Photo-memory backup failed.');
    }
  };

  const restoreSnapshot = async () => {
    if (!user || !db) {
      setStatus('error');
      setMessage('Sign in before restoring account extras.');
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
      writeRuntimeJson(PHOTO_MEMORIES_STORAGE_KEY, restoredPhotos);

      const restoredAt = new Date().toISOString();
      writeRuntimeValue(LAST_SYNC_STORAGE_KEY, restoredAt);
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
    signInWithEmail,
    createEmailAccount,
    sendPasswordReset,
    linkEmailPassword,
    resendVerificationEmail,
    signOutAccount: async () => {
      if (!auth) return;
      const signingOutUid = user?.uid ?? auth.currentUser?.uid;
      if (signingOutUid) {
        setStatus('working');
        setMessage('Saving your latest changes before signing out...');
        try {
          await flushCloudDataBeforeSignOut(signingOutUid);
        } catch {
          // Pending mutations remain durable and will retry on a later signed-in session.
        }
        clearSignedInDataFromDevice(signingOutUid);
      }
      await signOut(auth);
      setLastSyncedAt(null);
      setStatus('idle');
      setMessage('Signed out. Account data was removed from this device.');
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
