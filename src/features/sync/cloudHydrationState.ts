import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  CLOUD_HYDRATION_VERSION,
  cloudHydrationVersionKey,
  SYNC_STORAGE_KEYS,
} from './storageKeys';

type HydrationStorage = Pick<Storage, 'getItem' | 'setItem'>;

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const OWNER_UID_KEY = SYNC_STORAGE_KEYS.localOwnerUid;
const HYDRATION_REQUIRED_UID_KEY = SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid;

/**
 * Canonical owner of the question: "is this device's local library an
 * authoritative working copy for this account?"
 *
 * A matching owner UID is not enough. Broken Android builds could persist the
 * startup default [] and a reconciliation marker without ever downloading the
 * account's cloud library. Empty local state is authoritative only after this
 * device has independently proven that it observed a complete cloud snapshot.
 */
export function hasEstablishedLocalWorkingCopy(
  uid: string,
  storage: HydrationStorage = getRuntimeStorage(),
): boolean {
  try {
    if (storage.getItem(HYDRATION_REQUIRED_UID_KEY) === uid) return false;

    const raw = storage.getItem(BOOKS_KEY);
    if (!raw) return false;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('[')) return false;

    const ownerUid = storage.getItem(OWNER_UID_KEY);
    if (ownerUid) {
      if (ownerUid !== uid) return false;
      if (trimmed === '[]') {
        return storage.getItem(cloudHydrationVersionKey(uid)) === CLOUD_HYDRATION_VERSION;
      }
      return true;
    }

    // Legacy working copies may predate the explicit owner marker. A non-empty
    // library is still strong evidence of real local data; startup [] is not.
    return trimmed !== '[]';
  } catch {
    return false;
  }
}

export function hasCloudHydrationProof(
  uid: string,
  storage: HydrationStorage = getRuntimeStorage(),
): boolean {
  try {
    return storage.getItem(cloudHydrationVersionKey(uid)) === CLOUD_HYDRATION_VERSION;
  } catch {
    return false;
  }
}

export function markCloudHydrationComplete(
  uid: string,
  storage: HydrationStorage = getRuntimeStorage(),
): void {
  storage.setItem(cloudHydrationVersionKey(uid), CLOUD_HYDRATION_VERSION);
}
