export const INKBOUND_CLOUD_DATA_EVENT = 'inkbound:cloud-data-updated';

export type CloudSyncedStorageKey =
  | 'inkbound_books'
  | 'inkbound_sessions'
  | 'inkbound_reader_profile';

export interface CloudDataUpdatedDetail {
  keys: CloudSyncedStorageKey[];
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
