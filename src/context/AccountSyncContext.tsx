import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  EmailAuthProvider,
  User,
  createUserWithEmailAndPassword,
  linkWithCredential,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import {
  IMPORT_ENRICHMENT_ACTIVE_RETRY_KEY,
  IMPORT_ENRICHMENT_PAUSED_KEY,
  IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY,
  IMPORT_ENRICHMENT_RETRY_REQUEST_KEY,
  IMPORT_HISTORY_STORAGE_KEY,
} from '../features/import/importHistory';
import { IMPORT_ENRICHMENT_QUEUE_KEY } from '../features/import/libraryEnrichment';
import { flushPhotoMemorySyncQueue, synchronizePhotoMemories } from '../features/memories/photoMemoryCloudSync';
import { clearPhotoMemoriesFromDevice } from '../features/memories/photoMemoryStore';
import { PHOTO_MEMORY_SYNC_QUEUE_KEY } from '../features/memories/photoMemorySyncQueue';
import { synchronizeProfileMedia } from '../features/profile/profileMediaCloudSync';
import { AUXILIARY_ACCOUNT_KEYS, getAuxiliaryBaselineKey, getAuxiliaryPendingKey } from '../features/sync/auxiliaryAccountSyncConfig';
import { flushCloudDataBeforeSignOut } from '../features/sync/cloudSyncEvents';
import {
  LEGACY_SYNC_STORAGE_KEYS,
  SYNC_STORAGE_KEYS,
  accountLibraryMigrationSnapshotKey,
  accountLibraryMigrationVersionKey,
  crossDeviceCursorKey,
  localClearIntentKey,
  syncBaselineStateKey,
  syncPendingStateKey,
} from '../features/sync/storageKeys';
import { auth, functions, isFirebaseConfigured } from '../lib/firebase';
import { prepareRuntimeAuthPersistence, runtimeSupportsAppleSignIn, signInRuntimeWithApple, signInRuntimeWithGoogle } from '../platform/runtimeAuthentication';
import { readRuntimeValue, removeRuntimeValue, writeRuntimeValue } from '../platform/runtimeStorage';

type SyncStatus = 'idle' | 'working' | 'success' | 'error';
interface AccountSyncContextValue { user: User | null; isConfigured: boolean; isAuthReady: boolean; status: SyncStatus; message: string; lastSyncedAt: string | null; canSignInWithApple: boolean; signInWithGoogle: () => Promise<void>; signInWithApple: () => Promise<void>; signInWithEmail: (email: string, password: string) => Promise<void>; createEmailAccount: (email: string, password: string) => Promise<void>; sendPasswordReset: (email: string) => Promise<void>; linkEmailPassword: (email: string, password: string) => Promise<void>; resendVerificationEmail: () => Promise<void>; signOutAccount: () => Promise<void>; uploadSnapshot: () => Promise<void>; restoreSnapshot: () => Promise<void>; }
const AccountSyncContext = createContext<AccountSyncContextValue | undefined>(undefined);
const LAST_SYNC_STORAGE_KEY = SYNC_STORAGE_KEYS.lastCloudSyncAt;
const SIGNED_IN_DATA_KEYS = [
  SYNC_STORAGE_KEYS.books,
  SYNC_STORAGE_KEYS.sessions,
  SYNC_STORAGE_KEYS.profile,
  'inkbound_photo_memories',
  'inkbound_photo_memories_v2',
  'inkbound_photo_memory_cloud_revisions_v1',
  PHOTO_MEMORY_SYNC_QUEUE_KEY,
  IMPORT_HISTORY_STORAGE_KEY,
  IMPORT_ENRICHMENT_QUEUE_KEY,
  IMPORT_ENRICHMENT_PAUSED_KEY,
  IMPORT_ENRICHMENT_RETRY_REQUEST_KEY,
  IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY,
  IMPORT_ENRICHMENT_ACTIVE_RETRY_KEY,
  ...Object.values(AUXILIARY_ACCOUNT_KEYS),
  LEGACY_SYNC_STORAGE_KEYS.books,
  LEGACY_SYNC_STORAGE_KEYS.sessions,
] as const;

function clearSignedInDataFromDevice(uid: string) {
  // Keep the clear-intent flag set while removal events fire so persistence
  // bridges do not interpret sign-out cleanup as a user request to delete the
  // reader's cloud library. signOutAccount removes the flag after Firebase Auth
  // has completed the account transition.
  writeRuntimeValue(localClearIntentKey(uid), '1');
  SIGNED_IN_DATA_KEYS.forEach((key) => removeRuntimeValue(key));
  // Persistence is law: keep the UID-scoped profile media queue across sign-out.
  // If an avatar/banner upload was interrupted, this may be the only recoverable copy.
  removeRuntimeValue(getAuxiliaryPendingKey(uid));
  removeRuntimeValue(getAuxiliaryBaselineKey(uid));
  removeRuntimeValue('inkbound_profile_media_sync_queue_v1');
  removeRuntimeValue(SYNC_STORAGE_KEYS.localOwnerUid);
  removeRuntimeValue(SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid);
  removeRuntimeValue(LAST_SYNC_STORAGE_KEY);
  removeRuntimeValue(syncPendingStateKey(uid));
  removeRuntimeValue(syncBaselineStateKey(uid));
  removeRuntimeValue(crossDeviceCursorKey(uid));
  removeRuntimeValue(accountLibraryMigrationVersionKey(uid));
  removeRuntimeValue(accountLibraryMigrationSnapshotKey(uid));
  // Older beta metadata is cleared too so returning accounts cannot inherit a
  // stale baseline from a pre-v2 build.
  removeRuntimeValue(`inkbound_sync_baseline_${uid}_v1`);
}

function friendlyAuthMessage(error: unknown, fallback: string): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  const rawMessage = error instanceof Error ? error.message.trim() : '';
  const normalized = `${code} ${rawMessage}`.toLowerCase();

  if (code.includes('auth/email-already-in-use')) return 'That email already belongs to an Inkbound account. Sign in instead. If you originally used Google, sign in with Google and add an email login from your account settings.';
  if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password')) return 'The email or password is incorrect.';
  if (code.includes('auth/user-not-found')) return 'No Inkbound account was found for that email.';
  if (code.includes('auth/weak-password')) return 'Choose a stronger password with at least 6 characters.';
  if (code.includes('auth/invalid-email')) return 'Enter a valid email address.';
  if (code.includes('auth/too-many-requests')) return 'Too many attempts. Wait a moment and try again.';
  if (code.includes('auth/provider-already-linked')) return 'Email sign-in is already connected to this account.';
  if (code.includes('auth/credential-already-in-use')) return 'That email login already belongs to another account.';
  if (code.includes('auth/unauthorized-domain')) return 'Google sign-in is not enabled for this Inkbound web address yet. Please use email sign-in for now.';
  if (code.includes('auth/popup-closed-by-user')) return 'Google sign-in was closed before it finished.';
  if (code.includes('auth/popup-blocked')) return 'Your browser blocked the Google sign-in window. Allow pop-ups for Inkbound and try again.';
  if (code.includes('auth/operation-not-allowed')) return 'This sign-in provider is temporarily unavailable. Please use another sign-in method for now.';

  // Android/Google sign-in can surface terse native status codes (for example
  // "10:") instead of a useful Firebase error. Never expose those raw provider
  // strings in the UI; translate known configuration failures and use a safe
  // Inkbound message for everything else.
  if (/^10\s*:?.*$/i.test(rawMessage) || normalized.includes('developer_error') || normalized.includes('developer error')) {
    return 'Google sign-in is not available in this version of Inkbound. Install the latest beta from Google Play and try again.';
  }
  if (normalized.includes('network') || normalized.includes('offline')) {
    return 'Inkbound could not reach Google sign-in. Check your internet connection and try again.';
  }
  if (normalized.includes('cancel') || normalized.includes('canceled')) {
    return 'Google sign-in was canceled.';
  }

  return fallback;
}
async function requestBrandedVerificationEmail(): Promise<void> {
  const current = auth?.currentUser;
  if (!current) throw new Error('Sign in before requesting an email verification link.');
  if (!functions) throw new Error('Inkbound branded email delivery is unavailable right now.');
  await current.getIdToken(true);
  try {
    const callable = httpsCallable<undefined, { success: boolean; alreadyVerified: boolean }>(functions, 'sendVerificationEmail');
    await callable();
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (code === 'functions/unauthenticated') {
      throw new Error('Inkbound could not authenticate the branded email request. Your account is unchanged. Please retry after signing in again; if this continues, the deployed function and App Check attestation must be checked.');
    }
    throw error;
  }
}
async function requestBrandedPasswordResetEmail(email: string): Promise<void> { if (!functions) throw new Error('Email messages are not available right now.'); const callable = httpsCallable<{ email: string }, { success: boolean }>(functions, 'sendPasswordResetEmail'); await callable({ email: email.trim() }); }

export const AccountSyncProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => auth?.currentUser ?? null); const [isAuthReady, setIsAuthReady] = useState(() => !auth || Boolean(auth.currentUser)); const [status, setStatus] = useState<SyncStatus>('idle'); const [message, setMessage] = useState(''); const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => readRuntimeValue(LAST_SYNC_STORAGE_KEY));
  useEffect(() => {
    if (!auth) return;
    let checking = false;
    const verifyRemoteAccount = async () => {
      const current = auth.currentUser;
      if (!current || checking) return;
      checking = true;
      try {
        await current.reload();
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
        // Only an explicit deleted-account response permits local account cleanup.
        // Network, App Check, and temporary token failures must never erase device data.
        if (code === 'auth/user-not-found' && auth.currentUser?.uid === current.uid) {
          await signOut(auth);
          await clearPhotoMemoriesFromDevice();
          clearSignedInDataFromDevice(current.uid);
          setLastSyncedAt(null);
          setStatus('idle');
          setMessage('This Inkbound account was deleted. Its signed-in data has been cleared from this device.');
        }
      } finally {
        checking = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void verifyRemoteAccount();
    };
    document.addEventListener('visibilitychange', onVisible);
    void verifyRemoteAccount();
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  useEffect(() => { if (!auth) return undefined; const unsubscribe = onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setIsAuthReady(true); }, (error) => { console.error('Inkbound Firebase auth state restoration failed.', error); setStatus('error'); setMessage(friendlyAuthMessage(error, 'Inkbound could not sign you back in. Please try again.')); setIsAuthReady(true); }); void prepareRuntimeAuthPersistence(auth).catch((error) => { console.error('Inkbound Firebase auth persistence setup failed.', error); setStatus('error'); setMessage(friendlyAuthMessage(error, 'Inkbound could not keep you signed in on this device.')); }); return unsubscribe; }, []);
  const signInWithGoogle = async () => { if (!auth) { setStatus('error'); setMessage('Sign-in is not available right now.'); return; } try { setStatus('working'); setMessage('Opening Google sign-in...'); await prepareRuntimeAuthPersistence(auth); await signInRuntimeWithGoogle(auth); setStatus('success'); setMessage('Google account connected. Inkbound will remember this account on this device until you sign out.'); } catch (error) { console.error('Inkbound Google sign-in failed.', error); setStatus('error'); setMessage(friendlyAuthMessage(error, 'Google sign-in could not be completed. Please try again.')); } };
  const signInWithApple = async () => { if (!auth) { setStatus('error'); setMessage('Sign-in is not available right now.'); return; } try { setStatus('working'); setMessage('Opening Sign in with Apple...'); await prepareRuntimeAuthPersistence(auth); await signInRuntimeWithApple(auth); setStatus('success'); setMessage('Apple account connected. Inkbound will remember this account on this device until you sign out.'); } catch (error) { console.error('Inkbound Apple sign-in failed.', error); setStatus('error'); setMessage(friendlyAuthMessage(error, 'Sign in with Apple could not be completed. Please try again.')); } };
  const signInWithEmail = async (email: string, password: string) => { if (!auth) return; try { setStatus('working'); setMessage('Signing in...'); await prepareRuntimeAuthPersistence(auth); await signInWithEmailAndPassword(auth, email.trim(), password); setStatus('success'); setMessage('Signed in. Your Inkbound library and reading history are being restored on this device.'); } catch (error) { console.error('Inkbound email sign-in failed.', error); setStatus('error'); setMessage(friendlyAuthMessage(error, 'Email sign-in failed.')); } };
  const createEmailAccount = async (email: string, password: string) => { if (!auth) return; try { setStatus('working'); setMessage('Creating your Inkbound account...'); await prepareRuntimeAuthPersistence(auth); await createUserWithEmailAndPassword(auth, email.trim(), password); await requestBrandedVerificationEmail(); setStatus('success'); setMessage('Account created. Check your inbox to verify your email. Your library and reading history will follow this account across devices.'); } catch (error) { console.error('Inkbound account creation failed.', error); setStatus('error'); setMessage(friendlyAuthMessage(error, 'Inkbound could not create the account.')); } };
  const sendPasswordReset = async (email: string) => { try { setStatus('working'); setMessage('Sending password reset email...'); await requestBrandedPasswordResetEmail(email); setStatus('success'); setMessage('If an Inkbound account uses that email, a password reset message is on its way.'); } catch (error) { setStatus('error'); setMessage(friendlyAuthMessage(error, 'Inkbound could not send the reset email.')); } };
  const linkEmailPassword = async (email: string, password: string) => { if (!auth?.currentUser) { setStatus('error'); setMessage('Sign in first before adding an email login.'); return; } try { setStatus('working'); setMessage('Adding email sign-in to this Inkbound account...'); const credential = EmailAuthProvider.credential(email.trim(), password); const result = await linkWithCredential(auth.currentUser, credential); if (!result.user.emailVerified) await requestBrandedVerificationEmail(); setUser({ ...result.user } as User); setStatus('success'); setMessage('Email sign-in added to this same Inkbound account. Check your inbox to verify the email.'); } catch (error) { setStatus('error'); setMessage(friendlyAuthMessage(error, 'Inkbound could not add email sign-in.')); } };
  const resendVerificationEmail = async () => { if (!auth?.currentUser) return; try { setStatus('working'); await requestBrandedVerificationEmail(); setStatus('success'); setMessage('Verification email sent.'); } catch (error) { setStatus('error'); setMessage(friendlyAuthMessage(error, 'Inkbound could not send the verification email.')); } };
  const synchronizePhotosWithFeedback = async (workingMessage: string) => { if (!user) { setStatus('error'); setMessage('Sign in before updating Photo Memories across devices.'); return; } try { setStatus('working'); setMessage(workingMessage); await synchronizePhotoMemories(user.uid); const syncedAt = new Date().toISOString(); writeRuntimeValue(LAST_SYNC_STORAGE_KEY, syncedAt); setLastSyncedAt(syncedAt); setStatus('success'); setMessage('Your Photo Memories are up to date on your Inkbound devices.'); } catch { setStatus('error'); setMessage('Inkbound could not update Photo Memories right now. It will try again automatically.'); } };
  const uploadSnapshot = async () => synchronizePhotosWithFeedback('Updating Photo Memories...'); const restoreSnapshot = async () => synchronizePhotosWithFeedback('Checking Photo Memories across your devices...');
  const value = useMemo<AccountSyncContextValue>(() => ({ user, isConfigured: isFirebaseConfigured, isAuthReady, status, message, lastSyncedAt, canSignInWithApple: runtimeSupportsAppleSignIn(), signInWithGoogle, signInWithApple, signInWithEmail, createEmailAccount, sendPasswordReset, linkEmailPassword, resendVerificationEmail, signOutAccount: async () => { if (!auth) return; const signingOutUid = user?.uid ?? auth.currentUser?.uid; if (signingOutUid) { setStatus('working'); setMessage('Saving your latest changes before signing out...'); await flushCloudDataBeforeSignOut(signingOutUid); try { await flushPhotoMemorySyncQueue(signingOutUid); } catch (error) { console.warn('Inkbound could not finish the Photo Memories queue before sign-out.', error); } try { await synchronizeProfileMedia(signingOutUid); } catch (error) { console.warn('Inkbound could not finish the profile media queue before sign-out.', error); } await flushCloudDataBeforeSignOut(signingOutUid); } try { await signOut(auth); if (signingOutUid) { await clearPhotoMemoriesFromDevice(); clearSignedInDataFromDevice(signingOutUid); } } finally { if (signingOutUid) removeRuntimeValue(localClearIntentKey(signingOutUid)); } setLastSyncedAt(null); setStatus('idle'); setMessage('Signed out. Account data was removed from this device.'); }, uploadSnapshot, restoreSnapshot }), [isAuthReady, lastSyncedAt, message, status, user]);
  return <AccountSyncContext.Provider value={value}>{children}</AccountSyncContext.Provider>;
};
export const useAccountSync = () => { const context = useContext(AccountSyncContext); if (!context) throw new Error('useAccountSync must be used within AccountSyncProvider.'); return context; };
