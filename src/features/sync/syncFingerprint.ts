/**
 * Canonical serialization/fingerprint helpers for sync baselines.
 *
 * Core record baselines store compact fingerprints; profile/auxiliary callers
 * may use the stable serialized value directly when that is their existing
 * persistence contract. Keep both representations derived from one serializer.
 */
export const stableSyncValue = (value: unknown): string => JSON.stringify(value);

export function fingerprintSyncValue(value: unknown): string {
  const serialized = stableSyncValue(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
