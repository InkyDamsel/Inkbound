import { CANONICAL_SYNC_COLLECTION_KEYS } from './storageKeys';

export const INKBOUND_CLOUD_DATA_EVENT = 'inkbound:cloud-data-updated';
export const INKBOUND_LOCAL_DATA_CHANGED_EVENT = 'inkbound:local-data-changed';
export const INKBOUND_BEFORE_SIGN_OUT_EVENT = 'inkbound:before-sign-out';
export const INKBOUND_CORE_RECONCILED_EVENT = 'inkbound:core-cloud-reconciled';

export type CloudSyncedStorageKey = (typeof CANONICAL_SYNC_COLLECTION_KEYS)[number];

export interface CloudDataUpdatedDetail {
  keys: CloudSyncedStorageKey[];
}

export interface LocalDataChangedDetail {
  keys: CloudSyncedStorageKey[];
  trustedReaderIntent?: boolean;
}

export interface BeforeSignOutDetail {
  uid: string;
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface CoreCloudReconciledDetail {
  uid: string;
}

type InkboundWindow = Window & {
  __inkboundLocalStorageSignalsInstalled?: boolean;
};

const CLOUD_SYNCED_STORAGE_KEYS = new Set<CloudSyncedStorageKey>(CANONICAL_SYNC_COLLECTION_KEYS);
const LOCAL_DATA_SIGNAL_DEBOUNCE_MS = 1000;

function isCloudSyncedStorageKey(key: string): key is CloudSyncedStorageKey {
  return CLOUD_SYNCED_STORAGE_KEYS.has(key as CloudSyncedStorageKey);
}

let cloudDataRevision = 0;
let pendingLocalDataKeys = new Set<CloudSyncedStorageKey>();
let pendingLocalDataTrustedReaderIntent = false;
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

export const notifyCoreCloudReconciled = (uid: string) => {
  window.dispatchEvent(
    new CustomEvent<CoreCloudReconciledDetail>(INKBOUND_CORE_RECONCILED_EVENT, {
      detail: { uid },
    }),
  );
};

export const notifyLocalDataChanged = (
  keys: CloudSyncedStorageKey[],
  options?: { trustedReaderIntent?: boolean },
) => {
  keys.forEach((key) => pendingLocalDataKeys.add(key));
  if (options?.trustedReaderIntent === true) pendingLocalDataTrustedReaderIntent = true;
  if (localDataSignalTimer !== undefined) window.clearTimeout(localDataSignalTimer);

  localDataSignalTimer = window.setTimeout(() => {
    localDataSignalTimer = undefined;
    if (!pendingLocalDataKeys.size) return;
    const changedKeys = [...pendingLocalDataKeys];
    const trustedReaderIntent = pendingLocalDataTrustedReaderIntent;
    pendingLocalDataKeys = new Set<CloudSyncedStorageKey>();
    pendingLocalDataTrustedReaderIntent = false;
    window.dispatchEvent(
      new CustomEvent<LocalDataChangedDetail>(INKBOUND_LOCAL_DATA_CHANGED_EVENT, {
        detail: { keys: changedKeys, trustedReaderIntent },
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

installLocalStorageSyncSignals();

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
