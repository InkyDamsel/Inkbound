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
  message: 'Waiting to update your library across devices.',
};

function makePartialBackupReaderFriendly(next: CloudSyncHealth): CloudSyncHealth {
  if (next.status !== 'error') return next;

  const progress = next.message.match(/\(([\d,]+) of ([\d,]+) books saved\)/i);
  if (progress) {
    const [, saved, expected] = progress;
    return {
      ...next,
      status: 'idle',
      message: `${saved} of ${expected} books are safely backed up. Your complete library is safe on this device while Inkbound saves the rest, and it will not replace it with an incomplete copy.`,
    };
  }

  const incomplete = next.message.match(/only ([\d,]+) of ([\d,]+) expected books/i);
  if (incomplete) {
    const [, saved, expected] = incomplete;
    return {
      ...next,
      status: 'idle',
      message: `${saved} of ${expected} books are safely backed up. Your complete library remains untouched on this device while the rest finish saving.`,
    };
  }

  return next;
}

export function getCloudSyncHealth(): CloudSyncHealth {
  return currentHealth;
}

export function publishCloudSyncHealth(next: CloudSyncHealth) {
  currentHealth = makePartialBackupReaderFriendly(next);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<CloudSyncHealth>(INKBOUND_CLOUD_SYNC_HEALTH_EVENT, { detail: currentHealth }));
}

export function requestCloudRefresh() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(INKBOUND_FORCE_CLOUD_REFRESH_EVENT));
}
