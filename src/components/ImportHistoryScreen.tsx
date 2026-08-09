import React, { useMemo, useState } from 'react';
import { Download, FileClock, Pause, Play, RefreshCw, Search } from 'lucide-react';
import type { UserBookRecord } from '../types';
import {
  getImportHistoryProgress,
  isImportEnrichmentPaused,
  readImportHistory,
  retryImportHistoryItems,
  setImportEnrichmentPaused,
  type ImportHistoryEntry,
} from '../features/import/importHistory';

interface ImportHistoryScreenProps {
  books: UserBookRecord[];
  onResumeEnrichment: () => void;
}

function downloadUnresolved(entry: ImportHistoryEntry, books: UserBookRecord[]) {
  const byId = new Map(books.map((book) => [book.id, book]));
  const rows = entry.items.filter((item) => byId.get(item.targetBookId)?.importMetadataVerified !== true);
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
  const history = useMemo(() => readImportHistory(), [historyVersion]);
  const selectedEntry = history.find((entry) => entry.id === selectedEntryId) ?? history[0] ?? null;

  const selectedItems = useMemo(() => {
    if (!selectedEntry) return [];
    const normalized = query.trim().toLowerCase();
    const byId = new Map(books.map((book) => [book.id, book]));
    return selectedEntry.items.filter((item) => {
      const unresolved = byId.get(item.targetBookId)?.importMetadataVerified !== true;
      if (showOnlyUnresolved && !unresolved) return false;
      if (!normalized) return true;
      return item.title.toLowerCase().includes(normalized) || item.author.toLowerCase().includes(normalized) || item.isbn?.toLowerCase().includes(normalized);
    });
  }, [books, query, selectedEntry, showOnlyUnresolved]);

  const togglePaused = () => {
    const next = !paused;
    setPaused(next);
    setImportEnrichmentPaused(next);
    if (!next) onResumeEnrichment();
  };

  const retryEntry = (entry: ImportHistoryEntry, ids?: string[]) => {
    retryImportHistoryItems(entry, ids);
    setImportEnrichmentPaused(false);
    setPaused(false);
    setHistoryVersion((value) => value + 1);
    onResumeEnrichment();
  };

  return (
    <div className="space-y-7 pb-24">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inkbound-kicker">Import Center</p>
          <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Import History & Metadata</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">Your books are imported independently from optional cover and publisher metadata. This page shows both states without treating a metadata miss as a failed import.</p>
        </div>
        <button type="button" onClick={togglePaused} className="quiet-shelf-secondary-action justify-center">
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          {paused ? 'Resume Metadata Updates' : 'Pause Metadata Updates'}
        </button>
      </header>

      {history.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-[var(--ink-border)] p-10 text-center">
          <FileClock className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">No recorded imports yet</h2>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Future imports will appear here automatically with live metadata progress.</p>
        </section>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
          <aside className="space-y-3">
            {history.map((entry) => {
              const progress = getImportHistoryProgress(entry, books);
              const selected = selectedEntry?.id === entry.id;
              return (
                <button key={entry.id} type="button" onClick={() => setSelectedEntryId(entry.id)} className={`w-full rounded-2xl border p-4 text-left transition ${selected ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-raised)]' : 'border-[var(--ink-border)] bg-[var(--ink-surface-soft)]'}`}>
                  <div className="flex items-start justify-between gap-3"><div><p className="font-serif text-lg font-bold text-[var(--ink-ivory)]">{entry.sourceName}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{new Date(entry.createdAt).toLocaleString()}</p></div><span className="rounded-full border border-[var(--ink-border)] px-2 py-1 text-[11px] text-[var(--ink-muted)]">{progress.matched}/{entry.importedCount} matched</span></div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--ink-surface)]"><div className="h-full rounded-full bg-[var(--ink-gold)]" style={{ width: `${entry.importedCount ? Math.round((progress.matched / entry.importedCount) * 100) : 0}%` }} /></div>
                  <p className="mt-3 text-xs text-[var(--ink-muted)]">{entry.importedCount} imported · {entry.duplicateCount} duplicates skipped · {progress.queued} queued</p>
                </button>
              );
            })}
          </aside>

          {selectedEntry && (() => {
            const progress = getImportHistoryProgress(selectedEntry, books);
            const byId = new Map(books.map((book) => [book.id, book]));
            const unresolvedIds = selectedEntry.items.filter((item) => byId.get(item.targetBookId)?.importMetadataVerified !== true).map((item) => item.targetBookId);
            return (
              <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div><p className="inkbound-kicker">Import Details</p><h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">{selectedEntry.sourceName} · {new Date(selectedEntry.createdAt).toLocaleDateString()}</h2><p className="mt-2 text-sm text-[var(--ink-muted)]">{selectedEntry.importedCount} books imported successfully. Metadata progress below can continue changing without altering your imported reading data.</p></div>
                  <div className="flex flex-wrap gap-2"><button type="button" onClick={() => retryEntry(selectedEntry, unresolvedIds)} disabled={unresolvedIds.length === 0} className="quiet-shelf-primary-action disabled:opacity-40"><RefreshCw className="h-4 w-4" /> Retry Unresolved</button><button type="button" onClick={() => downloadUnresolved(selectedEntry, books)} disabled={unresolvedIds.length === 0} className="quiet-shelf-secondary-action disabled:opacity-40"><Download className="h-4 w-4" /> Download Unresolved</button></div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {[['Imported', selectedEntry.importedCount], ['Duplicates skipped', selectedEntry.duplicateCount], ['Metadata matched', progress.matched], ['Covers found', progress.covers], ['Still queued', progress.queued]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">{label}</p><p className="mt-2 font-serif text-3xl font-bold text-[var(--ink-ivory)]">{value}</p></div>)}
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <label className="relative flex-1"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this import" className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] pl-11 pr-4 text-sm text-[var(--ink-ivory)] outline-none" /></label>
                  <button type="button" onClick={() => setShowOnlyUnresolved((current) => !current)} className={`quiet-shelf-secondary-action justify-center ${showOnlyUnresolved ? 'border-[var(--ink-gold)] text-[var(--ink-gold)]' : ''}`}>{showOnlyUnresolved ? 'Showing Unresolved' : 'Show Unresolved Only'}</button>
                </div>

                <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">
                  {selectedItems.map((item) => {
                    const book = byId.get(item.targetBookId);
                    const edition = book?.editions.find((editionItem) => editionItem.id === book.activeEditionId) ?? book?.editions[0];
                    const matched = book?.importMetadataVerified === true;
                    const hasCover = Boolean(edition?.coverUrl);
                    const hasSummary = Boolean(book?.work.publisherSummary?.trim());
                    return <article key={item.targetBookId} className="flex flex-col gap-3 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><strong className="block truncate text-sm text-[var(--ink-ivory)]">{item.title}</strong><span className="text-xs text-[var(--ink-muted)]">{item.author}{item.isbn ? ` · ${item.isbn}` : ''}</span></div><div className="flex flex-wrap items-center gap-2 text-[11px]"><span className={`rounded-full px-2.5 py-1 font-bold ${matched ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{matched ? 'Metadata matched' : 'Awaiting metadata'}</span><span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1 text-[var(--ink-muted)]">{hasCover ? 'Cover ✓' : 'Cover —'}</span><span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1 text-[var(--ink-muted)]">{hasSummary ? 'Summary ✓' : 'Summary —'}</span>{!matched && <button type="button" onClick={() => retryEntry(selectedEntry, [item.targetBookId])} className="rounded-full border border-[var(--ink-gold)] px-2.5 py-1 font-bold text-[var(--ink-gold)]">Retry</button>}</div></article>;
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
