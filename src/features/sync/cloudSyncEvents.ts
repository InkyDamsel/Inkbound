export const INKBOUND_CLOUD_DATA_EVENT = 'inkbound:cloud-data-updated';
export const INKBOUND_LOCAL_DATA_CHANGED_EVENT = 'inkbound:local-data-changed';
export const INKBOUND_BEFORE_SIGN_OUT_EVENT = 'inkbound:before-sign-out';

export type CloudSyncedStorageKey =
  | 'inkbound_books'
  | 'inkbound_sessions'
  | 'inkbound_reader_profile';

export interface CloudDataUpdatedDetail {
  keys: CloudSyncedStorageKey[];
}

export interface LocalDataChangedDetail {
  keys: CloudSyncedStorageKey[];
}

export interface BeforeSignOutDetail {
  uid: string;
  waitUntil: (promise: Promise<unknown>) => void;
}

// Runtime-only revision. It resets on a full page load, which is intentional:
// signed-in screens should wait for the current session's cloud hydration before
// revealing cached records from a previous session/device state.
let cloudDataRevision = 0;

export const getCloudDataRevision = () => cloudDataRevision;

export const notifyCloudDataUpdated = (keys: CloudSyncedStorageKey[]) => {
  cloudDataRevision += 1;
  window.dispatchEvent(
    new CustomEvent<CloudDataUpdatedDetail>(INKBOUND_CLOUD_DATA_EVENT, {
      detail: { keys },
    }),
  );
};

// Local writes in the same browser tab do not emit the native storage event.
// Components use this signal so the sync bridge can capture important changes
// immediately instead of waiting for its background polling interval.
export const notifyLocalDataChanged = (keys: CloudSyncedStorageKey[]) => {
  window.dispatchEvent(
    new CustomEvent<LocalDataChangedDetail>(INKBOUND_LOCAL_DATA_CHANGED_EVENT, {
      detail: { keys },
    }),
  );
};

// Give the persistence bridge a bounded opportunity to flush queued mutations
// while Firebase authentication is still valid. This is especially important
// for newly selected profile images, which may still be uploading to Storage.
export const flushCloudDataBeforeSignOut = async (uid: string) => {
  const promises: Promise<unknown>[] = [];
  window.dispatchEvent(
    new CustomEvent<BeforeSignOutDetail>(INKBOUND_BEFORE_SIGN_OUT_EVENT, {
      detail: {
        uid,
        waitUntil: (promise) => promises.push(promise),
      },
    }),
  );

  if (promises.length === 0) return;

  await Promise.race([
    Promise.allSettled(promises),
    new Promise<void>((resolve) => window.setTimeout(resolve, 15000)),
  ]);
};
