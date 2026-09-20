/**
 * Legacy compatibility shim.
 *
 * Import history and enrichment queues are operational metadata, not canonical
 * library truth. Older builds attempted to recreate missing book records from
 * import history after hydration. That can resurrect books the reader
 * intentionally deleted or append fresh-ID copies of books that already exist.
 *
 * Canonical library recovery now belongs to the sync/recovery boundaries where
 * record IDs, baselines, tombstones, and explicit reader intent can be compared.
 * Keep this export temporarily so an older caller cannot turn historical import
 * rows back into live books.
 */
export function recoverIncompleteLatestImport(): number {
  return 0;
}
