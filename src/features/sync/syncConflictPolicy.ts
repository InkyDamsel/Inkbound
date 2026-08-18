export interface MissingCloudRecordDecision {
  hasCloudRecord: boolean;
  baselineFingerprint?: string;
  hasPendingMutation: boolean;
}

/**
 * Decide whether a local record that is absent from the cloud should be promoted
 * back to Firestore during hydration.
 *
 * A record that has never appeared in the sync baseline is a legitimate local-only
 * create (for example, a book added while offline before the first successful
 * upload) and should be queued for upload.
 *
 * If the record existed in the previous baseline but is now missing from the
 * cloud, the absence is a remote deletion. Re-uploading the stale local copy would
 * resurrect data another device intentionally deleted, so the cloud deletion wins.
 *
 * Existing pending mutations are already authoritative local intent and are handled
 * separately by the durable pending queue.
 */
export function shouldPromoteLocalRecordMissingFromCloud({
  hasCloudRecord,
  baselineFingerprint,
  hasPendingMutation,
}: MissingCloudRecordDecision): boolean {
  if (hasCloudRecord || hasPendingMutation) return false;
  return baselineFingerprint === undefined;
}
