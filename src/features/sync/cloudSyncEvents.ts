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

type InkboundWindow = Window & {
  __inkboundLocalStorageSignalsInstalled?: boolean;
};

const CLOUD_SYNCED_STORAGE_KEYS = new Set<CloudSyncedStorageKey>([
  'inkbound_books',
  'inkbound_sessions',
  'inkbound_reader_profile',
]);
const LOCAL_DATA_SIGNAL_DEBOUNCE_MS = 1000;

function isCloudSyncedStorageKey(key: string): key is CloudSyncedStorageKey {
  return CLOUD_SYNCED_STORAGE_KEYS.has(key as CloudSyncedStorageKey);
}

// Runtime-only revision. It resets on a full page load, which is intentional:
// signed-in screens should wait for the current session's cloud hydration before
// revealing cached records from a previous session/device state.
let cloudDataRevision = 0;
let pendingLocalDataKeys = new Set<CloudSyncedStorageKey>();
let localDataSignalTimer: number | undefined;

export const getCloudDataRevision = () => cloudDataRevision;

export const notifyCloudDataUpdated = (keys: CloudSyncedStorageKey[]) => {
  cloudDataRevision += 1;
  window.dispatchEvent(
    new CustomEvent<CloudDataUpdatedDetail>(INKBOUND_CLOUD_DATA_EVENT, {
      detail: { keys },
    }),
  );
};

// Collapse bursts of local mutations into one sync signal. Imports, batch edits,
// and React persistence effects can otherwise trigger many overlapping Firestore
// flushes for the same logical change.
export const notifyLocalDataChanged = (keys: CloudSyncedStorageKey[]) => {
  keys.forEach((key) => pendingLocalDataKeys.add(key));
  if (localDataSignalTimer !== undefined) window.clearTimeout(localDataSignalTimer);

  localDataSignalTimer = window.setTimeout(() => {
    localDataSignalTimer = undefined;
    if (!pendingLocalDataKeys.size) return;
    const changedKeys = [...pendingLocalDataKeys];
    pendingLocalDataKeys = new Set<CloudSyncedStorageKey>();
    window.dispatchEvent(
      new CustomEvent<LocalDataChangedDetail>(INKBOUND_LOCAL_DATA_CHANGED_EVENT, {
        detail: { keys: changedKeys },
      }),
    );
  }, LOCAL_DATA_SIGNAL_DEBOUNCE_MS);
};

function installLocalStorageSyncSignals() {
  if (typeof window === 'undefined') return;

  const runtimeWindow = window as InkboundWindow;
  if (runtimeWindow.__inkboundLocalStorageSignalsInstalled) return;

  const storagePrototype = Object.getPrototypeOf(window.localStorage) as Storage;
  const originalSetItem = storagePrototype.setItem;
  const originalRemoveItem = storagePrototype.removeItem;

  storagePrototype.setItem = function setItem(key: string, value: string) {
    const shouldSignal = this === window.localStorage && isCloudSyncedStorageKey(key);
    const previousValue = shouldSignal ? this.getItem(key) : null;

    // Do not rewrite or re-signal cloud-synced values that are byte-for-byte
    // identical. This is common when React effects persist an already-saved value.
    if (shouldSignal && previousValue === value) return;

    originalSetItem.call(this, key, value);
    if (shouldSignal) notifyLocalDataChanged([key]);
  };

  storagePrototype.removeItem = function removeItem(key: string) {
    const shouldSignal = this === window.localStorage && isCloudSyncedStorageKey(key);
    const hadValue = shouldSignal ? this.getItem(key) !== null : false;
    originalRemoveItem.call(this, key);
    if (shouldSignal && hadValue) notifyLocalDataChanged([key]);
  };

  runtimeWindow.__inkboundLocalStorageSignalsInstalled = true;
}

// CloudPersistenceBridge turns this signal into a durable pending mutation and
// flushes it to Firestore. Install the signal at the storage boundary so local
// changes are captured without continuously polling Firestore-bound state.
installLocalStorageSyncSignals();

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