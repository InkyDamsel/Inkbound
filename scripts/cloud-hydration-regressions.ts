import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hasCloudHydrationProof,
  hasEstablishedLocalWorkingCopy,
  markCloudHydrationComplete,
} from '../src/features/sync/cloudHydrationState';
import {
  CLOUD_HYDRATION_VERSION,
  FULL_RECONCILIATION_VERSION,
  cloudHydrationVersionKey,
  fullReconciliationVersionKey,
  SYNC_STORAGE_KEYS,
} from '../src/features/sync/storageKeys';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const uid = 'reader-regression';

// Exact 27.8.1/27.8.2 failure state: startup [] + matching account owner + an
// old reconciliation marker MUST NOT be trusted as an established empty library.
// The absence of independent hydration proof must force OneShotCloudHydrationBridge.
{
  const storage = new MemoryStorage();
  storage.setItem(SYNC_STORAGE_KEYS.books, '[]');
  storage.setItem(SYNC_STORAGE_KEYS.localOwnerUid, uid);
  storage.setItem(fullReconciliationVersionKey(uid), FULL_RECONCILIATION_VERSION);

  assert.equal(hasCloudHydrationProof(uid, storage), false);
  assert.equal(hasEstablishedLocalWorkingCopy(uid, storage), false);
}

// Once this exact device/account has successfully observed a complete cloud
// snapshot, an actually empty library becomes authoritative and must stay empty.
{
  const storage = new MemoryStorage();
  storage.setItem(SYNC_STORAGE_KEYS.books, '[]');
  storage.setItem(SYNC_STORAGE_KEYS.localOwnerUid, uid);
  markCloudHydrationComplete(uid, storage);

  assert.equal(storage.getItem(cloudHydrationVersionKey(uid)), CLOUD_HYDRATION_VERSION);
  assert.equal(hasCloudHydrationProof(uid, storage), true);
  assert.equal(hasEstablishedLocalWorkingCopy(uid, storage), true);
}

// A real non-empty local working copy remains usable without forcing a full
// restore merely because the new proof marker did not exist in older releases.
{
  const storage = new MemoryStorage();
  storage.setItem(SYNC_STORAGE_KEYS.books, '[{"id":"book-1"}]');
  storage.setItem(SYNC_STORAGE_KEYS.localOwnerUid, uid);
  assert.equal(hasEstablishedLocalWorkingCopy(uid, storage), true);
}

// Account ownership mismatch and an explicit hydration-required marker always
// defeat local readiness, even when other markers are present.
{
  const differentOwner = new MemoryStorage();
  differentOwner.setItem(SYNC_STORAGE_KEYS.books, '[{"id":"book-1"}]');
  differentOwner.setItem(SYNC_STORAGE_KEYS.localOwnerUid, 'someone-else');
  markCloudHydrationComplete(uid, differentOwner);
  assert.equal(hasEstablishedLocalWorkingCopy(uid, differentOwner), false);

  const forcedHydration = new MemoryStorage();
  forcedHydration.setItem(SYNC_STORAGE_KEYS.books, '[{"id":"book-1"}]');
  forcedHydration.setItem(SYNC_STORAGE_KEYS.localOwnerUid, uid);
  forcedHydration.setItem(SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid, uid);
  markCloudHydrationComplete(uid, forcedHydration);
  assert.equal(hasEstablishedLocalWorkingCopy(uid, forcedHydration), false);
}

// Source-of-truth guard: neither sync bridge may re-declare the readiness rule.
// Both must consume cloudHydrationState.ts, and only the one-shot restore may
// stamp hydration complete after its cloud snapshot succeeds.
{
  const adaptive = fs.readFileSync(new URL('../src/features/sync/AdaptiveCloudPersistenceBridge.tsx', import.meta.url), 'utf8');
  const oneShot = fs.readFileSync(new URL('../src/features/sync/OneShotCloudHydrationBridge.tsx', import.meta.url), 'utf8');

  assert.match(adaptive, /from '\.\/cloudHydrationState'/);
  assert.match(oneShot, /from '\.\/cloudHydrationState'/);
  assert.doesNotMatch(adaptive, /function hasEstablishedLocalWorkingCopy/);
  assert.doesNotMatch(oneShot, /function hasEstablishedLocalWorkingCopy/);
  assert.match(oneShot, /markCloudHydrationComplete\(uid, storage\)/);
}

console.log('Inkbound cloud hydration regressions passed.');
