import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';

export const inspectAdminPhotoMemories = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const admin = (await db.doc(`admins/${request.auth.uid}`).get()).data();
  if (!admin?.enabled || admin.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Owner access required.');
  }
  const input = request.data as { targetUserId?: unknown } | undefined;
  const targetUserId = input?.targetUserId;
  if (typeof targetUserId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(targetUserId)) {
    throw new HttpsError('invalid-argument', 'Valid reader ID required.');
  }
  const documents = await db.collection(`users/${targetUserId}/photoMemories`).limit(500).get();
  const bucket = getStorage().bucket();
  const items = await Promise.all(documents.docs.map(async (document) => {
    const data = document.data();
    const storagePath = typeof data.storagePath === 'string' ? data.storagePath : '';
    let imageStatus: 'present' | 'missing' | 'unknown' = 'unknown';
    if (storagePath) {
      try {
        imageStatus = (await bucket.file(storagePath).exists())[0] ? 'present' : 'missing';
      } catch {
        imageStatus = 'unknown';
      }
    }
    return {
      id: document.id,
      date: typeof data.date === 'string' ? data.date : '',
      caption: typeof data.caption === 'string' ? data.caption.slice(0, 240) : '',
      bookId: typeof data.bookId === 'string' ? data.bookId : '',
      deleted: data.deleted === true,
      storagePath,
      imageStatus,
    };
  }));
  return { items, truncated: documents.size === 500 };
});

/** Restore only a soft-deleted original whose Storage image still exists.
 * Never overwrite an active record or manufacture missing media. */
export const restoreAdminPhotoMemory = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const db = getFirestore();
  const admin = (await db.doc(`admins/${request.auth.uid}`).get()).data();
  if (!admin?.enabled || admin.role !== 'owner') throw new HttpsError('permission-denied', 'Owner access required.');
  const input = request.data as { targetUserId?: unknown; memoryId?: unknown; reason?: unknown; confirmation?: unknown } | undefined;
  const uid = input?.targetUserId;
  const id = input?.memoryId;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new HttpsError('invalid-argument', 'Valid reader and memory IDs required.');
  }
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 10 || reason.length > 1000 || input?.confirmation !== 'RESTORE') {
    throw new HttpsError('failed-precondition', 'Enter a reason (at least 10 characters) and type RESTORE.');
  }
  const ref = db.doc(`users/${uid}/photoMemories/${id}`);
  const before = await ref.get();
  if (!before.exists) throw new HttpsError('not-found', 'The original photo record does not exist. No changes made.');
  const data = before.data() ?? {};
  if (data.deleted !== true) throw new HttpsError('failed-precondition', 'This photo is already active. Use device/cloud refresh to recover visibility.');
  const storagePath = typeof data.storagePath === 'string' ? data.storagePath : '';
  if (!storagePath || !storagePath.startsWith(`users/${uid}/photo-memories/`)) {
    throw new HttpsError('failed-precondition', 'The original image path is missing or outside this reader account.');
  }
  if (!(await getStorage().bucket().file(storagePath).exists())[0]) {
    throw new HttpsError('failed-precondition', 'The original image is missing from Storage. No changes made.');
  }
  // Transaction protects against concurrent changes and never overwrites a live record.
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.data()?.deleted !== true ||
        current.data()?.storagePath !== storagePath) {
      throw new HttpsError('aborted', 'The photo changed during recovery. Inspect it again.');
    }
    tx.update(ref, { deleted: false, syncRevision: `admin-restore-${Date.now()}-${id}`, updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.collection('adminAudit').doc(), {
      action: 'restore_photo_memory', targetUserId: uid, memoryId: id,
      performedBy: request.auth!.uid, performedByEmail: admin.email ?? '',
      reason, previousValue: { deleted: true, storagePath },
      newValue: { deleted: false, storagePath },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { success: true, memoryId: id };
});
