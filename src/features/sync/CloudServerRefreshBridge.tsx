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
import { db } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  notifyCloudDataUpdated,
  type CloudDataUpdatedDetail,
} from './cloudSyncEvents';
import {
  INKBOUND_FORCE_CLOUD_REFRESH_EVENT,
  publishCloudSyncHealth,
} from './cloudSyncHealth';

const BOOKS_KEY = 'inkbound_books';
const SESSIONS_KEY = 'inkbound_sessions';
const PROFILE_KEY = 'inkbound_reader_profile';
const LAST_SYNC_STORAGE_KEY = 'inkbound_last_cloud_sync_at';
const IMPORT_ENRICHMENT_PAUSED_KEY = 'inkbound_import_enrichment_paused_v1';
const IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY = 'inkbound_import_enrichment_retry_progress_v1';
const IMPORT_ENRICHMENT_ACTIVE_RETRY_KEY = 'inkbound_import_enrichment_active_retry_v1';
const CATASTROPHIC_EMPTY_LIBRARY_MIN_BOOKS = 20;

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

interface RetryProgress {
  status?: string;
  completed?: number;
  total?: number;
  matched?: number;
  covers?: number;
  summaries?: number;
  updatedAt?: string;
}

interface LibrarySyncManifest {
  status?: 'syncing' | 'complete';
  expectedBookCount?: number;
  uploadedBookCount?: number;
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

function mergeMissingById<T extends { id: string }>(current: T[], server: T[], pending: Record<string, PendingMutation<T>>): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  server.forEach((item) => {
    if (!pending[item.id] && !merged.has(item.id)) merged.set(item.id, item);
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

function mergeBooksFromServer(
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

    const sourceBook = pendingMutation?.operation === 'upsert' && pendingMutation.data
      ? pendingMutation.data
      : localBook;
    return mergeServerMetadataIntoBook(sourceBook, serverBook);
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

function pauseAutomaticMetadataWork() {
  const storage = getRuntimeStorage();
  storage.setItem(IMPORT_ENRICHMENT_PAUSED_KEY, 'true');
  storage.removeItem(IMPORT_ENRICHMENT_ACTIVE_RETRY_KEY);

  const progress = readJson<RetryProgress | null>(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY, null);
  if (!progress) return;

  const completed = progress.completed ?? 0;
  const total = progress.total ?? 0;

  if (total > 0 && completed >= total) {
    writeJson(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY, {
      status: 'complete',
      completed: total,
      total,
      matched: progress.matched ?? 0,
      covers: progress.covers ?? 0,
      summaries: progress.summaries ?? 0,
      message: `${total.toLocaleString()} books were checked. Books that still could not be matched remain safely queued for a future manual retry.`,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (progress.status !== 'queued' && progress.status !== 'running') return;

  writeJson(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY, {
    status: 'error',
    completed,
    total,
    matched: progress.matched ?? 0,
    covers: progress.covers ?? 0,
    summaries: progress.summaries ?? 0,
    message: 'Automatic missing-detail retries were paused. Start a retry manually when you want Inkbound to check those books.',
    updatedAt: new Date().toISOString(),
  });
}

pauseAutomaticMetadataWork();

export const CloudServerRefreshBridge: React.FC = () => {
  const { user } = useAccountSync();
  const running = useRef(false);
  const knownBooks = useRef<UserBookRecord[]>(readJson<UserBookRecord[]>(BOOKS_KEY, []));

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
    const libraryManifestRef = doc(db, 'users', uid, 'syncState', 'library');

    const pendingState = () => readJson<PendingSyncState>(`inkbound_pending_sync_${uid}_v1`, {
      books: {},
      sessions: {},
    });

    const verifyCloudLibraryComplete = async () => {
      const manifestSnapshot = await getDoc(libraryManifestRef);
      if (!manifestSnapshot.exists()) return { complete: true, expected: 0, uploaded: 0 };

      const manifest = manifestSnapshot.data() as LibrarySyncManifest;
      const expected = Math.max(0, manifest.expectedBookCount ?? 0);
      if (!expected) return { complete: true, expected: 0, uploaded: 0 };

      const countSnapshot = await getCountFromServer(collection(db!, 'users', uid, 'books'));
      const uploaded = countSnapshot.data().count;
      const complete = uploaded >= expected;

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

    const restoreCatastrophicEmptyLibrary = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      if (!(detail?.keys ?? []).includes(BOOKS_KEY)) return;

      const current = readJson<UserBookRecord[]>(BOOKS_KEY, []);
      if (current.length > 0) {
        knownBooks.current = current;
        return;
      }

      if (knownBooks.current.length < CATASTROPHIC_EMPTY_LIBRARY_MIN_BOOKS) return;
      if (storage.getItem(`inkbound_local_clear_intent_${uid}`) === '1') return;

      writeJson(BOOKS_KEY, knownBooks.current);
      notifyCloudDataUpdated([BOOKS_KEY]);
      publishCloudSyncHealth({
        status: 'error',
        lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
        message: `Inkbound protected your library and kept ${knownBooks.current.length.toLocaleString()} books visible after an unexpected empty-library update.`,
      });
    };

    const recoverBooksIfLocalCacheIsEmpty = async () => {
      if (running.current || disposed || !navigator.onLine) return;
      const current = readJson<UserBookRecord[]>(BOOKS_KEY, []);
      if (current.length > 0) {
        knownBooks.current = current;
        publishCloudSyncHealth({
          status: 'healthy',
          lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
          message: 'Your latest changes are saved and available across your signed-in devices.',
        });
        return;
      }

      running.current = true;
      publishCloudSyncHealth({
        status: 'checking',
        lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
        message: 'Checking your saved library before restoring it to this device…',
      });

      try {
        const syncState = await verifyCloudLibraryComplete();
        if (disposed) return;
        if (!syncState.complete) {
          publishCloudSyncHealth({
            status: 'error',
            lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
            message: `Your cloud library is still finishing its backup (${syncState.uploaded.toLocaleString()} of ${syncState.expected.toLocaleString()} books saved). Inkbound did not replace this device with an incomplete copy. Open the device that imported the library and let it finish syncing.`,
          });
          return;
        }

        const snapshot = await getDocs(collection(db, 'users', uid, 'books'));
        if (disposed) return;
        const serverBooks = snapshot.docs
          .map((item) => (item.data() as CloudRecord<UserBookRecord>).data)
          .filter(Boolean);

        if (syncState.expected > 0 && serverBooks.length < syncState.expected) {
          publishCloudSyncHealth({
            status: 'error',
            lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
            message: `Inkbound found only ${serverBooks.length.toLocaleString()} of ${syncState.expected.toLocaleString()} expected books online, so it left this device untouched instead of restoring an incomplete library.`,
          });
          return;
        }

        if (serverBooks.length > 0) {
          writeJson(BOOKS_KEY, serverBooks);
          knownBooks.current = serverBooks;
          notifyCloudDataUpdated([BOOKS_KEY]);
        }

        const syncedAt = new Date().toISOString();
        storage.setItem(LAST_SYNC_STORAGE_KEY, syncedAt);
        publishCloudSyncHealth({
          status: serverBooks.length > 0 ? 'healthy' : 'error',
          lastSuccessfulSyncAt: syncedAt,
          message: serverBooks.length > 0
            ? `Restored ${serverBooks.length.toLocaleString()} saved books to this device.`
            : 'No saved books were found online. Inkbound did not create or delete anything during this check.',
        });
      } catch (error) {
        console.error('Inkbound one-time library recovery failed.', error);
        publishCloudSyncHealth({
          status: 'error',
          lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
          message: 'Inkbound could not finish checking your saved library. Your existing data was left unchanged.',
        });
      } finally {
        running.current = false;
      }
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
            message: `Your cloud library is still finishing its backup (${syncState.uploaded.toLocaleString()} of ${syncState.expected.toLocaleString()} books saved). Inkbound kept the library already on this device instead of replacing it with an incomplete copy.`,
          });
          return;
        }

        const [bookSnapshot, sessionSnapshot, profileSnapshot] = await Promise.all([
          getDocs(collection(db, 'users', uid, 'books')),
          getDocs(collection(db, 'users', uid, 'sessions')),
          getDoc(doc(db, 'users', uid, 'profile', 'current')),
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
        const nextBooks = mergeBooksFromServer(currentBooks, serverBooks, pending.books ?? {});
        const nextSessions = mergeMissingById(currentSessions, serverSessions, pending.sessions ?? {});
        const changedKeys: Array<'inkbound_books' | 'inkbound_sessions' | 'inkbound_reader_profile'> = [];

        if (JSON.stringify(currentBooks) !== JSON.stringify(nextBooks)) {
          writeJson(BOOKS_KEY, nextBooks);
          knownBooks.current = nextBooks;
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

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, restoreCatastrophicEmptyLibrary);
    window.addEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, refreshFromServer);
    void recoverBooksIfLocalCacheIsEmpty();

    return () => {
      disposed = true;
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, restoreCatastrophicEmptyLibrary);
      window.removeEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, refreshFromServer);
    };
  }, [user?.uid]);

  return null;
};
