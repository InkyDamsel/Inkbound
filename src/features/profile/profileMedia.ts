import {
  readRuntimeMediaBlob,
  removeRuntimeMediaBlob,
  writeRuntimeMediaBlob,
} from '../../platform/runtimeMediaStorage';

export type ProfileMediaKind = 'avatar' | 'banner';

export const PROFILE_MEDIA_KEY_PREFIX = 'profile-media:';

export function getProfileMediaKey(uid: string, kind: ProfileMediaKind): string {
  return `${PROFILE_MEDIA_KEY_PREFIX}${uid}:${kind}`;
}

export async function dataUrlToBlob(value: string): Promise<Blob> {
  const response = await fetch(value);
  if (!response.ok) throw new Error('Inkbound could not read the saved profile image.');
  return response.blob();
}

export async function storeProfileMedia(
  uid: string,
  kind: ProfileMediaKind,
  blob: Blob,
): Promise<string> {
  const key = getProfileMediaKey(uid, kind);
  await writeRuntimeMediaBlob(key, blob);
  return key;
}

export function readProfileMedia(key?: string): Promise<Blob | null> {
  if (!key) return Promise.resolve(null);
  return readRuntimeMediaBlob(key);
}

export function removeProfileMedia(key?: string): Promise<void> {
  if (!key) return Promise.resolve();
  return removeRuntimeMediaBlob(key);
}
