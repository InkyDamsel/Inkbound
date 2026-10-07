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
  snapshot: {
    id: string;
    createdAtClient: string;
    createdAt: string | null;
    reason: string;
    bookCount: number;
    sessionCount: number;
    auxiliaryCount: number;
  };
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
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [status, setStatus] = useState('');
  const [bookSearch, setBookSearch] = useState('');
  const [bookCandidates, setBookCandidates] = useState<RecoveryPreview['books']>([]);
  const [finishedMonth, setFinishedMonth] = useState('2026-01');
  const [loadingBooks, setLoadingBooks] = useState(false);

  const choices = useMemo(() => {
    if (!preview) return [] as Array<{ id: string; label: string }>;
    if (scope === 'collection') return preview.collections.map((item) => ({ id: item.id, label: item.bookCount >= 0 ? `${item.name} · ${item.bookCount} books` : item.name }));
    if (scope === 'book') {
      const query = bookSearch.trim().toLowerCase();
      return bookCandidates
        .filter((item) => !query
          || item.title.toLowerCase().includes(query)
          || item.author.toLowerCase().includes(query)
          || item.seriesName.toLowerCase().includes(query))
        .map((item) => ({ id: item.id, label: `${item.title} — ${item.author}` }));
    }
    if (scope === 'session') return preview.sessions.map((item) => ({ id: item.id, label: item.label }));
    if (scope === 'auxiliary') return preview.auxiliary.map((item) => ({ id: item.id, label: item.label }));
    return preview.profilePresent ? [{ id: 'current', label: 'Reader profile' }] : [];
  }, [preview, scope, bookSearch, bookCandidates]);

  const loadRecoveryPoints = async () => {
    if (!functions || !targetUserId || loading) return;
    setLoading(true);
    setStatus('Loading saved recovery points…');
    setPreview(null);
    setSnapshotId('');
    setItemId('');
    setSelectedBookIds([]);
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
    setSelectedBookIds([]);
    setBookCandidates([]);
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
      setStatus('Recovery point loaded. Large book/session collections were not scanned. Choose the recovery type you need.');
    } catch (error) {
      setStatus(readableRecoveryError(error, 'Could not inspect that recovery point.'));
    } finally {
      setLoading(false);
    }
  };

  const changeScope = (nextScope: RecoveryScope) => {
    setScope(nextScope);
    setItemId('');
    setSelectedBookIds([]);
    setBookCandidates([]);
    setBookSearch('');
    setReason('');
    setConfirmation('');
    if (preview) setStatus(nextScope === 'book'
      ? 'Recovery point loaded. Choose a finished month to load only the books you need.'
      : 'Recovery point loaded. Choose only the data you need to recover.');
  };

  const loadFinishedBooksForMonth = async () => {
    if (!functions || !targetUserId || !snapshotId || !finishedMonth || loadingBooks) return;
    setLoadingBooks(true);
    setStatus(`Loading books finished in ${finishedMonth} from this recovery point…`);
    try {
      const listBooks = httpsCallable<{
        targetUserId: string;
        snapshotId: string;
        month: string;
      }, { month: string; books: RecoveryPreview['books']; capped: boolean }>(functions, 'listAdminRecoveryBooksForMonth');
      const response = await listBooks({ targetUserId, snapshotId, month: finishedMonth });
      setBookCandidates(response.data.books ?? []);
      setSelectedBookIds([]);
      setBookSearch('');
      setStatus(response.data.books?.length
        ? `${response.data.books.length} book${response.data.books.length === 1 ? '' : 's'} finished in ${finishedMonth} found in this recovery point.${response.data.capped ? ' Results were capped at 500.' : ''}`
        : `No books with a finished date in ${finishedMonth} were found in this recovery point.`);
    } catch (error) {
      setStatus(readableRecoveryError(error, 'Could not load books for that month.'));
    } finally {
      setLoadingBooks(false);
    }
  };

  const restoreSelection = async () => {
    const hasSelection = scope === 'book' ? selectedBookIds.length > 0 : Boolean(itemId);
    if (!functions || !targetUserId || !snapshotId || !hasSelection || restoring) return;
    if (!reason.trim() || confirmation.trim().toUpperCase() !== 'RESTORE') return;
    setRestoring(true);
    setStatus(scope === 'book' && selectedBookIds.length > 1
      ? `Creating one safety copy before recovering ${selectedBookIds.length} books…`
      : 'Creating a safety copy of the reader’s current account before selective recovery…');
    try {
      const restore = httpsCallable<{
        targetUserId: string;
        targetEmail: string;
        snapshotId: string;
        scope: RecoveryScope;
        itemId?: string;
        itemIds?: string[];
        reason: string;
        confirmation: string;
      }, { success: boolean; safetySnapshotId: string; restoredCount: number; description: string }>(functions, 'restoreAdminRecoverySelection');
      const response = await restore({
        targetUserId,
        targetEmail: targetLabel,
        snapshotId,
        scope,
        ...(scope === 'book' ? { itemIds: selectedBookIds } : { itemId }),
        reason: reason.trim(),
        confirmation: 'RESTORE',
      });
      setStatus(`Recovered ${response.data.description}. ${response.data.restoredCount} saved record${response.data.restoredCount === 1 ? '' : 's'} updated. Only one pre-recovery safety copy was created for this recovery batch (${response.data.safetySnapshotId}).`);
      setItemId('');
      setSelectedBookIds([]);
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
            <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--ink-muted)]">Recover one missing collection, one or more books, a reading session, profile, or account record without rolling the reader’s whole account back. A book batch creates one fresh safety snapshot before the batch is restored.</p>
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
              <option value="book">One or more books</option>
              <option value="session">One reading session</option>
              <option value="auxiliary">One account record</option>
              <option value="profile">Reader profile</option>
            </select>
          </label>
        </div>}

        {preview && <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-xs text-[var(--ink-muted)]">Snapshot: <strong className="text-[var(--ink-ivory)]">{formatDateTime(preview.snapshot.createdAtClient || preview.snapshot.createdAt)}</strong> · {preview.snapshot.bookCount} books · {preview.snapshot.sessionCount} sessions · {preview.collections.length} collections · {preview.snapshot.auxiliaryCount} account records</div>
          {scope === 'book' ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,14rem)_auto] md:items-end">
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Finished month
                  <input
                    type="month"
                    value={finishedMonth}
                    onChange={(event) => { setFinishedMonth(event.target.value); setBookCandidates([]); setSelectedBookIds([]); setBookSearch(''); }}
                    className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)] outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void loadFinishedBooksForMonth()}
                  disabled={!finishedMonth || loadingBooks || restoring}
                  className="quiet-shelf-secondary-action w-full justify-center disabled:opacity-45 md:w-auto"
                >
                  <RefreshCw className={loadingBooks ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                  {loadingBooks ? 'Loading books…' : 'Load finished books'}
                </button>
              </div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Filter loaded books
                <input
                  type="search"
                  value={bookSearch}
                  onChange={(event) => setBookSearch(event.target.value)}
                  disabled={bookCandidates.length === 0}
                  placeholder="Search title, author, or series"
                  className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)] outline-none disabled:opacity-45"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
                <span><strong className="text-[var(--ink-ivory)]">{selectedBookIds.length}</strong> book{selectedBookIds.length === 1 ? '' : 's'} selected</span>
                {selectedBookIds.length > 0 && <button type="button" onClick={() => setSelectedBookIds([])} className="text-[var(--ink-mauve)] hover:text-[var(--ink-ivory)]">Clear selection</button>}
              </div>
              {bookCandidates.length > 0 ? (
                choices.length > 0 ? (
                  <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-2">
                    {choices.map((choice) => {
                      const book = bookCandidates.find((item) => item.id === choice.id);
                      const checked = selectedBookIds.includes(choice.id);
                      return (
                        <label key={choice.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${checked ? 'border-[var(--ink-gold)]/45 bg-[var(--ink-gold)]/8' : 'border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)]'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setSelectedBookIds((current) => checked ? current.filter((id) => id !== choice.id) : [...current, choice.id])}
                            disabled={restoring}
                            className="mt-1"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-[var(--ink-ivory)]">{choice.label}</div>
                            {book && <div className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                              {book.status || 'No status'} · Started {book.dateStarted || '—'} · Finished {book.dateFinished || '—'} · Rating {book.rating ?? '—'}
                              {book.seriesName ? ` · ${book.seriesName}${book.seriesPosition ? ` #${book.seriesPosition}` : ''}` : ''}
                            </div>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-[var(--ink-muted)]">No books match that search in this recovery point.</div>
              ) : <div className="rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-xs text-[var(--ink-muted)]">Choose a finished month and load only that bounded slice of the recovery snapshot. Inkbound no longer scans the reader’s entire library just to open recovery tools.</div>}
              {selectedBookIds.length > 0 && (
                <div className="rounded-xl border border-[var(--ink-gold)]/25 bg-[var(--ink-gold)]/5 p-4 text-xs leading-5 text-[var(--ink-muted)]">
                  The selected books will be restored together from this snapshot. Inkbound will create <strong className="text-[var(--ink-ivory)]">one</strong> pre-recovery safety snapshot for the entire batch, not one per book.
                </div>
              )}
            </div>
          ) : choices.length > 0 ? <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Item to recover
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} disabled={loading || restoring} className="inkbound-select mt-2 w-full">
              <option value="">Choose an item</option>
              {choices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label> : <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-[var(--ink-muted)]">No recoverable items were found for this recovery type in the selected snapshot.</div>}
          {scope === 'collection' && choices.length > 0 && <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs leading-5 text-[var(--ink-muted)]">Collection recovery is intentionally non-destructive: it restores the saved collection definition and adds any memberships that are missing now. It does not remove books added to that collection after the snapshot.</p>}
          {(scope === 'book' ? selectedBookIds.length > 0 : choices.length > 0) && <>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Support reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} disabled={restoring} placeholder="Required for the admin audit log" className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-ivory)] outline-none" /></label>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Type RESTORE<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={restoring} placeholder="RESTORE" className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)] outline-none" /></label>
            <button type="button" onClick={() => void restoreSelection()} disabled={(scope === 'book' ? selectedBookIds.length === 0 : !itemId) || !reason.trim() || confirmation.trim().toUpperCase() !== 'RESTORE' || restoring} className="quiet-shelf-primary-action w-full justify-center disabled:opacity-45 sm:w-auto"><RotateCcw className={restoring ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {restoring ? 'Recovering…' : scope === 'book' && selectedBookIds.length > 1 ? `Recover ${selectedBookIds.length} books` : 'Recover selected data'}</button>
          </>}
        </div>}

        {status && <p className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-muted)]" role="status">{status}</p>}
      </section>
      {targetUserId && <AdminFirestoreInspector targetUserId={targetUserId} />}
    </>
  );
};
