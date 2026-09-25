import type { ReadingSession, UserBookRecord } from '../../types';
import { readRuntimeJson, writeRuntimeJson } from '../../platform/runtimeStorage';
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
  if (!writeRuntimeJson(SYNC_STORAGE_KEYS.books, nextBooks)) return false;
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
 * Append one book against the latest persisted canonical library rather than a
 * render-time array. Embedded features may remain mounted while another
 * mutation refresh is propagating; reading at the mutation boundary prevents a
 * second quick add from replacing the first with stale UI state.
 */
export function appendCanonicalBook(book: UserBookRecord) {
  const currentBooks = readRuntimeJson<UserBookRecord[]>(SYNC_STORAGE_KEYS.books, []);
  if (currentBooks.some((current) => current.id === book.id)) return true;
  return replaceCanonicalLibrary([...currentBooks, book]);
}


/**
 * Replace the whole canonical local session collection in one canonical write.
 * Session mutations use the same persist-first contract as the library.
 */
export function replaceCanonicalSessions(nextSessions: ReadingSession[]) {
  if (!writeRuntimeJson(SYNC_STORAGE_KEYS.sessions, nextSessions)) return false;
  notifyCloudDataUpdated([SYNC_STORAGE_KEYS.sessions]);
  return true;
}
