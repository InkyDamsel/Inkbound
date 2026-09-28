import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  FULL_RECONCILIATION_VERSION,
  fullReconciliationVersionKey,
  SYNC_STORAGE_KEYS,
} from './storageKeys';

export interface LocalWorkingCopyReadinessOptions {
  requireFullReconciliation?: boolean;
}

export function hasCompletedFullReconciliation(uid: string): boolean {
  try {
    return getRuntimeStorage().getItem(fullReconciliationVersionKey(uid)) === FULL_RECONCILIATION_VERSION;
  } catch {
    return false;
  }
}

export function hasEstablishedLocalWorkingCopy(
  uid: string,
  options: LocalWorkingCopyReadinessOptions = {},
): boolean {
  try {
    const storage = getRuntimeStorage();
    if (storage.getItem(SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid) === uid) return false;

    const raw = storage.getItem(SYNC_STORAGE_KEYS.books);
    if (!raw) return false;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('[')) return false;

    const ownerUid = storage.getItem(SYNC_STORAGE_KEYS.localOwnerUid);
    if (ownerUid && ownerUid !== uid) return false;

    // Legacy local libraries predate the owner marker. A non-empty collection is
    // strong evidence of a real local working copy; an empty array is also valid
    // once an explicit matching owner marker has been established.
    const hasWorkingCopy = ownerUid === uid || trimmed !== '[]';
    if (!hasWorkingCopy) return false;

    if (options.requireFullReconciliation && !hasCompletedFullReconciliation(uid)) return false;
    return true;
  } catch {
    return false;
  }
}
