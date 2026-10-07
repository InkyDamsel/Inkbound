import type { ReadingSession, UserBookRecord } from '../../types';
import { writeRuntimeJson } from '../../platform/runtimeStorage';
import { notifyCloudDataUpdated } from '../sync/cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from '../sync/storageKeys';

/**
 * Replace the whole canonical local working library in one atomic local write.
 *
 * IMPORTANT: write through runtimeStorage before notifying the mounted app. The
 * runtime-storage mutation signal is what puts changed book records into the
 * durable cloud pending queue. A direct adapter setItem followed only by a
 * cloud-data refresh makes the persistence bridge believe the new value came
 * from cloud and can silently skip the upload.
 */
export function replaceCanonicalLibrary(nextBooks: UserBookRecord[]) {
  if (!writeRuntimeJson(SYNC_STORAGE_KEYS.books, nextBooks, { trustedReaderIntent: true })) return false;
  notifyCloudDataUpdated([SYNC_STORAGE_KEYS.books]);
  return true;
}

/**
 * Replace one book in the canonical local working library and notify the app shell.
 * Used by embedded feature surfaces that do not receive App's state setter directly.
 * The runtime-storage signal queues the delta before the app refresh signal runs.
 */
export function replaceCanonicalBook(currentBooks: UserBookRecord[], updatedBook: UserBookRecord) {
  return replaceCanonicalLibrary(currentBooks.map((book) => book.id === updatedBook.id ? updatedBook : book));
}


/**
 * Replace the whole canonical local session collection in one canonical write.
 * Session mutations use the same persist-first contract as the library.
 */
export function replaceCanonicalSessions(nextSessions: ReadingSession[]) {
  if (!writeRuntimeJson(SYNC_STORAGE_KEYS.sessions, nextSessions, { trustedReaderIntent: true })) return false;
  notifyCloudDataUpdated([SYNC_STORAGE_KEYS.sessions]);
  return true;
}
