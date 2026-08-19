import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import { readRuntimeJson, removeRuntimeValue, writeRuntimeJson } from '../../platform/runtimeStorage';
import { notifyLocalDataChanged } from '../sync/cloudSyncEvents';
import {
  dataUrlToBlob,
  getProfileMediaKey,
  readProfileMedia,
  removeProfileMedia,
  storeProfileMedia,
  type ProfileMediaKind,
} from './profileMedia';

const PROFILE_STORAGE_KEY = 'inkbound_reader_profile';
const LEGACY_PROFILE_MEDIA_SYNC_QUEUE_KEY = 'inkbound_profile_media_sync_queue_v1';

interface ProfileMediaQueueItem {
  kind: ProfileMediaKind;
  mediaKey: string;
  queuedAt: string;
}

type ProfileMediaQueue = Partial<Record<ProfileMediaKind, ProfileMediaQueueItem>>;

interface SyncableProfile {
  avatarImage?: string;
  bannerImage?: string;
  // Legacy fields are kept only long enough to migrate existing installs.
  avatarImageData?: string;
  bannerImageData?: string;
  avatarMediaKey?: string;
  bannerMediaKey?: string;
  [key: string]: unknown;
}

const profileMediaSyncInFlight = new Map<string, Promise<void>>();

export function getProfileMediaSyncQueueKey(uid: string): string {
  return `inkbound_profile_media_sync_queue_${uid}_v1`;
}

function readQueue(uid: string): ProfileMediaQueue {
  const accountQueue = readRuntimeJson<ProfileMediaQueue>(getProfileMediaSyncQueueKey(uid), {});
  if (Object.keys(accountQueue).length > 0) return accountQueue;

  // This key existed briefly during development before queues became account
  // scoped. Absorb it once so local test data does not become stranded.
  const legacyQueue = readRuntimeJson<ProfileMediaQueue>(LEGACY_PROFILE_MEDIA_SYNC_QUEUE_KEY, {});
  if (Object.keys(legacyQueue).length > 0) {
    writeRuntimeJson(getProfileMediaSyncQueueKey(uid), legacyQueue);
    removeRuntimeValue(LEGACY_PROFILE_MEDIA_SYNC_QUEUE_KEY);
    return legacyQueue;
  }
  return {};
}

function writeQueue(uid: string, queue: ProfileMediaQueue) {
  const key = getProfileMediaSyncQueueKey(uid);
  if (Object.keys(queue).length === 0) {
    removeRuntimeValue(key);
    return;
  }
  writeRuntimeJson(key, queue);
}

export function enqueueProfileMediaSync(uid: string, kind: ProfileMediaKind, mediaKey: string) {
  const queue = readQueue(uid);
  queue[kind] = { kind, mediaKey, queuedAt: new Date().toISOString() };
  writeQueue(uid, queue);
}

async function queueLegacyProfileMedia(uid: string, profile: SyncableProfile) {
  const migrations: Array<Promise<void>> = [];

  if (profile.avatarImageData?.startsWith('data:image/')) {
    migrations.push((async () => {
      const blob = await dataUrlToBlob(profile.avatarImageData!);
      const mediaKey = await storeProfileMedia(uid, 'avatar', blob);
      enqueueProfileMediaSync(uid, 'avatar', mediaKey);
    })());
  }

  if (profile.bannerImageData?.startsWith('data:image/')) {
    migrations.push((async () => {
      const blob = await dataUrlToBlob(profile.bannerImageData!);
      const mediaKey = await storeProfileMedia(uid, 'banner', blob);
      enqueueProfileMediaSync(uid, 'banner', mediaKey);
    })());
  }

  if (migrations.length > 0) await Promise.all(migrations);
}

export async function storeAndQueueProfileMedia(
  uid: string,
  kind: ProfileMediaKind,
  blob: Blob,
): Promise<string> {
  const mediaKey = await storeProfileMedia(uid, kind, blob);
  enqueueProfileMediaSync(uid, kind, mediaKey);
  return mediaKey;
}

function versionedProfileMediaPath(uid: string, item: ProfileMediaQueueItem): string {
  const version = item.queuedAt.replace(/[^0-9A-Za-z]/g, '');
  return `users/${uid}/profile/${item.kind}-${version || Date.now()}.webp`;
}

async function runProfileMediaSynchronization(uid: string): Promise<void> {
  const profile = readRuntimeJson<SyncableProfile>(PROFILE_STORAGE_KEY, {});
  await queueLegacyProfileMedia(uid, profile);
  const queue = readQueue(uid);
  const entries = Object.values(queue).filter((item): item is ProfileMediaQueueItem => Boolean(item));
  if (entries.length === 0) return;
  if (!storage) throw new Error('Profile image sync is unavailable until Firebase Storage is configured.');

  for (const item of entries) {
    const blob = await readProfileMedia(item.mediaKey);
    if (!blob) continue;

    // Use an immutable/versioned object instead of overwriting avatar.webp or
    // banner.webp. Older recovery points therefore continue to reference the
    // exact image bytes that were current when that snapshot was made.
    const imageRef = ref(storage, versionedProfileMediaPath(uid, item));
    await uploadBytes(imageRef, blob, {
      contentType: blob.type || 'image/webp',
      cacheControl: 'private,max-age=31536000,immutable',
    });
    const downloadUrl = await getDownloadURL(imageRef);

    const latestProfile = readRuntimeJson<SyncableProfile>(PROFILE_STORAGE_KEY, {});
    if (item.kind === 'avatar') {
      latestProfile.avatarImage = downloadUrl;
      delete latestProfile.avatarImageData;
      delete latestProfile.avatarMediaKey;
    } else {
      latestProfile.bannerImage = downloadUrl;
      delete latestProfile.bannerImageData;
      delete latestProfile.bannerMediaKey;
    }
    writeRuntimeJson(PROFILE_STORAGE_KEY, latestProfile);
    notifyLocalDataChanged([PROFILE_STORAGE_KEY]);

    const latestQueue = readQueue(uid);
    if (latestQueue[item.kind]?.mediaKey === item.mediaKey && latestQueue[item.kind]?.queuedAt === item.queuedAt) {
      delete latestQueue[item.kind];
      writeQueue(uid, latestQueue);
      await removeProfileMedia(item.mediaKey);
    }
  }
}

export function synchronizeProfileMedia(uid: string): Promise<void> {
  const existing = profileMediaSyncInFlight.get(uid);
  if (existing) return existing;

  const synchronization = runProfileMediaSynchronization(uid).finally(() => {
    if (profileMediaSyncInFlight.get(uid) === synchronization) {
      profileMediaSyncInFlight.delete(uid);
    }
  });
  profileMediaSyncInFlight.set(uid, synchronization);
  return synchronization;
}

export function profileMediaKeyFor(uid: string, kind: ProfileMediaKind): string {
  return getProfileMediaKey(uid, kind);
}
