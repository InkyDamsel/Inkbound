import React, { useMemo, useState } from 'react';
import { DatabaseBackup, RefreshCw, RotateCcw } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { AdminFirestoreInspector } from './AdminFirestoreInspector';

type RecoveryScope = 'collection' | 'book' | 'session' | 'auxiliary' | 'profile';

interface RecoveryPointSummary {
  id: string;
  createdAtClient: string;
  createdAt: string | null;
  reason: string;
  bookCount: number;
  sessionCount: number;
  auxiliaryCount: number;
  photoMemoryCount: number;
  runtimeStateCount: number;
}

interface RecoveryPreview {
  snapshot: { id: string; createdAtClient: string; createdAt: string | null; reason: string };
  books: Array<{
    id: string;
    title: string;
    author: string;
    status: string;
    dateStarted: string;
    dateFinished: string;
    rating: number | null;
    seriesName: string;
    seriesPosition: string;
  }>;
  sessions: Array<{ id: string; bookId: string; label: string }>;
  collections: Array<{ id: string; name: string; bookCount: number }>;
  auxiliary: Array<{ id: string; label: string }>;
  profilePresent: boolean;
}

interface AdminSelectiveRecoveryPanelProps {
  targetUserId: string | null;
  targetLabel: string;
}

const formatDateTime = (value: string | null) => {
  if (!value) return 'Unknown date';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
};

const readableRecoveryError = (error: unknown, fallback: string) => {
  if (!error || typeof error !== 'object' || !('message' in error)) return fallback;
  const message = String((error as { message?: unknown }).message ?? '').trim();
  if (!message || message === 'internal' || message === 'FirebaseError: internal' || message.includes('functions/internal')) {
    return `${fallback} The recovery service returned an internal error. Refresh the admin page and try loading this recovery point again.`;
  }
  return message;
};

export const AdminSelectiveRecoveryPanel: React.FC<AdminSelectiveRecoveryPanelProps> = ({ targetUserId, targetLabel }) => {
  const [points, setPoints] = useState<RecoveryPointSummary[]>([]);
  const [snapshotId, setSnapshotId] = useState('');
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [scope, setScope] = useState<RecoveryScope>('collection');
  const [itemId, setItemId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [status, setStatus] = useState('');
  const [bookSearch, setBookSearch] = useState('');

  const choices = useMemo(() => {
    if (!preview) return [] as Array<{ id: string; label: string }>;
    if (scope === 'collection') return preview.collections.map((item) => ({ id: item.id, label: `${item.name} · ${item.bookCount} books` }));
    if (scope === 'book') {
      const query = bookSearch.trim().toLowerCase();
      return preview.books
        .filter((item) => !query
          || item.title.toLowerCase().includes(query)
          || item.author.toLowerCase().includes(query)
          || item.seriesName.toLowerCase().includes(query))
        .map((item) => ({ id: item.id, label: `${item.title} — ${item.author}` }));
    }
    if (scope === 'session') return preview.sessions.map((item) => ({ id: item.id, label: item.label }));
    if (scope === 'auxiliary') return preview.auxiliary.map((item) => ({ id: item.id, label: item.label }));
    return preview.profilePresent ? [{ id: 'current', label: 'Reader profile' }] : [];
  }, [preview, scope, bookSearch]);

  const loadRecoveryPoints = async () => {
    if (!functions || !targetUserId || loading) return;
    setLoading(true);
    setStatus('Loading saved recovery points…');
    setPreview(null);
    setSnapshotId('');
    setItemId('');
    try {
      const list = httpsCallable<{ targetUserId: string }, { points: RecoveryPointSummary[] }>(functions, 'listAdminRecoveryPoints');
      const response = await list({ targetUserId });
      setPoints(response.data.points ?? []);
      setStatus(response.data.points?.length ? 'Choose a recovery point to inspect.' : 'No recovery points exist for this reader yet.');
    } catch (error) {
      setStatus(readableRecoveryError(error, 'Could not load recovery history.'));
    } finally {
      setLoading(false);
    }
  };

  const inspectSnapshot = async (nextSnapshotId: string) => {
    setSnapshotId(nextSnapshotId);
    setPreview(null);
    setItemId('');
    setBookSearch('');
    setReason('');
    setConfirmation('');
    if (!functions || !targetUserId || !nextSnapshotId) return;
    setLoading(true);
    setStatus('Inspecting the selected recovery point…');
    try {
      const inspect = httpsCallable<{ targetUserId: string; snapshotId: string }, RecoveryPreview>(functions, 'previewAdminRecoveryPoint');
      const response = await inspect({ targetUserId, snapshotId: nextSnapshotId });
      const nextPreview = response.data;
      setPreview(nextPreview);
      setStatus(nextPreview.collections.length > 0
        ? `Recovery point loaded. ${nextPreview.collections.length} saved collection${nextPreview.collections.length === 1 ? '' : 's'} available to inspect.`
        : 'Recovery point loaded, but it does not contain any saved collection definitions. Try an earlier recovery point.');
    } catch (error) {
      setStatus(readableRecoveryError(error, 'Could not inspect that recovery point.'));
    } finally {
      setLoading(false);
    }
  };

  const changeScope = (nextScope: RecoveryScope) => {
    setScope(nextScope);
    setItemId('');
    setReason('');
    setConfirmation('');
    if (preview) setStatus('Recovery point loaded. Choose only the data you need to recover.');
  };

  const restoreSelection = async () => {
    if (!functions || !targetUserId || !snapshotId || !itemId || restoring) return;
    if (!reason.trim() || confirmation.trim().toUpperCase() !== 'RESTORE') return;
    setRestoring(true);
    setStatus('Creating a safety copy of the reader’s current account before selective recovery…');
    try {
      const restore = httpsCallable<{
        targetUserId: string;
        targetEmail: string;
        snapshotId: string;
        scope: RecoveryScope;
        itemId: string;
        reason: string;
        confirmation: string;
      }, { success: boolean; safetySnapshotId: string; restoredCount: number; description: string }>(functions, 'restoreAdminRecoverySelection');
      const response = await restore({
        targetUserId,
        targetEmail: targetLabel,
        snapshotId,
        scope,
        itemId,
        reason: reason.trim(),
        confirmation: 'RESTORE',
      });
      setStatus(`Recovered ${response.data.description}. ${response.data.restoredCount} saved record${response.data.restoredCount === 1 ? '' : 's'} updated. A pre-recovery safety copy was preserved (${response.data.safetySnapshotId}).`);
      setItemId('');
      setReason('');
      setConfirmation('');
    } catch (error) {
      setStatus(readableRecoveryError(error, 'Selective recovery could not be completed.'));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <section className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><DatabaseBackup className="h-5 w-5 text-[var(--ink-mauve)]" /><h4 className="font-serif text-xl text-[var(--ink-ivory)]">Selective recovery</h4></div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--ink-muted)]">Recover one missing collection, book, reading session, profile, or account record without rolling the reader’s whole account back. Every recovery creates a fresh safety snapshot first.</p>
          </div>
          <button type="button" onClick={() => void loadRecoveryPoints()} disabled={!targetUserId || loading || restoring} className="quiet-shelf-secondary-action w-full justify-center disabled:opacity-45 sm:w-auto"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Load recovery tools</button>
        </div>

        {points.length > 0 && <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Recovery point
            <select value={snapshotId} onChange={(event) => void inspectSnapshot(event.target.value)} disabled={loading || restoring} className="inkbound-select mt-2 w-full">
              <option value="">Choose a saved point</option>
              {points.map((point) => <option key={point.id} value={point.id}>{formatDateTime(point.createdAtClient || point.createdAt)} · {point.bookCount} books · {point.reason}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Recover
            <select value={scope} onChange={(event) => changeScope(event.target.value as RecoveryScope)} disabled={!preview || loading || restoring} className="inkbound-select mt-2 w-full">
              <option value="collection">One collection + missing memberships</option>
              <option value="book">One book</option>
              <option value="session">One reading session</option>
              <option value="auxiliary">One account record</option>
              <option value="profile">Reader profile</option>
            </select>
          </label>
        </div>}

        {preview && <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-xs text-[var(--ink-muted)]">Snapshot: <strong className="text-[var(--ink-ivory)]">{formatDateTime(preview.snapshot.createdAtClient || preview.snapshot.createdAt)}</strong> · {preview.books.length} books · {preview.sessions.length} sessions · {preview.collections.length} collections · {preview.auxiliary.length} account records</div>
          {scope === 'book' && (
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Find book in this snapshot
              <input
                type="search"
                value={bookSearch}
                onChange={(event) => { setBookSearch(event.target.value); setItemId(''); }}
                placeholder="Search title, author, or series"
                className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)] outline-none"
              />
            </label>
          )}
          {choices.length > 0 ? <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Item to recover
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} disabled={loading || restoring} className="inkbound-select mt-2 w-full">
              <option value="">Choose an item</option>
              {choices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label> : <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-[var(--ink-muted)]">No recoverable items were found for this recovery type in the selected snapshot.</div>}
          {scope === 'book' && itemId && (() => {
            const selectedBook = preview.books.find((book) => book.id === itemId);
            if (!selectedBook) return null;
            return (
              <div className="rounded-xl border border-[var(--ink-gold)]/25 bg-[var(--ink-gold)]/5 p-4 text-sm">
                <div className="font-semibold text-[var(--ink-ivory)]">{selectedBook.title}</div>
                <div className="mt-1 text-xs text-[var(--ink-muted)]">{selectedBook.author}</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div><span className="text-[var(--ink-faint)]">Status:</span> <span className="text-[var(--ink-ivory)]">{selectedBook.status || '—'}</span></div>
                  <div><span className="text-[var(--ink-faint)]">Started:</span> <span className="text-[var(--ink-ivory)]">{selectedBook.dateStarted || '—'}</span></div>
                  <div><span className="text-[var(--ink-faint)]">Finished:</span> <span className="text-[var(--ink-ivory)]">{selectedBook.dateFinished || '—'}</span></div>
                  <div><span className="text-[var(--ink-faint)]">Rating:</span> <span className="text-[var(--ink-ivory)]">{selectedBook.rating ?? '—'}</span></div>
                  <div className="sm:col-span-2"><span className="text-[var(--ink-faint)]">Series:</span> <span className="text-[var(--ink-ivory)]">{selectedBook.seriesName || '—'}{selectedBook.seriesPosition ? ` · #${selectedBook.seriesPosition}` : ''}</span></div>
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--ink-muted)]">These are the values saved in this recovery point. Nothing has been restored yet.</p>
              </div>
            );
          })()}
          {scope === 'collection' && choices.length > 0 && <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs leading-5 text-[var(--ink-muted)]">Collection recovery is intentionally non-destructive: it restores the saved collection definition and adds any memberships that are missing now. It does not remove books added to that collection after the snapshot.</p>}
          {choices.length > 0 && <>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Support reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} disabled={restoring} placeholder="Required for the admin audit log" className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-ivory)] outline-none" /></label>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Type RESTORE<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={restoring} placeholder="RESTORE" className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)] outline-none" /></label>
            <button type="button" onClick={() => void restoreSelection()} disabled={!itemId || !reason.trim() || confirmation.trim().toUpperCase() !== 'RESTORE' || restoring} className="quiet-shelf-primary-action w-full justify-center disabled:opacity-45 sm:w-auto"><RotateCcw className={restoring ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {restoring ? 'Recovering…' : 'Recover selected data'}</button>
          </>}
        </div>}

        {status && <p className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-muted)]" role="status">{status}</p>}
      </section>
      {targetUserId && <AdminFirestoreInspector targetUserId={targetUserId} />}
    </>
  );
};
