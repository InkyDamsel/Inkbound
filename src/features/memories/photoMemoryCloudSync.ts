import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref as storageRef, uploadString } from 'firebase/storage';
import { db, storage } from '../../lib/firebase';
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
  // Migration-only fallback for older records that embedded base64 in Firestore.
  imageData?: string;
}

const MAX_PHOTO_MEMORY_BYTES = 3 * 1024 * 1024;

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

async function uploadPhoto(uid: string, photo: PhotoMemoryRecord) {
  if (!db || !storage) throw new Error('Photo sync is not configured for this Inkbound deployment.');
  const path = photoStoragePath(uid, photo.id);
  const imageContentType = getDataUrlContentType(photo.imageData);
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
    updatedAt: serverTimestamp(),
  });
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
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

async function applyOperation(uid: string, operation: PhotoMemorySyncOperation) {
  const localPhotos = await readPhotoMemoriesFromDevice();
  const localPhoto = localPhotos.find((photo) => photo.id === operation.id);

  if (operation.type === 'delete' || !localPhoto) {
    await deletePhoto(uid, operation.id);
  } else {
    await uploadPhoto(uid, localPhoto);
  }

  completePhotoMemorySyncOperation(operation);
}

async function pushPendingOperations(uid: string) {
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
    const hydrated = await hydrateCloudPhoto(photoDocument.id, cloudPhoto);
    if (hydrated) {
      nextPhotos.push(hydrated);
      continue;
    }
    const localFallback = localById.get(photoDocument.id);
    if (localFallback) nextPhotos.push(localFallback);
  }

  // Migration path for local-only memories created before automatic sync existed.
  // Tombstones always win so deleted memories cannot be resurrected by stale devices.
  for (const localPhoto of localPhotos) {
    if (cloudIds.has(localPhoto.id) || tombstonedIds.has(localPhoto.id)) continue;
    await uploadPhoto(uid, localPhoto);
    nextPhotos.push(localPhoto);
  }

  await replacePhotoMemoriesOnDevice(nextPhotos);
}

export async function synchronizePhotoMemories(uid: string): Promise<void> {
  if (!uid) return;
  await pushPendingOperations(uid);
  await reconcileWithCloud(uid);
}
