import { useEffect, useRef } from 'react';
import { collection, doc, getDocs, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import {
  IMPORT_HISTORY_CHANGED_EVENT,
  readImportHistory,
  writeImportHistory,
  type ImportHistoryEntry,
} from './importHistory';
import { INKBOUND_BEFORE_SIGN_OUT_EVENT, type BeforeSignOutDetail } from '../sync/cloudSyncEvents';

const CHUNK_CHARACTERS = 100_000;
const RETRY_MS = 30_000;
interface EventManifest { parts?: number }
interface EventPart { index?: number; text?: string }

function validEntry(value: unknown): value is ImportHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ImportHistoryEntry>;
  return typeof entry.id === 'string' && typeof entry.createdAt === 'string'
    && typeof entry.sourceName === 'string' && Array.isArray(entry.items)
    && typeof entry.importedCount === 'number' && typeof entry.duplicateCount === 'number';
}

function unionEntries(local: ImportHistoryEntry[], remote: ImportHistoryEntry[]): ImportHistoryEntry[] {
  // Remote absence is NEVER deletion. Existing local edits (such as metadata
  // verification progress) retain their own values; events not on this device
  // are restored by ID without collapsing independent import sessions.
  const merged = new Map(remote.map((entry) => [entry.id, entry]));
  local.forEach((entry) => merged.set(entry.id, entry));
  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const ImportHistoryCloudSyncBridge = () => {
  const { user } = useAccountSync();
  const ready = useRef(false);
  const uploaded = useRef<Record<string, string>>({});
  const running = useRef(false);

  useEffect(() => {
    ready.current = false;
    uploaded.current = {};
    running.current = false;
    if (!user || !db) return undefined;

    const uid = user.uid;
    let disposed = false;
    const events = collection(db, 'users', uid, 'importHistoryEvents');
    // This per-UID queue is intentionally outside signed-out account keys.
    // It holds only not-yet-uploaded events, not a second active history store.
    // Offline sign-out must not destroy unsent audit events.
    const pendingKey = `inkbound_import_history_pending_${uid}_v1`;
    const readPending = (): ImportHistoryEntry[] => {
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(pendingKey) || '[]');
        return Array.isArray(parsed) ? parsed.filter(validEntry) : [];
      } catch { return []; }
    };
    const savePending = (entries: ImportHistoryEntry[]) => {
      try {
        if (entries.length) localStorage.setItem(pendingKey, JSON.stringify(entries));
        else localStorage.removeItem(pendingKey);
      } catch (error) {
        console.error('Inkbound could not preserve unsynced import history locally.', error);
      }
    };
    const queuePending = () => {
      const pending = new Map(readPending().map((entry) => [entry.id, entry]));
      readImportHistory().forEach((entry) => {
        if (uploaded.current[entry.id] !== JSON.stringify(entry)) pending.set(entry.id, entry);
      });
      savePending([...pending.values()]);
    };
    const restorePending = () => {
      const pending = readPending();
      if (!pending.length) return;
      const local = readImportHistory();
      const merged = unionEntries(local, pending);
      if (JSON.stringify(local) !== JSON.stringify(merged)) writeImportHistory(merged);
    };


    const downloadEvent = async (eventId: string, manifest: EventManifest): Promise<ImportHistoryEntry | null> => {
      const count = manifest.parts;
      if (!Number.isInteger(count) || !count || count < 1 || count > 5000) return null;
      const snapshot = await getDocs(collection(db!, 'users', uid, 'importHistoryEvents', eventId, 'parts'));
      const parts = snapshot.docs.map((part) => part.data() as EventPart)
        .filter((part): part is { index: number; text: string } =>
          Number.isInteger(part.index) && typeof part.text === 'string')
        .sort((a, b) => a.index - b.index);
      if (parts.length !== count || parts.some((part, index) => part.index !== index)) return null;
      try {
        const entry: unknown = JSON.parse(parts.map((part) => part.text).join(''));
        return validEntry(entry) && entry.id === eventId ? entry : null;
      } catch { return null; }
    };

    const writeEvent = async (entry: ImportHistoryEntry) => {
      const serialized = JSON.stringify(entry);
      const parts: string[] = [];
      for (let i = 0; i < serialized.length; i += CHUNK_CHARACTERS) {
        parts.push(serialized.slice(i, i + CHUNK_CHARACTERS));
      }
      // Write payload parts first, manifest last. Readers ignore incomplete
      // manifests; a partial upload never becomes a complete audit event.
      await Promise.all(parts.map((text, index) => setDoc(
        doc(db!, 'users', uid, 'importHistoryEvents', entry.id, 'parts', String(index)),
        { index, text },
      )));
      await setDoc(doc(db!, 'users', uid, 'importHistoryEvents', entry.id),
        { parts: parts.length, createdAt: entry.createdAt, updatedAt: serverTimestamp() },
        { merge: true });
      uploaded.current[entry.id] = serialized;
      savePending(readPending().filter((candidate) =>
        candidate.id !== entry.id || JSON.stringify(candidate) !== serialized));
    };

    const flush = async () => {
      if (!ready.current || disposed || running.current || !navigator.onLine) return;
      running.current = true;
      try {
        // Never replace an account-wide history document. Each session is its
        // own Firestore record; concurrent imports from different devices union.
        for (const entry of readImportHistory()) {
          const serialized = JSON.stringify(entry);
          if (uploaded.current[entry.id] === serialized) continue;
          await writeEvent(entry);
        }
      } finally { running.current = false; }
    };

    const incorporate = (incoming: ImportHistoryEntry[]) => {
      if (disposed || incoming.length === 0) return;
      const before = readImportHistory();
      const merged = unionEntries(before, incoming);
      incoming.forEach((entry) => { uploaded.current[entry.id] = JSON.stringify(entry); });
      if (JSON.stringify(before) !== JSON.stringify(merged)) writeImportHistory(merged);
    };

    const initialize = async () => {
      restorePending();
      queuePending();
      try {
        const snapshot = await getDocs(events);
        const remote = (await Promise.all(snapshot.docs.map(async (item) =>
          downloadEvent(item.id, item.data() as EventManifest)))).filter(
          (item): item is ImportHistoryEntry => item !== null);
        incorporate(remote);
      } catch {
        // Offline reads cannot establish absence. Keep all local history.
      }
      if (disposed) return;
      ready.current = true;
      void flush().catch(() => undefined);
    };
    void initialize();

    const unsubscribe = onSnapshot(events, (snapshot) => {
      void (async () => {
        const incoming = await Promise.all(snapshot.docChanges()
          .filter((change) => change.type !== 'removed')
          .map((change) => downloadEvent(change.doc.id, change.doc.data() as EventManifest)));
        incorporate(incoming.filter((entry): entry is ImportHistoryEntry => entry !== null));
        void flush().catch(() => undefined);
      })().catch(() => undefined);
    }, () => undefined);

    const localChange = () => { queuePending(); void flush().catch(() => undefined); };
    const beforeSignOut = (event: Event) => {
      const detail = (event as CustomEvent<BeforeSignOutDetail>).detail;
      if (detail?.uid === uid) { queuePending(); detail.waitUntil(flush()); }
    };
    window.addEventListener(IMPORT_HISTORY_CHANGED_EVENT, localChange);
    window.addEventListener('online', localChange);
    window.addEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, beforeSignOut);
    const interval = window.setInterval(localChange, RETRY_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener(IMPORT_HISTORY_CHANGED_EVENT, localChange);
      window.removeEventListener('online', localChange);
      window.removeEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, beforeSignOut);
      unsubscribe();
    };
  }, [user?.uid]);

  return null;
};
