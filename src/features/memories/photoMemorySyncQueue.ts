import {
import { DEVICE_FEATURE_STORAGE_KEYS } from '../sync/storageKeys';
  readRuntimeJson,
  writeRuntimeJson,
} from '../../platform/runtimeStorage';

export type PhotoMemorySyncOperationType = 'upsert' | 'delete';

export interface PhotoMemorySyncOperation {
  id: string;
  type: PhotoMemorySyncOperationType;
  queuedAt: string;
}

const PHOTO_MEMORY_SYNC_QUEUE_KEY = DEVICE_FEATURE_STORAGE_KEYS.photoMemorySyncQueue;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function readQueue(): PhotoMemorySyncOperation[] {
  return readRuntimeJson<PhotoMemorySyncOperation[]>(PHOTO_MEMORY_SYNC_QUEUE_KEY, []);
}

function writeQueue(queue: PhotoMemorySyncOperation[]) {
  writeRuntimeJson(PHOTO_MEMORY_SYNC_QUEUE_KEY, queue);
  notifyListeners();
}

function queueOperation(id: string, type: PhotoMemorySyncOperationType) {
  const next: PhotoMemorySyncOperation = {
    id,
    type,
    queuedAt: new Date().toISOString(),
  };
  const queue = readQueue().filter((operation) => operation.id !== id);
  queue.push(next);
  writeQueue(queue);
}

export function queuePhotoMemoryUpsert(id: string) {
  queueOperation(id, 'upsert');
}

export function queuePhotoMemoryDelete(id: string) {
  queueOperation(id, 'delete');
}

export function readPhotoMemorySyncQueue(): PhotoMemorySyncOperation[] {
  return readQueue();
}

export function completePhotoMemorySyncOperation(operation: PhotoMemorySyncOperation) {
  const queue = readQueue();
  const current = queue.find((item) => item.id === operation.id);
  if (!current || current.queuedAt !== operation.queuedAt || current.type !== operation.type) return;
  writeQueue(queue.filter((item) => item.id !== operation.id));
}

export function subscribeToPhotoMemorySyncQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export { PHOTO_MEMORY_SYNC_QUEUE_KEY };
