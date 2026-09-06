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
  type BeforeSignOutDetail,
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

const SYNC_INTERVAL_MS = 1800;
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

    // Reading Memories update updatedAt on every edit. Prefer the newer edit when
    // two devices both have a copy. If a legacy entry has no useful timestamp,
    // prefer the incoming value so migration can move forward deterministically.
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
 * Memories are stored one Firestore document per book instead of serializing the
 * entire memory map into one document. That prevents an edit to Book A on one
 * device from overwriting a newer Book B memory written on another device.
 * Local runtime storage remains the immediate/offline source so typing never
 * waits on the network.
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
      if (!hydrated.current || disposed || flushRunning.current) return;
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

          // The user may have typed again while this request was in flight. Only
          // mark the sent version clean if it is still the current local version.
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
        // Offline startup is intentionally local-first. The same local entries are
        // compared and uploaded when connectivity returns.
      }

      if (disposed) return;

      // Per-book cloud docs supersede the old monolithic auxiliary document, and
      // the newest local edit wins during initial reconciliation.
      const migratedCloud = mergeMemoryMaps(legacy, cloud);
      const merged = mergeMemoryMaps(migratedCloud, local);
      writeLocalMemories(merged);

      // Fingerprints represent what the per-book collection definitely contains.
      // Legacy-only and newer-local entries intentionally remain dirty so the
      // first flush migrates/uploads them into the new conflict-safe structure.
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

          // Never overwrite unsynced typing. Once the local edit reaches Firestore,
          // its own snapshot arrives and both devices converge normally.
          if (localIsDirty) return;

          fingerprints.current[bookId] = cloudFingerprint;
          if (localFingerprint === cloudFingerprint) return;

          nextLocal = { ...nextLocal, [bookId]: entry };
          changedLocal = true;
        });

        if (changedLocal) writeLocalMemories(nextLocal);
      },
      () => {
        // Local storage remains durable while offline. The polling flush resumes
        // automatically when Firestore becomes reachable again.
      },
    );

    const timer = window.setInterval(() => {
      void flushLocalChanges().catch(() => {
        // Keep local changes dirty so the next interval retries them.
      });
    }, SYNC_INTERVAL_MS);

    const preserveBeforeBackgrounding = () => {
      void flushLocalChanges().catch(() => {
        // Local runtime persistence already contains the newest text.
      });
    };

    const flushBeforeSignOut = (event: Event) => {
      const detail = (event as CustomEvent<BeforeSignOutDetail>).detail;
      if (detail?.uid !== uid) return;
      detail.waitUntil(flushLocalChanges());
    };

    window.addEventListener('pagehide', preserveBeforeBackgrounding);
    document.addEventListener('visibilitychange', preserveBeforeBackgrounding);
    window.addEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);

    return () => {
      preserveBeforeBackgrounding();
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', preserveBeforeBackgrounding);
      document.removeEventListener('visibilitychange', preserveBeforeBackgrounding);
      window.removeEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);
      unsubscribe();
    };
  }, [sync.user?.uid]);

  return null;
};
