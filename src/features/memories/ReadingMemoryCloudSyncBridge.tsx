import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import {
  getRuntimeStorage,
  notifyRuntimeStorageChanged,
} from '../../platform/runtimeStorage';
import { READING_MEMORIES_ACCOUNT_KEY } from '../sync/auxiliaryAccountSyncConfig';
import {
  INKBOUND_BEFORE_SIGN_OUT_EVENT,
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type BeforeSignOutDetail,
  type LocalDataChangedDetail,
} from '../sync/cloudSyncEvents';

interface ReadingMemoryEntry {
  feeling: string;
  lifeMoment: string;
  futureSelfLetter: string;
  favoriteMoment: string;
  updatedAt: string;
}

type ReadingMemoryMap = Record<string, ReadingMemoryEntry>;

interface CloudMemoryDocument extends ReadingMemoryEntry {
  serverUpdatedAt?: unknown;
}

interface LegacyAuxiliaryMemoryDocument {
  data?: ReadingMemoryMap;
}

const FALLBACK_SYNC_INTERVAL_MS = 30000;
const storage = () => getRuntimeStorage();
const stable = (value: unknown) => JSON.stringify(value);

function isMemoryEntry(value: unknown): value is ReadingMemoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ReadingMemoryEntry>;
  return typeof entry.feeling === 'string'
    && typeof entry.lifeMoment === 'string'
    && typeof entry.futureSelfLetter === 'string'
    && typeof entry.favoriteMoment === 'string'
    && typeof entry.updatedAt === 'string';
}

function readLocalMemories(): ReadingMemoryMap {
  try {
    const raw = storage().getItem(READING_MEMORIES_ACCOUNT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => isMemoryEntry(value)),
    ) as ReadingMemoryMap;
  } catch {
    return {};
  }
}

function writeLocalMemories(memories: ReadingMemoryMap) {
  storage().setItem(READING_MEMORIES_ACCOUNT_KEY, stable(memories));
  notifyRuntimeStorageChanged(READING_MEMORIES_ACCOUNT_KEY);
}

function timestamp(entry: ReadingMemoryEntry | undefined): number {
  if (!entry?.updatedAt) return 0;
  const value = Date.parse(entry.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

function mergeMemoryMaps(base: ReadingMemoryMap, incoming: ReadingMemoryMap): ReadingMemoryMap {
  const merged: ReadingMemoryMap = { ...base };

  Object.entries(incoming).forEach(([bookId, incomingEntry]) => {
    const current = merged[bookId];
    if (!current) {
      merged[bookId] = incomingEntry;
      return;
    }

    const currentTime = timestamp(current);
    const incomingTime = timestamp(incomingEntry);
    if (incomingTime >= currentTime) merged[bookId] = incomingEntry;
  });

  return merged;
}

function cloudDocumentToEntry(data: CloudMemoryDocument): ReadingMemoryEntry | undefined {
  const candidate = {
    feeling: data.feeling,
    lifeMoment: data.lifeMoment,
    futureSelfLetter: data.futureSelfLetter,
    favoriteMoment: data.favoriteMoment,
    updatedAt: data.updatedAt,
  };
  return isMemoryEntry(candidate) ? candidate : undefined;
}

/**
 * Cross-device synchronization for Reading Memories.
 *
 * Memories remain one Firestore document per book, but local edits now trigger
 * sync through Inkbound's debounced storage-change signal. A slow fallback timer
 * exists only for edge cases; leaving the app open no longer wakes this bridge
 * every 1.8 seconds looking for work.
 */
export const ReadingMemoryCloudSyncBridge: React.FC = () => {
  const sync = useAccountSync();
  const hydrated = useRef(false);
  const fingerprints = useRef<Record<string, string>>({});
  const flushRunning = useRef(false);

  useEffect(() => {
    hydrated.current = false;
    fingerprints.current = {};
    flushRunning.current = false;

    if (!sync.user || !db) return undefined;
    const uid = sync.user.uid;
    let disposed = false;

    const memoryCollection = collection(db, 'users', uid, 'readingMemories');

    const flushLocalChanges = async () => {
      if (!hydrated.current || disposed || flushRunning.current || !navigator.onLine) return;
      flushRunning.current = true;

      try {
        const local = readLocalMemories();
        const changed = Object.entries(local).filter(
          ([bookId, entry]) => fingerprints.current[bookId] !== stable(entry),
        );

        if (changed.length === 0) return;

        await Promise.all(changed.map(async ([bookId, entry]) => {
          const sentFingerprint = stable(entry);
          await setDoc(
            doc(db!, 'users', uid, 'readingMemories', bookId),
            {
              ...entry,
              serverUpdatedAt: serverTimestamp(),
            },
            { merge: true },
          );

          const latest = readLocalMemories()[bookId];
          if (latest && stable(latest) === sentFingerprint) {
            fingerprints.current[bookId] = sentFingerprint;
          }
        }));
      } finally {
        flushRunning.current = false;
      }
    };

    const initialize = async () => {
      const local = readLocalMemories();
      let cloud: ReadingMemoryMap = {};
      let legacy: ReadingMemoryMap = {};

      try {
        const [cloudSnapshot, legacySnapshot] = await Promise.all([
          getDocs(memoryCollection),
          getDoc(doc(db!, 'users', uid, 'auxiliary', 'readingMemories')),
        ]);

        cloudSnapshot.docs.forEach((snapshot) => {
          const entry = cloudDocumentToEntry(snapshot.data() as CloudMemoryDocument);
          if (entry) cloud[snapshot.id] = entry;
        });

        if (legacySnapshot.exists()) {
          const legacyData = (legacySnapshot.data() as LegacyAuxiliaryMemoryDocument).data;
          if (legacyData && typeof legacyData === 'object') {
            legacy = Object.fromEntries(
              Object.entries(legacyData).filter(([, value]) => isMemoryEntry(value)),
            ) as ReadingMemoryMap;
          }
        }
      } catch {
        // Offline startup remains local-first.
      }

      if (disposed) return;

      const migratedCloud = mergeMemoryMaps(legacy, cloud);
      const merged = mergeMemoryMaps(migratedCloud, local);
      writeLocalMemories(merged);

      Object.entries(cloud).forEach(([bookId, entry]) => {
        fingerprints.current[bookId] = stable(entry);
      });

      hydrated.current = true;
      await flushLocalChanges();
    };

    void initialize().catch(() => {
      if (disposed) return;
      hydrated.current = true;
    });

    const unsubscribe = onSnapshot(
      memoryCollection,
      (snapshot) => {
        if (!hydrated.current || disposed) return;
        const local = readLocalMemories();
        let nextLocal = local;
        let changedLocal = false;

        snapshot.docChanges().forEach((change) => {
          if (change.type === 'removed') return;
          const entry = cloudDocumentToEntry(change.doc.data() as CloudMemoryDocument);
          if (!entry) return;

          const bookId = change.doc.id;
          const cloudFingerprint = stable(entry);
          const localEntry = nextLocal[bookId];
          const localFingerprint = localEntry ? stable(localEntry) : undefined;
          const localIsDirty = localFingerprint !== undefined
            && fingerprints.current[bookId] !== localFingerprint;

          if (localIsDirty) return;

          fingerprints.current[bookId] = cloudFingerprint;
          if (localFingerprint === cloudFingerprint) return;

          nextLocal = { ...nextLocal, [bookId]: entry };
          changedLocal = true;
        });

        if (changedLocal) writeLocalMemories(nextLocal);
      },
      () => {
        // Local storage remains durable while offline.
      },
    );

    const handleLocalDataChanged = (event: Event) => {
      const detail = (event as CustomEvent<LocalDataChangedDetail>).detail;
      if (!detail?.keys?.includes(READING_MEMORIES_ACCOUNT_KEY)) return;
      void flushLocalChanges().catch(() => undefined);
    };

    const fallbackTimer = window.setInterval(() => {
      void flushLocalChanges().catch(() => undefined);
    }, FALLBACK_SYNC_INTERVAL_MS);

    const preserveBeforeBackgrounding = () => {
      void flushLocalChanges().catch(() => undefined);
    };

    const flushBeforeSignOut = (event: Event) => {
      const detail = (event as CustomEvent<BeforeSignOutDetail>).detail;
      if (detail?.uid !== uid) return;
      detail.waitUntil(flushLocalChanges());
    };

    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalDataChanged);
    window.addEventListener('online', preserveBeforeBackgrounding);
    window.addEventListener('pagehide', preserveBeforeBackgrounding);
    document.addEventListener('visibilitychange', preserveBeforeBackgrounding);
    window.addEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);

    return () => {
      preserveBeforeBackgrounding();
      disposed = true;
      window.clearInterval(fallbackTimer);
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalDataChanged);
      window.removeEventListener('online', preserveBeforeBackgrounding);
      window.removeEventListener('pagehide', preserveBeforeBackgrounding);
      document.removeEventListener('visibilitychange', preserveBeforeBackgrounding);
      window.removeEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);
      unsubscribe();
    };
  }, [sync.user?.uid]);

  return null;
};
