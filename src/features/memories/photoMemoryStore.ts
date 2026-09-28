import {
  readRuntimeMediaBlob,
  removeRuntimeMediaBlob,
  removeRuntimeMediaByPrefix,
  writeRuntimeMediaBlob,
} from '../../platform/runtimeMediaStorage';
import {
import { DEVICE_FEATURE_STORAGE_KEYS } from '../sync/storageKeys';
  readRuntimeJson,
  removeRuntimeValue,
  writeRuntimeJson,
} from '../../platform/runtimeStorage';

export interface PhotoMemoryRecord {
  id: string;
  imageData: string;
  caption: string;
  date: string;
  location: string;
  bookId?: string;
  createdAt: string;
}

type PhotoMemoryMetadata = Omit<PhotoMemoryRecord, 'imageData'>;

const PHOTO_METADATA_KEY = DEVICE_FEATURE_STORAGE_KEYS.photoMemories;
const LEGACY_PHOTO_KEY = DEVICE_FEATURE_STORAGE_KEYS.legacyPhotoMemories;
const MEDIA_PREFIX = 'photo-memory:';
const listeners = new Set<() => void>();

function mediaKey(id: string) {
  return `${MEDIA_PREFIX}${id}`;
}

function dataUrlToBlob(value: string): Blob {
  const [header, encoded = ''] = value.split(',', 2);
  const contentType = /^data:([^;,]+)/i.exec(header)?.[1] ?? 'image/jpeg';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: contentType });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('A saved photo could not be read from this device.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function notifyPhotoMemoryListeners() {
  listeners.forEach((listener) => listener());
}

async function migrateLegacyPhotoMemories(): Promise<void> {
  const existingMetadata = readRuntimeJson<PhotoMemoryMetadata[]>(PHOTO_METADATA_KEY, []);
  if (existingMetadata.length > 0) return;

  const legacy = readRuntimeJson<PhotoMemoryRecord[]>(LEGACY_PHOTO_KEY, []);
  if (legacy.length === 0) return;

  await Promise.all(
    legacy.map(async ({ imageData, ...metadata }) => {
      if (imageData.startsWith('data:')) await writeRuntimeMediaBlob(mediaKey(metadata.id), dataUrlToBlob(imageData));
    }),
  );
  writeRuntimeJson(PHOTO_METADATA_KEY, legacy.map(({ imageData: _imageData, ...metadata }) => metadata));
  removeRuntimeValue(LEGACY_PHOTO_KEY);
}

export async function readPhotoMemoriesFromDevice(): Promise<PhotoMemoryRecord[]> {
  await migrateLegacyPhotoMemories();
  const metadata = readRuntimeJson<PhotoMemoryMetadata[]>(PHOTO_METADATA_KEY, []);
  const hydrated = await Promise.all(
    metadata.map(async (item): Promise<PhotoMemoryRecord | null> => {
      const blob = await readRuntimeMediaBlob(mediaKey(item.id));
      if (!blob) return null;
      return { ...item, imageData: await blobToDataUrl(blob) };
    }),
  );
  return hydrated.filter((item): item is PhotoMemoryRecord => Boolean(item));
}

export async function replacePhotoMemoriesOnDevice(memories: PhotoMemoryRecord[]): Promise<void> {
  const nextIds = new Set(memories.map((memory) => memory.id));
  const previousMetadata = readRuntimeJson<PhotoMemoryMetadata[]>(PHOTO_METADATA_KEY, []);

  await Promise.all(
    previousMetadata
      .filter((item) => !nextIds.has(item.id))
      .map((item) => removeRuntimeMediaBlob(mediaKey(item.id))),
  );

  await Promise.all(
    memories.map(async ({ imageData, ...metadata }) => {
      if (imageData.startsWith('data:')) await writeRuntimeMediaBlob(mediaKey(metadata.id), dataUrlToBlob(imageData));
    }),
  );

  writeRuntimeJson(PHOTO_METADATA_KEY, memories.map(({ imageData: _imageData, ...metadata }) => metadata));
  removeRuntimeValue(LEGACY_PHOTO_KEY);
  notifyPhotoMemoryListeners();
}

export async function clearPhotoMemoriesFromDevice(): Promise<void> {
  writeRuntimeJson(PHOTO_METADATA_KEY, []);
  removeRuntimeValue(LEGACY_PHOTO_KEY);
  await removeRuntimeMediaByPrefix(MEDIA_PREFIX);
  notifyPhotoMemoryListeners();
}

export function subscribeToPhotoMemoryChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export { PHOTO_METADATA_KEY };
