export const INKBOUND_CLOUD_DATA_EVENT = 'inkbound:cloud-data-updated';

export type CloudSyncedStorageKey =
  | 'inkbound_books'
  | 'inkbound_sessions'
  | 'inkbound_reader_profile';

export interface CloudDataUpdatedDetail {
  keys: CloudSyncedStorageKey[];
}

export const notifyCloudDataUpdated = (keys: CloudSyncedStorageKey[]) => {
  window.dispatchEvent(
    new CustomEvent<CloudDataUpdatedDetail>(INKBOUND_CLOUD_DATA_EVENT, {
      detail: { keys },
    }),
  );
};
