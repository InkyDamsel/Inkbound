export const INKBOUND_CLOUD_SYNC_HEALTH_EVENT = 'inkbound:cloud-sync-health';
export const INKBOUND_FORCE_CLOUD_REFRESH_EVENT = 'inkbound:force-cloud-refresh';

export type CloudSyncHealthStatus = 'idle' | 'checking' | 'healthy' | 'error';

export interface CloudSyncHealth {
  status: CloudSyncHealthStatus;
  lastSuccessfulSyncAt: string | null;
  message: string;
}

let currentHealth: CloudSyncHealth = {
  status: 'idle',
  lastSuccessfulSyncAt: null,
  message: 'Your library is available on this device. Inkbound will save changes to your account when a connection is available.',
};

function makeReaderFriendly(next: CloudSyncHealth): CloudSyncHealth {
  const progress = next.message.match(/\(([\d,]+) of ([\d,]+) books saved\)/i);
  if (progress) {
    const [, saved, expected] = progress;
    return {
      ...next,
      status: 'idle',
      message: `${saved} of ${expected} books are saved to your account. Your complete library is safe on this device while Inkbound saves the rest.`,
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
  window.dispatchEvent(new Event(INKBOUND_FORCE_CLOUD_REFRESH_EVENT));
}
