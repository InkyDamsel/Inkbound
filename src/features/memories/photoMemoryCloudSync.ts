import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref as storageRef, uploadString } from 'firebase/storage';
import { db, storage } from '../../lib/firebase';
import { readRuntimeJson, writeRuntimeJson } from '../../platform/runtimeStorage';
import {
  PhotoMemoryRecord,
  readPhotoMemoriesFromDevice,
  replacePhotoMemoriesOnDevice,
} from './photoMemoryStore';
import {
  completePhotoMemorySyncOperation,
  PhotoMemorySyncOperation,
  readPhotoMemorySyncQueue,
} from './photoMemorySyncQueue';

interface CloudPhotoMemory {
  caption?: string;
  date?: string;
  location?: string;
  bookId?: string | null;
  createdAt?: string;
  storagePath?: string;
  imageContentType?: string;
  deleted?: boolean;
  syncRevision?: string;
  // Migration-only fallback for older records that embedded base64 in Firestore.
  imageData?: string;
}

const MAX_PHOTO_MEMORY_BYTES = 3 * 1024 * 1024;
const PHOTO_CLOUD_REVISIONS_KEY = 'inkbound_photo_memory_cloud_revisions_v1';

type CloudRevisionMap = Record<string, string>;

function photoStoragePath(uid: string, photoId: string) {
  return `users/${uid}/photo-memories/${photoId}`;
}

function getDataUrlContentType(value: string): string {
  return /^data:([^;,]+)/i.exec(value)?.[1] ?? 'image/jpeg';
}

function bytesToDataUrl(bytes: Uint8Array, contentType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('A synced photo could not be restored.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(new Blob([bytes], { type: contentType || 'image/jpeg' }));
  });
}

function createSyncRevision() {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

async function uploadPhoto(uid: string, photo: PhotoMemoryRecord): Promise<string> {
  if (!db || !storage) throw new Error('Photo sync is not configured for this Inkbound deployment.');
  const path = photoStoragePath(uid, photo.id);
  const imageContentType = getDataUrlContentType(photo.imageData);
  const syncRevision = createSyncRevision();
  await uploadString(storageRef(storage, path), photo.imageData, 'data_url', { contentType: imageContentType });
  await setDoc(doc(collection(db, 'users', uid, 'photoMemories'), photo.id), {
    caption: photo.caption,
    date: photo.date,
    location: photo.location,
    bookId: photo.bookId ?? null,
    createdAt: photo.createdAt,
    storagePath: path,
    imageContentType,
    deleted: false,
    syncRevision,
    updatedAt: serverTimestamp(),
  });
  return syncRevision;
}

async function deletePhoto(uid: string, photoId: string) {
  if (!db) throw new Error('Photo sync is not configured for this Inkbound deployment.');
  const path = photoStoragePath(uid, photoId);
  if (storage) {
    try {
      await deleteObject(storageRef(storage, path));
    } catch {
      // Missing media is already equivalent to a completed delete.
    }
  }
  // Keep a small tombstone so another device with stale local data cannot resurrect
  // a memory that was intentionally deleted elsewhere.
  await setDoc(doc(collection(db, 'users', uid, 'photoMemories'), photoId), {
    deleted: true,
    storagePath: path,
    syncRevision: createSyncRevision(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

function updateStoredRevision(id: string, revision?: string) {
  const revisions = readRuntimeJson<CloudRevisionMap>(PHOTO_CLOUD_REVISIONS_KEY, {});
  if (revision) revisions[id] = revision;
  else delete revisions[id];
  writeRuntimeJson(PHOTO_CLOUD_REVISIONS_KEY, revisions);
}

async function applyOperation(uid: string, operation: PhotoMemorySyncOperation) {
  const localPhotos = await readPhotoMemoriesFromDevice();
  const localPhoto = localPhotos.find((photo) => photo.id === operation.id);

  if (operation.type === 'delete' || !localPhoto) {
    await deletePhoto(uid, operation.id);
    updateStoredRevision(operation.id);
  } else {
    const revision = await uploadPhoto(uid, localPhoto);
    updateStoredRevision(operation.id, revision);
  }

  completePhotoMemorySyncOperation(operation);
}

export async function flushPhotoMemorySyncQueue(uid: string): Promise<void> {
  if (!uid) return;
  for (const operation of readPhotoMemorySyncQueue()) {
    await applyOperation(uid, operation);
  }
}

async function hydrateCloudPhoto(id: string, photo: CloudPhotoMemory): Promise<PhotoMemoryRecord | null> {
  if (photo.deleted) return null;
  if (!photo.date || !photo.createdAt) return null;

  let imageData = photo.imageData ?? '';
  if (photo.storagePath && storage) {
    try {
      const bytes = await getBytes(storageRef(storage, photo.storagePath), MAX_PHOTO_MEMORY_BYTES);
      imageData = await bytesToDataUrl(bytes, photo.imageContentType ?? 'image/jpeg');
    } catch {
      // Keep a local or legacy copy instead of dropping the memory on a temporary
      // Storage/network failure. Reconciliation supplies the local fallback below.
    }
  }
  if (!imageData) return null;

  return {
    id,
    imageData,
    caption: photo.caption ?? '',
    date: photo.date,
    location: photo.location ?? '',
    bookId: photo.bookId || undefined,
    createdAt: photo.createdAt,
  };
}

async function reconcileWithCloud(uid: string) {
  if (!db) throw new Error('Photo sync is not configured for this Inkbound deployment.');

  const localPhotos = await readPhotoMemoriesFromDevice();
  const localById = new Map(localPhotos.map((photo) => [photo.id, photo]));
  const storedRevisions = readRuntimeJson<CloudRevisionMap>(PHOTO_CLOUD_REVISIONS_KEY, {});
  const nextRevisions: CloudRevisionMap = {};
  const snapshot = await getDocs(collection(db, 'users', uid, 'photoMemories'));
  const cloudIds = new Set(snapshot.docs.map((item) => item.id));
  const tombstonedIds = new Set<string>();
  const nextPhotos: PhotoMemoryRecord[] = [];

  for (const photoDocument of snapshot.docs) {
    const cloudPhoto = photoDocument.data() as CloudPhotoMemory;
    if (cloudPhoto.deleted) {
      tombstonedIds.add(photoDocument.id);
      continue;
    }

    const localPhoto = localById.get(photoDocument.id);
    if (localPhoto && cloudPhoto.syncRevision && storedRevisions[photoDocument.id] === cloudPhoto.syncRevision) {
      nextPhotos.push(localPhoto);
      nextRevisions[photoDocument.id] = cloudPhoto.syncRevision;
      continue;
    }

    const hydrated = await hydrateCloudPhoto(photoDocument.id, cloudPhoto);
    if (hydrated) {
      nextPhotos.push(hydrated);
      if (cloudPhoto.syncRevision) nextRevisions[photoDocument.id] = cloudPhoto.syncRevision;
      continue;
    }

    if (localPhoto) {
      nextPhotos.push(localPhoto);
      if (storedRevisions[photoDocument.id]) nextRevisions[photoDocument.id] = storedRevisions[photoDocument.id];
    }
  }

  // Migration path for local-only memories created before automatic sync existed.
  // Tombstones always win so deleted memories cannot be resurrected by stale devices.
  for (const localPhoto of localPhotos) {
    if (cloudIds.has(localPhoto.id) || tombstonedIds.has(localPhoto.id)) continue;
    const revision = await uploadPhoto(uid, localPhoto);
    nextRevisions[localPhoto.id] = revision;
    nextPhotos.push(localPhoto);
  }

  await replacePhotoMemoriesOnDevice(nextPhotos);
  writeRuntimeJson(PHOTO_CLOUD_REVISIONS_KEY, nextRevisions);
}

export async function synchronizePhotoMemories(uid: string): Promise<void> {
  if (!uid) return;
  await flushPhotoMemorySyncQueue(uid);
  await reconcileWithCloud(uid);
}

export { PHOTO_CLOUD_REVISIONS_KEY };
