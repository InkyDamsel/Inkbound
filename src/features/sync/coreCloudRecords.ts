import { deleteDoc, doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export type CoreCloudRecordKind = 'books' | 'sessions';

export async function upsertCoreCloudRecord<T extends { id: string }>(
  uid: string,
  kind: CoreCloudRecordKind,
  record: T,
  clientUpdatedAt: string,
): Promise<void> {
  if (!db) throw new Error('Cloud persistence is unavailable.');
  await setDoc(doc(db, 'users', uid, kind, record.id), {
    data: record,
    updatedAt: serverTimestamp(),
    clientUpdatedAt,
  }, { merge: true });
}

/**
 * Canonical durable delete contract for core user records.
 *
 * The record deletion and its tombstone are committed together so cross-device
 * reconciliation can never observe a deletion without durable delete intent.
 */
export async function deleteCoreCloudRecord(
  uid: string,
  kind: CoreCloudRecordKind,
  recordId: string,
  clientUpdatedAt: string,
): Promise<void> {
  if (!db) throw new Error('Cloud persistence is unavailable.');
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', uid, kind, recordId));
  batch.set(doc(db, 'users', uid, 'syncTombstones', `${kind}_${recordId}`), {
    kind,
    recordId,
    clientUpdatedAt,
    deletedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
}
