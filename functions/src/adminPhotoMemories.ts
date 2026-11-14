import { getFirestore } from 'firebase-admin/firestore';
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
