/**
 * Retired 2026-11 after independent audit reproduced destructive recovery.
 * The old routine bypassed canonical writes, deleted legitimate editions and
 * resurrected reader-deleted books. Import history is never authorization to
 * restore a missing book or to remove a different edition.
 *
 * Preserve this export as a safe compatibility shim for older callers.
 * Any future recovery must use explicit reader intent, tombstone checks and
 * canonical library writes, backed by regression tests.
 */
export function recoverIncompleteLatestImport(): number {
  return 0;
}
