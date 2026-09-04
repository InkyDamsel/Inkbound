import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Download, FileClock, Loader2, Play, RefreshCw, Search } from 'lucide-react';
import type { UserBookRecord } from '../types';
import { exportRuntimeTextFile } from '../platform/runtimeExport';
import { readImportEnrichmentQueue } from '../features/import/libraryEnrichment';
import { ManualCoverRecoveryPanel } from './ManualCoverRecoveryPanel';
import {
  ensureImportHistoryForExistingLibrary,
  getImportHistoryProgress,
  isImportEnrichmentPaused,
  isImportHistoryItemMatched,
  readImportEnrichmentActiveRetry,
  readImportEnrichmentRetryProgress,
  retryImportHistoryItems,
  setImportEnrichmentPaused,
  type ImportEnrichmentRetryProgress,
  type ImportHistoryEntry,
} from '../features/import/importHistory';

interface ImportHistoryScreenProps {
  books: UserBookRecord[];
  onResumeEnrichment: () => void;
  onRetryEnrichment: (targetBookIds: string[]) => Promise<void>;
}

type RetryRuntimeWindow = Window & { __inkboundImportRetryRunning?: boolean };
interface PendingRetry { entry: ImportHistoryEntry; targetBookIds: string[]; }

const IMPORTED_LIBRARY_COLLAPSED_KEY = 'inkbound_import_history_library_collapsed_v1';
const MANUAL_COVERS_COLLAPSED_KEY = 'inkbound_import_history_manual_covers_collapsed_v1';
const DETAIL_PASS_LIMIT = 100;

function readCollapsedPreference(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function persistCollapsedPreference(key: string, collapsed: boolean) {
  try { localStorage.setItem(key, collapsed ? '1' : '0'); } catch { /* device-only preference */ }
}

async function exportUnresolved(entry: ImportHistoryEntry, books: UserBookRecord[]) {
  const byId = new Map(books.map((book) => [book.id, book]));
  const rows = entry.items.filter((item) => !isImportHistoryItemMatched(item, byId.get(item.targetBookId)));
  if (!rows.length) return;
  const escapeCsv = (value?: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csvRows = [['Title', 'Author', 'ISBN', 'Status', 'Format'], ...rows.map((item) => [item.title, item.author, item.isbn ?? '', item.status, item.format])];
  await exportRuntimeTextFile({
    filename: `inkbound-unresolved-${entry.createdAt.slice(0, 10)}.csv`,
    mimeType: 'text/csv;charset=utf-8',
    contents: csvRows.map((row) => row.map(escapeCsv).join(',')).join('\n'),
  });
}

export const ImportHistoryScreen: React.FC<ImportHistoryScreenProps> = ({ books, onResumeEnrichment, onRetryEnrichment }) => {
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showOnlyUnresolved, setShowOnlyUnresolved] = useState(false);
  const [paused, setPaused] = useState(() => isImportEnrichmentPaused());
  const [retryProgress, setRetryProgress] = useState<ImportEnrichmentRetryProgress | null>(() => readImportEnrichmentRetryProgress());
  const [pendingRetry, setPendingRetry] = useState<PendingRetry | null>(null);
  const [importedLibraryCollapsed, setImportedLibraryCollapsed] = useState(() => readCollapsedPreference(IMPORTED_LIBRARY_COLLAPSED_KEY));
  const [manualCoversCollapsed, setManualCoversCollapsed] = useState(() => readCollapsedPreference(MANUAL_COVERS_COLLAPSED_KEY));
  const retryEnrichmentRef = useRef(onRetryEnrichment);

  const history = useMemo(() => ensureImportHistoryForExistingLibrary(books), [books, historyVersion]);
  const selectedEntry = history.find((entry) => entry.id === selectedEntryId) ?? history[0] ?? null;
  const selectedProgress = selectedEntry ? getImportHistoryProgress(selectedEntry, books) : null;
  const queuedBookIds = useMemo(() => new Set(readImportEnrichmentQueue().map((item) => item.targetBookId)), [books, historyVersion, retryProgress?.completed]);
  const retryRunning = retryProgress?.status === 'queued' || retryProgress?.status === 'running';
  const retryPercent = retryProgress?.total ? Math.min(100, Math.round((retryProgress.completed / retryProgress.total) * 100)) : 0;

  useEffect(() => { retryEnrichmentRef.current = onRetryEnrichment; }, [onRetryEnrichment]);

  useEffect(() => {
    const progress = readImportEnrichmentRetryProgress();
    const activeRetry = readImportEnrichmentActiveRetry();
    if (!progress || !activeRetry || (progress.status !== 'queued' && progress.status !== 'running')) return;
    setRetryProgress(progress);
    setImportEnrichmentPaused(false);
    setPaused(false);
    const runtimeWindow = window as RetryRuntimeWindow;
    if (runtimeWindow.__inkboundImportRetryRunning) return;
    runtimeWindow.__inkboundImportRetryRunning = true;
    void retryEnrichmentRef.current(activeRetry.targetBookIds.slice(0, DETAIL_PASS_LIMIT)).finally(() => {
      runtimeWindow.__inkboundImportRetryRunning = false;
      setRetryProgress(readImportEnrichmentRetryProgress());
      setHistoryVersion((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (!retryRunning) return;
    const timer = window.setInterval(() => {
      const next = readImportEnrichmentRetryProgress();
      if (next) setRetryProgress(next);
      setHistoryVersion((value) => value + 1);
    }, 500);
    return () => window.clearInterval(timer);
  }, [retryRunning]);

  const selectedItems = useMemo(() => {
    if (!selectedEntry) return [];
    const normalized = query.trim().toLowerCase();
    const byId = new Map(books.map((book) => [book.id, book]));
    return selectedEntry.items.filter((item) => {
      const unresolved = !isImportHistoryItemMatched(item, byId.get(item.targetBookId));
      if (showOnlyUnresolved && !unresolved) return false;
      return !normalized || item.title.toLowerCase().includes(normalized) || item.author.toLowerCase().includes(normalized) || item.isbn?.toLowerCase().includes(normalized);
    });
  }, [books, query, selectedEntry, showOnlyUnresolved]);

  const requestDetailUpdate = (entry: ImportHistoryEntry, ids?: string[]) => {
    const allowed = ids ? new Set(ids) : null;
    const targetBookIds = entry.items
      .filter((item) => !allowed || allowed.has(item.targetBookId))
      .sort((a, b) => Number(Boolean(b.isbn?.trim())) - Number(Boolean(a.isbn?.trim())))
      .slice(0, DETAIL_PASS_LIMIT)
      .map((item) => item.targetBookId);
    if (targetBookIds.length) setPendingRetry({ entry, targetBookIds });
  };

  const startPendingRetry = () => {
    if (!pendingRetry) return;
    const requestedIds = retryImportHistoryItems(pendingRetry.entry, pendingRetry.targetBookIds).slice(0, DETAIL_PASS_LIMIT);
    setPendingRetry(null);
    if (!requestedIds.length) return;
    setImportEnrichmentPaused(false);
    setPaused(false);
    setRetryProgress({ status: 'queued', completed: 0, total: requestedIds.length, matched: 0, covers: 0, summaries: 0, updatedAt: new Date().toISOString() });
    const runtimeWindow = window as RetryRuntimeWindow;
    runtimeWindow.__inkboundImportRetryRunning = true;
    void onRetryEnrichment(requestedIds).finally(() => {
      runtimeWindow.__inkboundImportRetryRunning = false;
      setRetryProgress(readImportEnrichmentRetryProgress());
      setHistoryVersion((value) => value + 1);
    });
  };

  const continueQueuedDetails = () => {
    setImportEnrichmentPaused(false);
    setPaused(false);
    onResumeEnrichment();
  };

  return (
    <div className="space-y-7 pb-24">
      {pendingRetry && (
        <div className="fixed inset-0 z-[220] grid place-items-center bg-black/65 p-4" role="dialog" aria-modal="true">
          <section className="w-full max-w-lg rounded-3xl border border-[var(--ink-gold)]/40 bg-[var(--ink-surface-raised)] p-6 shadow-2xl sm:p-7">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-1 h-6 w-6 shrink-0 text-[var(--ink-gold)]" />
              <div>
                <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Continue adding book details?</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">Inkbound will check these books for optional covers, summaries, and edition details. Your books are already safely imported and usable.</p>
                <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">To protect very large libraries from runaway provider and Firebase usage, each manual detail pass checks at most {DETAIL_PASS_LIMIT} books. Books with ISBNs are checked first, and anything left stays safely queued for a later pass.</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setPendingRetry(null)} className="quiet-shelf-secondary-action min-h-11 justify-center">Cancel</button>
                  <button type="button" onClick={startPendingRetry} className="quiet-shelf-primary-action min-h-11 justify-center">Check Next {pendingRetry.targetBookIds.length}</button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      <header>
        <p className="inkbound-kicker">Import Center</p>
        <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Import History & Book Details</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">Your imported books are ready immediately. Covers, summaries, and other optional details can be filled in separately without blocking your library.</p>
      </header>

      {selectedProgress && selectedProgress.unresolved > 0 && !retryRunning && (
        <section className="flex flex-col gap-4 rounded-2xl border border-[var(--ink-gold)]/30 bg-[var(--ink-gold)]/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold text-[var(--ink-ivory)]">Inkbound is still finishing optional book details</p>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{selectedProgress.unresolved.toLocaleString()} books are waiting for covers, summaries, or edition details. Large libraries can take a while; your imported books are already safe and ready to use.</p>
          </div>
          <button type="button" onClick={paused ? continueQueuedDetails : () => selectedEntry && requestDetailUpdate(selectedEntry)} className="quiet-shelf-primary-action shrink-0 justify-center">
            <Play className="h-4 w-4" /> {paused ? 'Continue Adding Details' : selectedProgress.unresolved > DETAIL_PASS_LIMIT ? `Check Next ${DETAIL_PASS_LIMIT}` : 'Check Missing Details'}
          </button>
        </section>
      )}

      {retryProgress && (
        <section className={`rounded-2xl border p-4 ${retryProgress.status === 'error' ? 'border-rose-500/35 bg-rose-950/20' : retryProgress.status === 'complete' ? 'border-emerald-500/30 bg-emerald-950/15' : 'border-[var(--ink-gold)]/35 bg-[var(--ink-gold)]/10'}`} role="status">
          <div className="flex items-center gap-3">
            {retryRunning ? <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-gold)]" /> : <CheckCircle2 className="h-5 w-5 text-emerald-300" />}
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[var(--ink-ivory)]">{retryRunning ? 'Adding optional book details…' : retryProgress.status === 'complete' ? 'Detail pass finished' : 'Detail pass stopped'}</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">{retryProgress.message ?? `${retryProgress.completed.toLocaleString()} of ${retryProgress.total.toLocaleString()} books checked.`}</p>
            </div>
            <span className="text-xs font-bold text-[var(--ink-gold)]">{retryProgress.completed.toLocaleString()} / {retryProgress.total.toLocaleString()}</span>
          </div>
          {retryRunning && retryProgress.total > 0 && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/25"><div className="h-full rounded-full bg-[var(--ink-gold)]" style={{ width: `${retryPercent}%` }} /></div>}
        </section>
      )}

      <section className="overflow-hidden rounded-3xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)]">
        <button type="button" onClick={() => { const next = !importedLibraryCollapsed; setImportedLibraryCollapsed(next); persistCollapsedPreference(IMPORTED_LIBRARY_COLLAPSED_KEY, next); }} className="flex w-full items-center justify-between gap-4 p-5 text-left sm:px-7">
          <div><p className="inkbound-kicker">Imported Library</p><h2 className="mt-1 font-serif text-xl font-bold text-[var(--ink-ivory)]">Existing Imported Library</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">{selectedEntry && selectedProgress ? `${selectedEntry.importedCount.toLocaleString()} imported · ${selectedProgress.matched.toLocaleString()} matched · ${selectedProgress.unresolved.toLocaleString()} awaiting metadata` : `${books.length.toLocaleString()} books in library`}</p></div>
          <span className="flex items-center gap-2 text-xs font-bold text-[var(--ink-gold)]">{importedLibraryCollapsed ? 'Expand' : 'Minimize'} {importedLibraryCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}</span>
        </button>

        {!importedLibraryCollapsed && <div className="border-t border-[var(--ink-border)] p-5 sm:p-7">
          {!history.length ? <section className="rounded-3xl border border-dashed border-[var(--ink-border)] p-10 text-center"><FileClock className="mx-auto h-10 w-10 text-[var(--ink-gold)]" /><h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">No recorded imports yet</h2></section> : (
            <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
              <aside className="space-y-3">{history.map((entry) => { const progress = getImportHistoryProgress(entry, books); return <button key={entry.id} type="button" onClick={() => setSelectedEntryId(entry.id)} className={`w-full rounded-2xl border p-4 text-left ${selectedEntry?.id === entry.id ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-raised)]' : 'border-[var(--ink-border)]'}`}><div className="flex justify-between gap-2"><div><p className="font-serif text-lg font-bold text-[var(--ink-ivory)]">{entry.sourceName}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{new Date(entry.createdAt).toLocaleString()}</p></div><span className="self-start rounded-full border border-[var(--ink-border)] px-2 py-1 text-[11px] text-[var(--ink-muted)]">{progress.matched}/{entry.importedCount} details matched</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--ink-surface)]"><div className="h-full rounded-full bg-[var(--ink-gold)]" style={{ width: `${entry.importedCount ? Math.round((progress.matched / entry.importedCount) * 100) : 0}%` }} /></div><p className="mt-3 text-xs text-[var(--ink-muted)]">{entry.importedCount.toLocaleString()} imported · {entry.duplicateCount.toLocaleString()} duplicates skipped · {progress.unresolved.toLocaleString()} awaiting metadata</p></button>; })}</aside>

              {selectedEntry && (() => {
                const progress = getImportHistoryProgress(selectedEntry, books);
                const byId = new Map(books.map((book) => [book.id, book]));
                const unresolvedIds = selectedEntry.items.filter((item) => !isImportHistoryItemMatched(item, byId.get(item.targetBookId))).map((item) => item.targetBookId);
                return <section className="inkbound-panel min-w-0 rounded-3xl p-5 sm:p-7">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><p className="inkbound-kicker">Import Details</p><h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">{selectedEntry.sourceName} · {new Date(selectedEntry.createdAt).toLocaleDateString()}</h2><p className="mt-2 text-sm text-[var(--ink-muted)]">{selectedEntry.importedCount.toLocaleString()} books are already in your Inkbound library. Optional details can be added separately and never block access to your books.</p></div><button type="button" onClick={() => void exportUnresolved(selectedEntry, books)} disabled={!unresolvedIds.length} className="quiet-shelf-secondary-action justify-center disabled:opacity-40"><Download className="h-4 w-4" /> Save Missing List</button></div>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[['Imported', selectedEntry.importedCount], ['Duplicates skipped', selectedEntry.duplicateCount], ['Details matched', progress.matched], ['Covers found', progress.covers], ['Awaiting metadata', progress.unresolved]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">{label}</p><p className="mt-2 font-serif text-3xl font-bold text-[var(--ink-ivory)]">{Number(value).toLocaleString()}</p></div>)}</div>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title or author" className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] pl-11 pr-4 text-sm text-[var(--ink-ivory)] outline-none" /></label><button type="button" onClick={() => setShowOnlyUnresolved((current) => !current)} className="quiet-shelf-secondary-action justify-center">{showOnlyUnresolved ? 'Showing Missing Details' : 'Show Missing Details Only'}</button></div>
                  <div className="mt-4 max-h-[min(520px,55dvh)] space-y-2 overflow-y-auto pr-1">{selectedItems.map((item) => { const book = byId.get(item.targetBookId); const edition = book?.editions.find((value) => value.id === book.activeEditionId) ?? book?.editions[0]; const matched = isImportHistoryItemMatched(item, book); const queued = queuedBookIds.has(item.targetBookId); return <article key={item.targetBookId} className="flex flex-col gap-3 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 sm:flex-row sm:items-center sm:justify-between"><div><strong className="block text-sm text-[var(--ink-ivory)]">{item.title}</strong><span className="text-xs text-[var(--ink-muted)]">{item.author}</span></div><div className="flex flex-wrap items-center gap-2 text-[11px]"><span className={`rounded-full px-2.5 py-1 font-bold ${matched ? 'bg-emerald-500/15 text-emerald-300' : queued ? 'bg-amber-500/15 text-amber-300' : 'bg-[var(--ink-surface)] text-[var(--ink-muted)]'}`}>{matched ? 'Details matched' : queued ? 'Detail update queued' : 'Details not matched'}</span><span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1 text-[var(--ink-muted)]">{edition?.coverUrl ? 'Cover ✓' : 'Cover —'}</span><span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1 text-[var(--ink-muted)]">{book?.work?.publisherSummary?.trim() ? 'Summary ✓' : 'Summary —'}</span>{!matched && <button type="button" disabled={retryRunning} onClick={() => requestDetailUpdate(selectedEntry, [item.targetBookId])} className="min-h-11 rounded-full border border-[var(--ink-gold)] px-3 font-bold text-[var(--ink-gold)] disabled:opacity-40">Check Details</button>}</div></article>; })}{!selectedItems.length && <p className="rounded-xl border border-dashed border-[var(--ink-border)] p-8 text-center text-sm text-[var(--ink-muted)]">No books match this filter.</p>}</div>
                </section>;
              })()}
            </div>
          )}
        </div>}
      </section>

      <section className="overflow-hidden rounded-3xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)]">
        <button type="button" onClick={() => { const next = !manualCoversCollapsed; setManualCoversCollapsed(next); persistCollapsedPreference(MANUAL_COVERS_COLLAPSED_KEY, next); }} className="flex w-full items-center justify-between gap-4 p-5 text-left sm:px-7"><div><p className="inkbound-kicker">Cover Recovery</p><h2 className="mt-1 font-serif text-xl font-bold text-[var(--ink-ivory)]">Manual Cover Library</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">Reuse saved covers without uploading them again.</p></div><span className="flex items-center gap-2 text-xs font-bold text-[var(--ink-gold)]">{manualCoversCollapsed ? 'Expand' : 'Minimize'} {manualCoversCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}</span></button>
        {!manualCoversCollapsed && <div className="border-t border-[var(--ink-border)] p-3 sm:p-5"><ManualCoverRecoveryPanel books={books} /></div>}
      </section>
    </div>
  );
};