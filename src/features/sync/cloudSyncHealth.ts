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
  message: 'Waiting for cloud synchronization.',
};

export function getCloudSyncHealth(): CloudSyncHealth {
  return currentHealth;
}

export function publishCloudSyncHealth(next: CloudSyncHealth) {
  currentHealth = next;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<CloudSyncHealth>(INKBOUND_CLOUD_SYNC_HEALTH_EVENT, { detail: next }));
}

export function requestCloudRefresh() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(INKBOUND_FORCE_CLOUD_REFRESH_EVENT));
}
