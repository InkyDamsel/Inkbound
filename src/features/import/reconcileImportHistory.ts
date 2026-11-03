import type { UserBookRecord } from '../../types';
import { readImportHistory, type ImportHistoryEntry } from './importHistory';

/**
 * Historical compatibility export. Separate import sessions are independent
 * audit events, even when their file names, contents and outcomes match.
 * The old sameManifest() reconciler erased valid zero-new-book events.
 * Never modify persistent history as a side effect of reading or refreshing.
 */
export function reconcileRepeatedImportHistory(_books: UserBookRecord[]): ImportHistoryEntry[] {
  return readImportHistory();
}
