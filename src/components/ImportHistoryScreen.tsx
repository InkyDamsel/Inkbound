import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, FileClock, Loader2, Pause, Play, RefreshCw, Search } from 'lucide-react';
import type { UserBookRecord } from '../types';
import { readImportEnrichmentQueue } from '../features/import/libraryEnrichment';
import {
  ensureImportHistoryForExistingLibrary,
  getImportHistoryProgress,
  isImportEnrichmentPaused,
  isImportHistoryItemMatched,
  readImportEnrichmentRetryProgress,
  retryImportHistoryItems,
  setImportEnrichmentPaused,
  type ImportEnrichmentRetryProgress,
  type ImportHistoryEntry,
} from '../features/import/importHistory';

interface ImportHistoryScreenProps {
  books: UserBookRecord[];
  onResumeEnrichment: () => void;
}

function downloadUnresolved(entry: ImportHistoryEntry, books: UserBookRecord[]) {
  const byId = new Map(books.map((book) => [book.id, book]));
  const rows = entry.items.filter((item) => !isImportHistoryItemMatched(item, byId.get(item.targetBookId)));
  if (rows.length === 0) return;
  const escapeCsv = (value?: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csvRows = [
    ['Title', 'Author', 'ISBN', 'Status', 'Format'],
    ...rows.map((item) => [item.title, item.author, item.isbn ?? '', item.status, item.format]),
  ];
  const blob = new Blob([csvRows.map((row) => row.map(escapeCsv).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `inkbound-unresolved-${entry.createdAt.slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const ImportHistoryScreen: React.FC<ImportHistoryScreenProps> = ({ books, onResumeEnrichment }) => {
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showOnlyUnresolved, setShowOnlyUnresolved] = useState(false);
  const [paused, setPaused] = useState(() => isImportEnrichmentPaused());
  const [retryProgress, setRetryProgress] = useState<ImportEnrichmentRetryProgress | null>(null);
  const history = useMemo(() => ensureImportHistoryForExistingLibrary(books), [books, historyVersion]);
  const selectedEntry = history.find((entry) => entry.id === selectedEntryId) ?? history[0] ?? null;
  const queuedBookIds = useMemo(
    () => new Set(readImportEnrichmentQueue().map((item) => item.targetBookId)),
    [books, historyVersion, retryProgress?.completed],
  );

  useEffect(() => {
    if (!retryProgress || (retryProgress.status !== 'queued' && retryProgress.status !== 'running')) return;
    const refresh = () => {
      const next = readImportEnrichmentRetryProgress();
      if (!next) return;
      setRetryProgress(next);
      setHistoryVersion((value) => value + 1);
    };
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => window.clearInterval(timer);
  }, [retryProgress?.status]);

  const selectedItems = useMemo(() => {
    if (!selectedEntry) return [];
    const normalized = query.trim().toLowerCase();
    const byId = new Map(books.map((book) => [book.id, book]));
    return selectedEntry.items.filter((item) => {
      const unresolved = !isImportHistoryItemMatched(item, byId.get(item.targetBookId));
      if (showOnlyUnresolved && !unresolved) return false;
      if (!normalized) return true;
      return item.title.toLowerCase().includes(normalized)
        || item.author.toLowerCase().includes(normalized)
        || item.isbn?.toLowerCase().includes(normalized);
    });
  }, [books, query, selectedEntry, showOnlyUnresolved]);

  const togglePaused = () => {
    const next = !paused;
    setPaused(next);
    setImportEnrichmentPaused(next);
    if (!next) onResumeEnrichment();
  };

  const retryEntry = (entry: ImportHistoryEntry, ids?: string[]) => {
    const targetIds = ids ?? entry.items.map((item) => item.targetBookId);
    if (targetIds.length === 0) return;
    retryImportHistoryItems(entry, targetIds);
    setImportEnrichmentPaused(false);
    setPaused(false);
    setRetryProgress(readImportEnrichmentRetryProgress() ?? {
      status: 'queued',
      completed: 0,
      total: targetIds.length,
      matched: 0,
      covers: 0,
      summaries: 0,
      updatedAt: new Date().toISOString(),
    });
    setHistoryVersion((value) => value + 1);
    onResumeEnrichment();
  };

  const retryRunning = retryProgress?.status === 'queued' || retryProgress?.status === 'running';
  const retryPercent = retryProgress?.total
    ? Math.min(100, Math.round((retryProgress.completed / retryProgress.total) * 100))
    : 0;

  return (
    <div className="space-y-7 pb-24">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inkbound-kicker">Import Center</p>
          <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Import History & Book Details</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">
            Completed imports live here. No upload is running on this page. Inkbound may continue looking for optional covers and publisher summaries in the background.
          </p>
        </div>
        <button type="button" onClick={togglePaused} disabled={retryRunning} className="quiet-shelf-secondary-action justify-center disabled:opacity-40">
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          {paused ? 'Resume Background Updates' : 'Pause Background Updates'}
        </button>
      </header>

      {retryProgress && (
        <section className={`rounded-2xl border p-4 ${retryProgress.status === 'error' ? 'border-rose-500/35 bg-rose-950/20' : retryProgress.status === 'complete' ? 'border-emerald-500/30 bg-emerald-950/15' : 'border-[var(--ink-gold)]/35 bg-[var(--ink-gold)]/10'}`} role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            {retryRunning ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--ink-gold)]" /> : <CheckCircle2 className={`h-5 w-5 shrink-0 ${retryProgress.status === 'error' ? 'text-rose-300' : 'text-emerald-300'}`} />}
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[var(--ink-ivory)]">
                {retryProgress.status === 'queued' ? 'Starting missing-detail retry…' : retryProgress.status === 'running' ? 'Retrying missing book details…' : retryProgress.status === 'complete' ? 'Missing-detail retry finished' : 'Retry stopped'}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {retryProgress.message ?? (retryRunning
                  ? `${retryProgress.completed.toLocaleString()} of ${retryProgress.total.toLocaleString()} books checked. You can stay on this page and watch the results update.`
                  : `${retryProgress.matched.toLocaleString()} matched · ${retryProgress.covers.toLocaleString()} covers · ${retryProgress.summaries.toLocaleString()} summaries found during this retry.`)}
              </p>
            </div>
            <span className="text-xs font-bold text-[var(--ink-gold)]">{retryProgress.completed.toLocaleString()} / {retryProgress.total.toLocaleString()}</span>
          </div>
          {retryRunning && retryProgress.total > 0 && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/25">
              <div className="h-full rounded-full bg-[var(--ink-gold)] transition-[width]" style={{ width: `${retryPercent}%` }} />
            </div>
          )}
        </section>
      )}

      {history.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-[var(--ink-border)] p-10 text-center">
          <FileClock className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">No recorded imports yet</h2>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Future completed imports will appear here automatically.</p>
        </section>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
          <aside className="space-y-3">
            {history.map((entry) => {
              const progress = getImportHistoryProgress(entry, books);
              const selected = selectedEntry?.id === entry.id;
              return (
                <button key={entry.id} type="button" onClick={() => setSelectedEntryId(entry.id)} className={`w-full rounded-2xl border p-4 text-left transition ${selected ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-raised)]' : 'border-[var(--ink-border)] bg-[var(--ink-surface-soft)]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-serif text-lg font-bold text-[var(--ink-ivory)]">{entry.sourceName}</p>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">{new Date(entry.createdAt).toLocaleString()}</p>
                    </div>
                    <span className="rounded-full border border-[var(--ink-border)] px-2 py-1 text-[11px] text-[var(--ink-muted)]">{progress.matched}/{entry.importedCount} details matched</span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--ink-surface)]">
                    <div className="h-full rounded-full bg-[var(--ink-gold)]" style={{ width: `${entry.importedCount ? Math.round((progress.matched / entry.importedCount) * 100) : 0}%` }} />
                  </div>
                  <p className="mt-3 text-xs text-[var(--ink-muted)]">{entry.importedCount} imported · {entry.duplicateCount} duplicates skipped · {progress.unresolved} awaiting metadata</p>
                </button>
              );
            })}
          </aside>

          {selectedEntry && (() => {
            const progress = getImportHistoryProgress(selectedEntry, books);
            const byId = new Map(books.map((book) => [book.id, book]));
            const unresolvedIds = selectedEntry.items
              .filter((item) => !isImportHistoryItemMatched(item, byId.get(item.targetBookId)))
              .map((item) => item.targetBookId);
            const isExistingLibrary = selectedEntry.id === 'import-history-existing-library';

            return (
              <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="inkbound-kicker">Import Details</p>
                    <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">{selectedEntry.sourceName} · {new Date(selectedEntry.createdAt).toLocaleDateString()}</h2>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      {isExistingLibrary
                        ? `${selectedEntry.importedCount} previously imported books are already in your Inkbound library. This is history only; no file is currently being uploaded.`
                        : `${selectedEntry.importedCount} books were imported successfully. The import is finished; optional cover and summary updates can continue separately in the background.`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => retryEntry(selectedEntry, unresolvedIds)} disabled={unresolvedIds.length === 0 || retryRunning} className="quiet-shelf-primary-action disabled:opacity-40">
                      {retryRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {retryRunning ? 'Retrying…' : 'Retry Missing Details'}
                    </button>
                    <button type="button" onClick={() => downloadUnresolved(selectedEntry, books)} disabled={unresolvedIds.length === 0} className="quiet-shelf-secondary-action disabled:opacity-40">
                      <Download className="h-4 w-4" /> Download Missing List
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    ['Imported', selectedEntry.importedCount],
                    ['Duplicates skipped', selectedEntry.duplicateCount],
                    ['Details matched', progress.matched],
                    ['Covers found', progress.covers],
                    ['Awaiting metadata', progress.unresolved],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">{label}</p>
                      <p className="mt-2 font-serif text-3xl font-bold text-[var(--ink-ivory)]">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <label className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title or author" className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] pl-11 pr-4 text-sm text-[var(--ink-ivory)] outline-none" />
                  </label>
                  <button type="button" onClick={() => setShowOnlyUnresolved((current) => !current)} className={`quiet-shelf-secondary-action justify-center ${showOnlyUnresolved ? 'border-[var(--ink-gold)] text-[var(--ink-gold)]' : ''}`}>
                    {showOnlyUnresolved ? 'Showing Missing Details' : 'Show Missing Details Only'}
                  </button>
                </div>

                <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">
                  {selectedItems.map((item) => {
                    const book = byId.get(item.targetBookId);
                    const editions = Array.isArray(book?.editions) ? book.editions : [];
                    const edition = editions.find((editionItem) => editionItem.id === book?.activeEditionId) ?? editions[0];
                    const matched = isImportHistoryItemMatched(item, book);
                    const queued = queuedBookIds.has(item.targetBookId);
                    const hasCover = Boolean(edition?.coverUrl);
                    const hasSummary = Boolean(book?.work?.publisherSummary?.trim());
                    const statusLabel = matched ? 'Details matched' : queued ? 'Background update queued' : 'Details not matched';

                    return (
                      <article key={item.targetBookId} className="flex flex-col gap-3 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <strong className="block truncate text-sm text-[var(--ink-ivory)]">{item.title}</strong>
                          <span className="text-xs text-[var(--ink-muted)]">{item.author}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className={`rounded-full px-2.5 py-1 font-bold ${matched ? 'bg-emerald-500/15 text-emerald-300' : queued ? 'bg-amber-500/15 text-amber-300' : 'bg-[var(--ink-surface)] text-[var(--ink-muted)]'}`}>{statusLabel}</span>
                          <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1 text-[var(--ink-muted)]">{hasCover ? 'Cover ✓' : 'Cover —'}</span>
                          <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1 text-[var(--ink-muted)]">{hasSummary ? 'Summary ✓' : 'Summary —'}</span>
                          {!matched && <button type="button" disabled={retryRunning} onClick={() => retryEntry(selectedEntry, [item.targetBookId])} className="rounded-full border border-[var(--ink-gold)] px-2.5 py-1 font-bold text-[var(--ink-gold)] disabled:opacity-40">Retry</button>}
                        </div>
                      </article>
                    );
                  })}
                  {selectedItems.length === 0 && <p className="rounded-xl border border-dashed border-[var(--ink-border)] p-8 text-center text-sm text-[var(--ink-muted)]">No books match this filter.</p>}
                </div>
              </section>
            );
          })()}
        </div>
      )}
    </div>
  );
};
