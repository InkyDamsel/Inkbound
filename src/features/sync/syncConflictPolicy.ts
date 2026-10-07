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

function parseClientMillis(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Canonical last-write conflict rule shared by book/session delta sync and
 * auxiliary account sync.
 *
 * A pending local mutation is real user intent, so cloud only replaces it when
 * the cloud change is demonstrably newer. Firestore server time is preferred
 * when available; clientUpdatedAt is used as the cross-device fallback.
 */
export function shouldRemoteChangeReplacePending({
  remoteServerMillis = 0,
  remoteClientUpdatedAt,
  pendingClientUpdatedAt,
}: {
  remoteServerMillis?: number;
  remoteClientUpdatedAt?: string;
  pendingClientUpdatedAt?: string;
}): boolean {
  if (!pendingClientUpdatedAt) return true;
  const remoteMillis = Math.max(remoteServerMillis, parseClientMillis(remoteClientUpdatedAt));
  const pendingMillis = parseClientMillis(pendingClientUpdatedAt);
  return remoteMillis > pendingMillis;
}

/**
 * A durable deletion tombstone is authoritative only until the same record is
 * deliberately recreated. When a later cloud upsert exists, the historical
 * tombstone must not erase the revived record on a newly opened device.
 */
export function shouldApplyRemoteTombstone({
  tombstoneServerMillis = 0,
  latestRecordServerMillis = 0,
}: {
  tombstoneServerMillis?: number;
  latestRecordServerMillis?: number;
}): boolean {
  return latestRecordServerMillis <= tombstoneServerMillis;
}

/**
 * Trust-aware wrapper for canonical record/tombstone reconciliation.
 *
 * Pending state from an older build or captured before the reconciliation gate
 * is not proof of fresh reader intent, regardless of its client clock. Current
 * builds mark explicit post-reconcile/offline reader intent with
 * capturedAfterCloudReconcile=true.
 */
export function shouldRemoteReplacePendingMutation({
  remoteServerMillis = 0,
  remoteClientUpdatedAt,
  pendingClientUpdatedAt,
  pendingCapturedAfterCloudReconcile,
}: {
  remoteServerMillis?: number;
  remoteClientUpdatedAt?: string;
  pendingClientUpdatedAt?: string;
  pendingCapturedAfterCloudReconcile?: boolean;
}): boolean {
  if (pendingClientUpdatedAt && pendingCapturedAfterCloudReconcile !== true) return true;
  return shouldRemoteChangeReplacePending({
    remoteServerMillis,
    remoteClientUpdatedAt,
    pendingClientUpdatedAt,
  });
}
