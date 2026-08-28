import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
} from 'firebase/firestore';
import type { Edition, ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { notifyCloudDataUpdated } from './cloudSyncEvents';
import {
  INKBOUND_FORCE_CLOUD_REFRESH_EVENT,
  publishCloudSyncHealth,
} from './cloudSyncHealth';

const BOOKS_KEY = 'inkbound_books';
const SESSIONS_KEY = 'inkbound_sessions';
const PROFILE_KEY = 'inkbound_reader_profile';
const LAST_SYNC_STORAGE_KEY = 'inkbound_last_cloud_sync_at';
const REFRESH_INTERVAL_MS = 30_000;

interface CloudRecord<T> {
  data: T;
  clientUpdatedAt?: string;
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

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = getRuntimeStorage().getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function preferText(serverValue: string | undefined, localValue: string | undefined) {
  return serverValue?.trim() ? serverValue : localValue;
}

function preferArray<T>(serverValue: T[] | undefined, localValue: T[] | undefined) {
  return serverValue?.length ? serverValue : localValue;
}

function mergeEditionPreservingLocalMetadata(local: Edition | undefined, server: Edition): Edition {
  if (!local) return server;
  if (local.externalSource === 'manual' && server.externalSource !== 'manual') return local;

  return {
    ...server,
    isbn: preferText(server.isbn, local.isbn),
    isbn10: preferText(server.isbn10, local.isbn10),
    isbn13: preferText(server.isbn13, local.isbn13),
    asin: preferText(server.asin, local.asin),
    pageCount: server.pageCount ?? local.pageCount,
    audiobookDurationMins: server.audiobookDurationMins ?? local.audiobookDurationMins,
    narrator: preferText(server.narrator, local.narrator),
    publisher: preferText(server.publisher, local.publisher),
    publicationDate: preferText(server.publicationDate, local.publicationDate),
    coverUrl: preferText(server.coverUrl, local.coverUrl),
    language: preferText(server.language, local.language),
    editionName: preferText(server.editionName, local.editionName),
    binding: preferText(server.binding, local.binding),
    specialFeatures: preferArray(server.specialFeatures, local.specialFeatures),
    externalEditionId: preferText(server.externalEditionId, local.externalEditionId),
  };
}

function mergeBookPreservingLocalMetadata(local: UserBookRecord | undefined, server: UserBookRecord): UserBookRecord {
  if (!local) return server;

  const localEditions = new Map(local.editions.map((edition) => [edition.id, edition]));
  const mergedEditions = server.editions.map((edition) => mergeEditionPreservingLocalMetadata(localEditions.get(edition.id), edition));
  const serverEditionIds = new Set(server.editions.map((edition) => edition.id));
  local.editions.forEach((edition) => {
    if (!serverEditionIds.has(edition.id) && edition.externalSource === 'manual') mergedEditions.push(edition);
  });

  return {
    ...server,
    work: {
      ...server.work,
      subtitle: preferText(server.work.subtitle, local.work.subtitle),
      summary: preferText(server.work.summary, local.work.summary) ?? '',
      publisherSummary: preferText(server.work.publisherSummary, local.work.publisherSummary),
      personalSummary: preferText(server.work.personalSummary, local.work.personalSummary),
      seriesName: preferText(server.work.seriesName, local.work.seriesName),
      seriesOrder: server.work.seriesOrder ?? local.work.seriesOrder,
      genres: preferArray(server.work.genres, local.work.genres) ?? [],
      tropes: preferArray(server.work.tropes, local.work.tropes),
      contentWarnings: preferArray(server.work.contentWarnings, local.work.contentWarnings),
      publicationYear: server.work.publicationYear || local.work.publicationYear,
      originalLanguage: preferText(server.work.originalLanguage, local.work.originalLanguage),
      externalWorkId: preferText(server.work.externalWorkId, local.work.externalWorkId),
    },
    editions: mergedEditions,
    activeEditionId: mergedEditions.some((edition) => edition.id === server.activeEditionId)
      ? server.activeEditionId
      : local.activeEditionId,
    importMetadataVerified: server.importMetadataVerified || local.importMetadataVerified,
  };
}

function mergeServerBooks(
  current: UserBookRecord[],
  server: UserBookRecord[],
  pending: Record<string, PendingMutation<UserBookRecord>>,
): UserBookRecord[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  server.forEach((item) => {
    if (pending[item.id]) return;
    merged.set(item.id, mergeBookPreservingLocalMetadata(merged.get(item.id), item));
  });
  return [...merged.values()];
}

function mergeServerRecords<T extends { id: string }>(
  current: T[],
  server: T[],
  pending: Record<string, PendingMutation<T>>,
): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  server.forEach((item) => {
    if (!pending[item.id]) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function compactProfileForRuntime(profile: Record<string, unknown>): Record<string, unknown> {
  const compact = { ...profile };

  // Older builds briefly kept full base64 profile images in the profile object.
  // Media now belongs in IndexedDB/Firebase Storage, so keeping those legacy
  // blobs in localStorage can exhaust the browser quota on large libraries.
  // Never mutate the cloud record here; this is only the lightweight device cache.
  delete compact.avatarImageData;
  delete compact.bannerImageData;
  delete compact.avatarMediaKey;
  delete compact.bannerMediaKey;

  return compact;
}

function isBrowserStorageQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === 'QuotaExceededError'
    || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || error.code === 22
    || error.code === 1014;
}

function errorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown cloud error');
  return [code, message].filter(Boolean).join(': ');
}

/**
 * A server refresh fallback for browsers whose long-lived Firestore listener is
 * unreliable. Server records update normal account state, but book metadata is
 * merged conservatively so a stale cloud copy cannot erase a richer local
 * edition, summary, cover, series match, ISBN, page count, or manual edit.
 */
export const CloudServerRefreshBridge: React.FC = () => {
  const { user } = useAccountSync();
  const running = useRef(false);

  useEffect(() => {
    if (!user || !db) {
      publishCloudSyncHealth({
        status: 'idle',
        lastSuccessfulSyncAt: null,
        message: user ? 'Cloud database is unavailable.' : 'Waiting for sign-in.',
      });
      return undefined;
    }

    const uid = user.uid;
    let disposed = false;

    const refreshFromServer = async () => {
      if (running.current || disposed || !navigator.onLine) return;
      running.current = true;
      publishCloudSyncHealth({
        status: 'checking',
        lastSuccessfulSyncAt: getRuntimeStorage().getItem(LAST_SYNC_STORAGE_KEY),
        message: 'Checking the Inkbound cloud for newer account data…',
      });

      try {
        const [bookSnapshot, sessionSnapshot, profileSnapshot] = await Promise.all([
          getDocsFromServer(collection(db, 'users', uid, 'books')),
          getDocsFromServer(collection(db, 'users', uid, 'sessions')),
          getDocFromServer(doc(db, 'users', uid, 'profile', 'current')),
        ]);
        if (disposed) return;

        const pending = readJson<PendingSyncState>(`inkbound_pending_sync_${uid}_v1`, {
          books: {},
          sessions: {},
        });

        const serverBooks = bookSnapshot.docs
          .map((item) => (item.data() as CloudRecord<UserBookRecord>).data)
          .filter(Boolean);
        const serverSessions = sessionSnapshot.docs
          .map((item) => (item.data() as CloudRecord<ReadingSession>).data)
          .filter(Boolean);

        const currentBooks = readJson<UserBookRecord[]>(BOOKS_KEY, []);
        const currentSessions = readJson<ReadingSession[]>(SESSIONS_KEY, []);
        const nextBooks = mergeServerBooks(currentBooks, serverBooks, pending.books ?? {});
        const nextSessions = mergeServerRecords(currentSessions, serverSessions, pending.sessions ?? {});

        const changedKeys: Array<'inkbound_books' | 'inkbound_sessions' | 'inkbound_reader_profile'> = [];
        const storage = getRuntimeStorage();
        const nextBooksJson = JSON.stringify(nextBooks);
        const nextSessionsJson = JSON.stringify(nextSessions);
        if (storage.getItem(BOOKS_KEY) !== nextBooksJson) {
          storage.setItem(BOOKS_KEY, nextBooksJson);
          changedKeys.push(BOOKS_KEY);
        }
        if (storage.getItem(SESSIONS_KEY) !== nextSessionsJson) {
          storage.setItem(SESSIONS_KEY, nextSessionsJson);
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
          message: `Cloud sync is healthy. Verified ${serverBooks.length.toLocaleString()} books from the server.`,
        });
      } catch (error) {
        console.error('Inkbound authoritative cloud refresh failed.', error);
        publishCloudSyncHealth({
          status: 'error',
          lastSuccessfulSyncAt: getRuntimeStorage().getItem(LAST_SYNC_STORAGE_KEY),
          message: isBrowserStorageQuotaError(error)
            ? 'Inkbound reached this browser\'s local cache limit while refreshing account data. Your cloud library is still safe; refresh after updating Inkbound so the smaller profile cache can be used.'
            : `Cloud sync could not reach Firebase: ${errorMessage(error)}`,
        });
      } finally {
        running.current = false;
      }
    };

    void refreshFromServer();
    const interval = window.setInterval(() => void refreshFromServer(), REFRESH_INTERVAL_MS);
    const unsubscribeResume = subscribeToRuntimeResume(() => void refreshFromServer());
    const forceRefresh = () => void refreshFromServer();
    window.addEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, forceRefresh);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      unsubscribeResume();
      window.removeEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, forceRefresh);
    };
  }, [user?.uid]);

  return null;
};
