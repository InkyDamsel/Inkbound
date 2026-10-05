import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { IMPORT_ENRICHMENT_PAUSED_KEY } from '../import/importHistory';
import { mergeIncomingBookLoanState } from '../ownership/bookOwnership';
import { mergeIncomingBookQuoteState } from '../reading/bookQuotePersistence';
import { mergeIncomingManualCoverState } from './bookUserOwnedPersistence';
import { db } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { canReportCloudLibraryHealthy } from './accountLibraryMigration';
import { notifyCloudDataUpdated } from './cloudSyncEvents';
import {
  INKBOUND_FORCE_CLOUD_REFRESH_EVENT,
  publishCloudSyncHealth,
} from './cloudSyncHealth';
import {
  ACCOUNT_LIBRARY_MIGRATION_VERSION,
  accountLibraryMigrationVersionKey,
  SYNC_STORAGE_KEYS,
  syncPendingStateKey,
} from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_KEY = SYNC_STORAGE_KEYS.sessions;
const PROFILE_KEY = SYNC_STORAGE_KEYS.profile;
const LAST_SYNC_STORAGE_KEY = SYNC_STORAGE_KEYS.lastCloudSyncAt;
const LEGACY_AUTOPAUSE_MIGRATION_KEY = 'inkbound_import_enrichment_autopause_cleanup_v1';
const REPAIR_UPLOAD_BATCH_SIZE = 100;

interface CloudRecord<T> {
  data: T;
}

interface PendingMutation<T> {
  operation: 'upsert' | 'delete';
  data?: T;
  clientUpdatedAt: string;
}

interface PendingSyncState {
  books: Record<string, PendingMutation<UserBookRecord>>;
  sessions: Record<string, PendingMutation<ReadingSession>>;
  profile?: { data: Record<string, unknown>; clientUpdatedAt: string };
}

interface LibrarySyncManifest {
  status?: 'syncing' | 'complete';
  expectedBookCount?: number;
  uploadedBookCount?: number;
  syncDirection?: 'grow' | 'shrink' | 'unknown';
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = getRuntimeStorage().getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  getRuntimeStorage().setItem(key, JSON.stringify(value));
}

export function mergeServerCollectionById<T extends { id: string }>(
  current: T[],
  server: T[],
  pending: Record<string, PendingMutation<T>>,
): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  server.forEach((item) => {
    const localMutation = pending[item.id];
    if (localMutation?.operation === 'delete') return;
    if (localMutation?.operation === 'upsert' && localMutation.data) {
      merged.set(item.id, localMutation.data);
      return;
    }
    // An explicit server refresh is a reconciliation pass, not a metadata-only
    // lookup. With no pending local intent, the saved account record is the
    // canonical current record for this ID and must replace stale device state.
    merged.set(item.id, item);
  });
  return [...merged.values()];
}

function preferredText(localValue?: string, serverValue?: string) {
  return localValue?.trim() ? localValue : serverValue;
}

function mergeServerMetadataIntoBook(localBook: UserBookRecord, serverBook: UserBookRecord): UserBookRecord {
  const serverEditions = new Map(serverBook.editions.map((edition) => [edition.id, edition]));
  const mergedEditions = localBook.editions.map((localEdition) => {
    const serverEdition = serverEditions.get(localEdition.id);
    if (!serverEdition) return localEdition;
    serverEditions.delete(localEdition.id);

    return {
      ...serverEdition,
      ...localEdition,
      coverUrl: preferredText(localEdition.coverUrl, serverEdition.coverUrl),
      isbn: preferredText(localEdition.isbn, serverEdition.isbn),
      isbn10: preferredText(localEdition.isbn10, serverEdition.isbn10),
      isbn13: preferredText(localEdition.isbn13, serverEdition.isbn13),
      publisher: preferredText(localEdition.publisher, serverEdition.publisher),
      publicationDate: preferredText(localEdition.publicationDate, serverEdition.publicationDate),
      language: preferredText(localEdition.language, serverEdition.language),
      editionName: preferredText(localEdition.editionName, serverEdition.editionName),
      binding: preferredText(localEdition.binding, serverEdition.binding),
      externalSource: localEdition.externalSource ?? serverEdition.externalSource,
      externalEditionId: preferredText(localEdition.externalEditionId, serverEdition.externalEditionId),
      pageCount: localEdition.pageCount || serverEdition.pageCount,
      specialFeatures: localEdition.specialFeatures?.length ? localEdition.specialFeatures : serverEdition.specialFeatures,
      coverGradient: localEdition.coverGradient || serverEdition.coverGradient,
    };
  });

  serverEditions.forEach((edition) => mergedEditions.push(edition));

  const localSummary = localBook.work.summary?.trim();
  const localSummaryMissing = !localSummary || localSummary.toLowerCase() === 'summary unavailable.';

  return {
    ...serverBook,
    ...localBook,
    work: {
      ...serverBook.work,
      ...localBook.work,
      subtitle: preferredText(localBook.work.subtitle, serverBook.work.subtitle),
      summary: localSummaryMissing
        ? (preferredText(serverBook.work.summary, serverBook.work.publisherSummary) ?? localBook.work.summary)
        : localBook.work.summary,
      publisherSummary: preferredText(localBook.work.publisherSummary, serverBook.work.publisherSummary),
      genres: localBook.work.genres?.length ? localBook.work.genres : serverBook.work.genres,
      publicationYear: localBook.work.publicationYear || serverBook.work.publicationYear,
      originalLanguage: preferredText(localBook.work.originalLanguage, serverBook.work.originalLanguage),
      externalWorkId: preferredText(localBook.work.externalWorkId, serverBook.work.externalWorkId),
    },
    editions: mergedEditions,
    activeEditionId: mergedEditions.some((edition) => edition.id === localBook.activeEditionId)
      ? localBook.activeEditionId
      : serverBook.activeEditionId,
    importMetadataVerified: localBook.importMetadataVerified === true || serverBook.importMetadataVerified === true,
    importMetadataReviewNeeded: localBook.importMetadataReviewNeeded ?? serverBook.importMetadataReviewNeeded,
    sourceOfImport: localBook.sourceOfImport || serverBook.sourceOfImport,
  };
}

export function mergeBooksFromServer(
  current: UserBookRecord[],
  server: UserBookRecord[],
  pending: Record<string, PendingMutation<UserBookRecord>>,
): UserBookRecord[] {
  const serverById = new Map(server.map((book) => [book.id, book]));
  const merged = current.map((localBook) => {
    const serverBook = serverById.get(localBook.id);
    if (!serverBook) return localBook;
    serverById.delete(localBook.id);

    const pendingMutation = pending[localBook.id];
    if (pendingMutation?.operation === 'delete') return localBook;

    if (pendingMutation?.operation === 'upsert' && pendingMutation.data) {
      // Unsynced local intent wins. Server metadata may fill genuine gaps, but
      // never replace the pending reader-owned state.
      return mergeServerMetadataIntoBook(pendingMutation.data, serverBook);
    }

    // No local mutation is pending: the account copy is the canonical latest
    // record. Preserve only the explicitly protected reader-owned fields whose
    // dedicated merge policies are intentionally stronger than provider/cloud
    // replacement (quotes, loan state, and manual cover choices).
    const withQuotes = mergeIncomingBookQuoteState(localBook, serverBook);
    const withLoan = mergeIncomingBookLoanState(localBook, withQuotes);
    return mergeIncomingManualCoverState(localBook, withLoan);
  });

  serverById.forEach((serverBook, id) => {
    if (pending[id]?.operation !== 'delete') merged.push(serverBook);
  });

  return merged;
}

function compactProfileForRuntime(profile: Record<string, unknown>): Record<string, unknown> {
  const compact = { ...profile };
  delete compact.avatarImageData;
  delete compact.bannerImageData;
  delete compact.avatarMediaKey;
  delete compact.bannerMediaKey;
  return compact;
}

/**
 * Full collection reads are reserved for an explicit user/admin recovery-style
 * refresh. Everyday startup and cross-device reconciliation belong to the
 * adaptive one-shot/delta bridges. Keeping those roles separate avoids repeated
 * full-library reads and, more importantly, prevents an intentional empty local
 * library from being "recovered" back into existence while its deletions are
 * still syncing.
 */
export const CloudServerRefreshBridge: React.FC = () => {
  const { user } = useAccountSync();
  const running = useRef(false);

  useEffect(() => {
    if (!user || !db) {
      publishCloudSyncHealth({
        status: 'idle',
        lastSuccessfulSyncAt: null,
        message: user ? 'Your saved library is temporarily unavailable.' : 'Waiting for sign-in.',
      });
      return undefined;
    }

    const uid = user.uid;
    let disposed = false;
    const storage = getRuntimeStorage();

    // Older builds paused metadata enrichment as a module-load side effect. That
    // state did not represent a reader choice, so clear it exactly once after the
    // fixed build opens. Future pause semantics remain untouched after migration.
    if (storage.getItem(LEGACY_AUTOPAUSE_MIGRATION_KEY) !== '1') {
      storage.removeItem(IMPORT_ENRICHMENT_PAUSED_KEY);
      storage.setItem(LEGACY_AUTOPAUSE_MIGRATION_KEY, '1');
    }

    const libraryManifestRef = doc(db, 'users', uid, 'syncState', 'library');

    const pendingState = () => readJson<PendingSyncState>(syncPendingStateKey(uid), {
      books: {},
      sessions: {},
    });

    const repairIncompleteCloudLibrary = async (expected: number, uploaded: number) => {
      if (expected <= 0 || uploaded >= expected) return uploaded;

      const localBooks = readJson<UserBookRecord[]>(BOOKS_KEY, []);
      if (localBooks.length < expected) return uploaded;

      const cloudSnapshot = await getDocs(collection(db!, 'users', uid, 'books'));
      const cloudIds = new Set(cloudSnapshot.docs.map((item) => item.id));
      const missingBooks = localBooks.filter((book) => book?.id && !cloudIds.has(book.id));
      if (missingBooks.length === 0) return cloudSnapshot.size;

      publishCloudSyncHealth({
        status: 'checking',
        lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
        message: `Inkbound found ${missingBooks.length.toLocaleString()} local book${missingBooks.length === 1 ? '' : 's'} missing from your saved account copy. Repairing that upload now…`,
      });

      const clientUpdatedAt = new Date().toISOString();
      for (let index = 0; index < missingBooks.length; index += REPAIR_UPLOAD_BATCH_SIZE) {
        if (disposed) return uploaded;
        const batch = missingBooks.slice(index, index + REPAIR_UPLOAD_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map((book) => setDoc(
          doc(db!, 'users', uid, 'books', book.id),
          {
            data: book,
            updatedAt: serverTimestamp(),
            clientUpdatedAt,
          },
          { merge: true },
        )));

        results.forEach((result) => {
          if (result.status === 'rejected') {
            console.warn('Inkbound manual refresh could not repair one missing book yet.', result.reason);
          }
        });
      }

      const repairedCount = await getCountFromServer(collection(db!, 'users', uid, 'books'));
      return repairedCount.data().count;
    };

    const verifyCloudLibraryComplete = async () => {
      const manifestSnapshot = await getDoc(libraryManifestRef);
      if (!manifestSnapshot.exists()) return { complete: true, expected: 0, uploaded: 0 };

      const manifest = manifestSnapshot.data() as LibrarySyncManifest;
      const expected = Math.max(0, manifest.expectedBookCount ?? 0);
      const countSnapshot = await getCountFromServer(collection(db!, 'users', uid, 'books'));
      let uploaded = countSnapshot.data().count;

      // A shrinking library is only complete when the cloud count reaches the
      // expected count exactly. For a previously-complete non-empty manifest,
      // additional books from another device are safe to read; fewer books are
      // never treated as complete. Expected zero always requires actual zero so a
      // delete-all operation cannot be "verified" while stale books remain.
      let complete = expected === 0
        ? uploaded === 0
        : manifest.status === 'syncing'
          ? uploaded === expected
          : uploaded >= expected;

      // Manual "Try again" is also our recovery escape hatch for older partial
      // growth uploads whose missing records vanished from the durable pending
      // queue. Only attempt this when cloud is below the expected count and the
      // browser still holds at least the full expected local library. We compare
      // document IDs and upload only cloud-missing books, so existing cloud data
      // is never replaced wholesale.
      if (!complete && uploaded < expected) {
        uploaded = await repairIncompleteCloudLibrary(expected, uploaded);
        complete = expected === 0
          ? uploaded === 0
          : manifest.status === 'syncing'
            ? uploaded === expected
            : uploaded >= expected;
      }

      if (complete && manifest.status !== 'complete') {
        await setDoc(libraryManifestRef, {
          status: 'complete',
          expectedBookCount: expected,
          uploadedBookCount: uploaded,
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else if (!complete) {
        await setDoc(libraryManifestRef, {
          status: 'syncing',
          expectedBookCount: expected,
          uploadedBookCount: uploaded,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      return { complete, expected, uploaded };
    };

    const refreshFromServer = async () => {
      if (running.current || disposed || !navigator.onLine) return;
      running.current = true;
      publishCloudSyncHealth({
        status: 'checking',
        lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
        message: 'Checking for your latest saved books and reading activity…',
      });

      try {
        const syncState = await verifyCloudLibraryComplete();
        if (disposed) return;
        if (!syncState.complete) {
          publishCloudSyncHealth({
            status: 'error',
            lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
            message: `Your cloud library is still finishing its sync (${syncState.uploaded.toLocaleString()} of ${syncState.expected.toLocaleString()} books). Inkbound kept the library already on this device unchanged.`,
          });
          return;
        }

        const [bookSnapshot, sessionSnapshot, profileSnapshot] = await Promise.all([
          getDocs(collection(db!, 'users', uid, 'books')),
          getDocs(collection(db!, 'users', uid, 'sessions')),
          getDoc(doc(db!, 'users', uid, 'profile', 'current')),
        ]);
        if (disposed) return;

        const pending = pendingState();
        const serverBooks = bookSnapshot.docs
          .map((item) => (item.data() as CloudRecord<UserBookRecord>).data)
          .filter(Boolean);
        const serverSessions = sessionSnapshot.docs
          .map((item) => (item.data() as CloudRecord<ReadingSession>).data)
          .filter(Boolean);

        if (syncState.expected > 0 && serverBooks.length < syncState.expected) {
          publishCloudSyncHealth({
            status: 'error',
            lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
            message: `Inkbound found only ${serverBooks.length.toLocaleString()} of ${syncState.expected.toLocaleString()} expected books online. The library already on this device was kept unchanged.`,
          });
          return;
        }

        const currentBooks = readJson<UserBookRecord[]>(BOOKS_KEY, []);
        const currentSessions = readJson<ReadingSession[]>(SESSIONS_KEY, []);
        const migrationVerified = storage.getItem(accountLibraryMigrationVersionKey(uid))
          === ACCOUNT_LIBRARY_MIGRATION_VERSION;

        // Never describe an empty/partial cloud library as healthy while this
        // device visibly holds an existing pre-account library. This is the
        // exact P0 state where older builds reported "0 books checked" despite
        // hundreds of local books and could later let empty cloud look
        // authoritative.
        if (!canReportCloudLibraryHealthy({
          localBookCount: currentBooks.length,
          cloudBookCount: serverBooks.length,
          migrationVerified,
        })) {
          publishCloudSyncHealth({
            status: 'error',
            lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
            message: `Inkbound found ${currentBooks.length.toLocaleString()} book${currentBooks.length === 1 ? '' : 's'} on this device but only ${serverBooks.length.toLocaleString()} saved to your account. Your local library was kept unchanged while Inkbound finishes attaching it to this account.`,
          });
          return;
        }
        const nextBooks = mergeBooksFromServer(currentBooks, serverBooks, pending.books ?? {});
        const nextSessions = mergeServerCollectionById(currentSessions, serverSessions, pending.sessions ?? {});
        const changedKeys: Array<typeof BOOKS_KEY | typeof SESSIONS_KEY | typeof PROFILE_KEY> = [];

        if (JSON.stringify(currentBooks) !== JSON.stringify(nextBooks)) {
          writeJson(BOOKS_KEY, nextBooks);
          changedKeys.push(BOOKS_KEY);
        }
        if (JSON.stringify(currentSessions) !== JSON.stringify(nextSessions)) {
          writeJson(SESSIONS_KEY, nextSessions);
          changedKeys.push(SESSIONS_KEY);
        }

        if (!pending.profile && profileSnapshot.exists()) {
          const cloudProfile = (profileSnapshot.data() as CloudRecord<Record<string, unknown>>).data;
          if (cloudProfile) {
            const serialized = JSON.stringify(compactProfileForRuntime(cloudProfile));
            if (storage.getItem(PROFILE_KEY) !== serialized) {
              storage.setItem(PROFILE_KEY, serialized);
              changedKeys.push(PROFILE_KEY);
            }
          }
        }

        if (changedKeys.length) notifyCloudDataUpdated(changedKeys);
        const syncedAt = new Date().toISOString();
        storage.setItem(LAST_SYNC_STORAGE_KEY, syncedAt);
        publishCloudSyncHealth({
          status: 'healthy',
          lastSuccessfulSyncAt: syncedAt,
          message: `Your library is up to date. ${serverBooks.length.toLocaleString()} saved books were checked.`,
        });
      } catch (error) {
        console.error('Inkbound manual cloud refresh failed.', error);
        publishCloudSyncHealth({
          status: 'error',
          lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
          message: 'Inkbound could not check for updates right now. The library already on this device was left unchanged.',
        });
      } finally {
        running.current = false;
      }
    };

    window.addEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, refreshFromServer);
    return () => {
      disposed = true;
      window.removeEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, refreshFromServer);
    };
  }, [user?.uid]);

  return null;
};
