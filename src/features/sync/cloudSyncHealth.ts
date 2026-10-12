import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { SYNC_STORAGE_KEYS } from './storageKeys';

export const INKBOUND_CLOUD_SYNC_HEALTH_EVENT = 'inkbound:cloud-sync-health';
export const INKBOUND_FORCE_CLOUD_REFRESH_EVENT = 'inkbound:force-cloud-refresh';

export type CloudSyncHealthStatus = 'idle' | 'checking' | 'healthy' | 'error';

export interface CloudSyncHealth {
  status: CloudSyncHealthStatus;
  lastSuccessfulSyncAt: string | null;
  message: string;
}

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const LAST_SYNC_STORAGE_KEY = SYNC_STORAGE_KEYS.lastCloudSyncAt;
const LARGE_LIBRARY_FULL_REFRESH_LIMIT = 5_000;

let currentHealth: CloudSyncHealth = {
  status: 'idle',
  lastSuccessfulSyncAt: null,
  message: 'Your library is available on this device. Inkbound will save changes to your account when a connection is available.',
};

function makeReaderFriendly(next: CloudSyncHealth): CloudSyncHealth {
  const progress = next.message.match(/\(([\d,]+) of ([\d,]+) books saved\)/i);
  if (progress) {
    const [, saved, expected] = progress;
    const savedCount = Number(saved.replace(/,/g, ''));
    const expectedCount = Number(expected.replace(/,/g, ''));
    if (savedCount > expectedCount) {
      // The manifest may lag behind new cloud writes. Do not describe this
      // as missing books or imply that the smaller count is the cloud total.
      return {
        ...next,
        status: 'checking',
        message: `Inkbound is updating your library sync count. ${saved} books are reported saved, while the last checkpoint expected ${expected}. Your library remains available on this device.`,
      };
    }
    return {
      ...next,
      status: 'checking',
      message: `${saved} of ${expected} books are reported saved to your account. Inkbound is still checking synchronization; your library remains available on this device.`,
    };
  }

  const incomplete = next.message.match(/only ([\d,]+) of ([\d,]+) expected books/i);
  if (incomplete) {
    const [, saved, expected] = incomplete;
    return {
      ...next,
      status: 'idle',
      message: `${saved} of ${expected} books are saved to your account. Your complete library stays safe on this device while the rest finish saving.`,
    };
  }

  const normalized = next.message.toLowerCase();
  if (normalized.includes('firebase') || normalized.includes('firestore') || normalized.includes('polling') || normalized.includes('canonical')) {
    return {
      ...next,
      message: next.status === 'healthy'
        ? 'Your latest changes are saved and available across your signed-in devices.'
        : next.status === 'checking'
          ? 'Inkbound is checking for your latest saved books and reading activity.'
          : next.status === 'error'
            ? 'Inkbound could not reach your saved account copy right now. Your library on this device is still available, and you can try again when your connection improves.'
            : 'Your library is available on this device. Inkbound will save changes to your account when a connection is available.',
    };
  }

  return next;
}

function localLibrarySize(): number {
  try {
    const raw = getRuntimeStorage().getItem(BOOKS_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function getCloudSyncHealth(): CloudSyncHealth {
  return currentHealth;
}

export function publishCloudSyncHealth(next: CloudSyncHealth) {
  currentHealth = makeReaderFriendly(next);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<CloudSyncHealth>(INKBOUND_CLOUD_SYNC_HEALTH_EVENT, { detail: currentHealth }));
}

export function requestCloudRefresh() {
  if (typeof window === 'undefined') return;

  const bookCount = localLibrarySize();
  if (bookCount >= LARGE_LIBRARY_FULL_REFRESH_LIMIT) {
    const storage = getRuntimeStorage();
    publishCloudSyncHealth({
      status: 'healthy',
      lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
      message: `Large-library protection is active for your ${bookCount.toLocaleString()}-item library. Inkbound kept the local working copy and skipped a full cloud reread; your new changes will continue syncing normally.`,
    });
    return;
  }

  window.dispatchEvent(new Event(INKBOUND_FORCE_CLOUD_REFRESH_EVENT));
}
