import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { auth as authV1 } from 'firebase-functions/v1';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function profileData(value: Record<string, unknown>): Record<string, unknown> {
  return asRecord('data' in value ? value.data : value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function removeInkboundDataForUid(uid: string) {
  await Promise.all([
    db.recursiveDelete(db.doc(`users/${uid}`)),
    db.doc(`userDirectory/${uid}`).delete(),
    db.doc(`entitlements/${uid}`).delete(),
    db.doc(`admins/${uid}`).delete(),
  ]);

  await bucket.deleteFiles({ prefix: `users/${uid}/` }).catch((error: unknown) => {
    console.warn(`Could not remove every Storage object for deleted Firebase user ${uid}.`, error);
  });
}

async function canonicalDirectoryRecord(user: UserRecord) {
  const [profileSnapshot, directorySnapshot] = await Promise.all([
    db.doc(`users/${user.uid}/profile/current`).get(),
    db.doc(`userDirectory/${user.uid}`).get(),
  ]);

  const profile = profileData(profileSnapshot.data() ?? {});
  const existing = directorySnapshot.data() ?? {};

  const displayName = text(profile.displayName)
    || text(user.displayName)
    || text(existing.displayName);
  const photoUrl = text(profile.avatarImage)
    || text(user.photoURL)
    || text(existing.photoUrl);

  return {
    uid: user.uid,
    email: text(user.email).toLowerCase(),
    displayName,
    photoUrl,
    emailVerified: user.emailVerified,
    authProviderIds: user.providerData.map((provider) => provider.providerId),
    updatedAt: FieldValue.serverTimestamp(),
    ...(directorySnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };
}

async function upsertCanonicalDirectoryForUid(uid: string) {
  let user: UserRecord;
  try {
    user = await auth.getUser(uid);
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (code === 'auth/user-not-found') {
      await removeInkboundDataForUid(uid);
      return;
    }
    throw error;
  }

  const record = await canonicalDirectoryRecord(user);
  await db.doc(`userDirectory/${uid}`).set(record, { merge: true });
}

async function listAllAuthUsers(): Promise<UserRecord[]> {
  const users: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

/**
 * Firebase Auth is the canonical account list. When an Auth account is deleted
 * manually or by any other workflow, remove the matching Inkbound records too.
 */
export const cleanupInkboundAfterAuthDelete = authV1.user().onDelete(async (user) => {
  await removeInkboundDataForUid(user.uid);
});

/**
 * Profile is the canonical source for the reader-entered name/photo. Keep the
 * admin directory derived from it so "Unnamed reader" is only a true fallback.
 */
export const syncReaderDirectoryFromProfile = onDocumentWritten(
  'users/{uid}/profile/current',
  async (event) => {
    const uid = event.params.uid;
    await upsertCanonicalDirectoryForUid(uid);
  },
);

/**
 * Safety net for accounts deleted directly in Firebase Auth before the delete
 * trigger existed, plus any directory drift. Runs hourly and is idempotent.
 */
export const reconcileReaderDirectory = onSchedule('every 1 hours', async () => {
  const [authUsers, directorySnapshot, entitlementsSnapshot] = await Promise.all([
    listAllAuthUsers(),
    db.collection('userDirectory').get(),
    db.collection('entitlements').get(),
  ]);

  const authByUid = new Map(authUsers.map((user) => [user.uid, user]));
  const staleUids = new Set<string>();

  directorySnapshot.docs.forEach((document) => {
    if (!authByUid.has(document.id)) staleUids.add(document.id);
  });
  entitlementsSnapshot.docs.forEach((document) => {
    if (!authByUid.has(document.id)) staleUids.add(document.id);
  });

  await Promise.all([...staleUids].map((uid) => removeInkboundDataForUid(uid)));

  for (const user of authUsers) {
    const record = await canonicalDirectoryRecord(user);
    await db.doc(`userDirectory/${user.uid}`).set(record, { merge: true });
  }

  console.info('Inkbound reader directory reconciliation complete.', {
    authUsers: authUsers.length,
    staleUsersRemoved: staleUids.size,
  });
});
