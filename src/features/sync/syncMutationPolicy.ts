export type SyncMutationOperation = 'upsert' | 'delete';

export interface TrustedSyncMutation<T> {
  operation: SyncMutationOperation;
  data?: T;
  clientUpdatedAt: string;
  capturedAfterCloudReconcile: true;
}

/**
 * Local cache churn is never reader intent until this foreground/open cycle has
 * completed a cloud reconciliation. An explicit local-clear operation is handled
 * by its own path and must not be re-captured as per-record mutations.
 */
export function shouldCaptureReaderMutation({
  coreReconciled,
  localClearIntent,
  trustedReaderIntent = false,
}: {
  coreReconciled: boolean;
  localClearIntent: boolean;
  trustedReaderIntent?: boolean;
}): boolean {
  return !localClearIntent && (coreReconciled || trustedReaderIntent);
}

export function createTrustedUpsertMutation<T>(
  data: T,
  clientUpdatedAt: string,
): TrustedSyncMutation<T> {
  return {
    operation: 'upsert',
    data,
    clientUpdatedAt,
    capturedAfterCloudReconcile: true,
  };
}

export function createTrustedDeleteMutation<T = never>(
  clientUpdatedAt: string,
): TrustedSyncMutation<T> {
  return {
    operation: 'delete',
    clientUpdatedAt,
    capturedAfterCloudReconcile: true,
  };
}
