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
export const PROFILE_MEDIA_SYNC_QUEUE_KEY = 'inkbound_profile_media_sync_queue_v1';

interface ProfileMediaQueueItem {
  kind: ProfileMediaKind;
  mediaKey: string;
  queuedAt: string;
}

type ProfileMediaQueue = Partial<Record<ProfileMediaKind, ProfileMediaQueueItem>>;

interface SyncableProfile {
  avatarImage?: string;
  bannerImage?: string;
  avatarMediaKey?: string;
  bannerMediaKey?: string;
  // Legacy fields are kept only long enough to migrate existing installs.
  avatarImageData?: string;
  bannerImageData?: string;
  [key: string]: unknown;
}

function readQueue(): ProfileMediaQueue {
  return readRuntimeJson<ProfileMediaQueue>(PROFILE_MEDIA_SYNC_QUEUE_KEY, {});
}

function writeQueue(queue: ProfileMediaQueue) {
  if (Object.keys(queue).length === 0) {
    removeRuntimeValue(PROFILE_MEDIA_SYNC_QUEUE_KEY);
    return;
  }
  writeRuntimeJson(PROFILE_MEDIA_SYNC_QUEUE_KEY, queue);
}

export function enqueueProfileMediaSync(kind: ProfileMediaKind, mediaKey: string) {
  const queue = readQueue();
  queue[kind] = { kind, mediaKey, queuedAt: new Date().toISOString() };
  writeQueue(queue);
}

async function queueLegacyProfileMedia(uid: string, profile: SyncableProfile) {
  const migrations: Array<Promise<void>> = [];

  if (profile.avatarImageData?.startsWith('data:image/')) {
    migrations.push((async () => {
      const blob = await dataUrlToBlob(profile.avatarImageData!);
      const mediaKey = await storeProfileMedia(uid, 'avatar', blob);
      profile.avatarMediaKey = mediaKey;
      enqueueProfileMediaSync('avatar', mediaKey);
    })());
  }

  if (profile.bannerImageData?.startsWith('data:image/')) {
    migrations.push((async () => {
      const blob = await dataUrlToBlob(profile.bannerImageData!);
      const mediaKey = await storeProfileMedia(uid, 'banner', blob);
      profile.bannerMediaKey = mediaKey;
      enqueueProfileMediaSync('banner', mediaKey);
    })());
  }

  if (migrations.length > 0) {
    await Promise.all(migrations);
    writeRuntimeJson(PROFILE_STORAGE_KEY, profile);
  }
}

export async function storeAndQueueProfileMedia(
  uid: string,
  kind: ProfileMediaKind,
  blob: Blob,
): Promise<string> {
  const mediaKey = await storeProfileMedia(uid, kind, blob);
  enqueueProfileMediaSync(kind, mediaKey);
  return mediaKey;
}

export async function synchronizeProfileMedia(uid: string): Promise<void> {
  if (!storage) throw new Error('Profile image sync is unavailable until Firebase Storage is configured.');

  const profile = readRuntimeJson<SyncableProfile>(PROFILE_STORAGE_KEY, {});
  await queueLegacyProfileMedia(uid, profile);
  const queue = readQueue();
  const entries = Object.values(queue).filter((item): item is ProfileMediaQueueItem => Boolean(item));
  if (entries.length === 0) return;

  for (const item of entries) {
    const blob = await readProfileMedia(item.mediaKey);
    if (!blob) continue;

    const imageRef = ref(storage, `users/${uid}/profile/${item.kind}.webp`);
    await uploadBytes(imageRef, blob, {
      contentType: blob.type || 'image/webp',
      cacheControl: 'private,max-age=3600',
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

    const latestQueue = readQueue();
    if (latestQueue[item.kind]?.mediaKey === item.mediaKey) {
      delete latestQueue[item.kind];
      writeQueue(latestQueue);
      await removeProfileMedia(item.mediaKey);
    }
  }
}

export function profileMediaKeyFor(uid: string, kind: ProfileMediaKind): string {
  return getProfileMediaKey(uid, kind);
}
