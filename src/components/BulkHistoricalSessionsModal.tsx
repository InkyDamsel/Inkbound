import { compareLibraryLabels } from '../features/library/librarySectionSort';
import React, { useMemo, useState } from 'react';
import { CopyPlus, Plus, Save, Trash2, X } from 'lucide-react';
import type { ReadingSession, UserBookRecord } from '../types';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { localDateKey } from '../features/reading/sessionAnalytics';
import { CanonicalInput, CanonicalNumberInput } from './form/CanonicalInput';

interface BulkHistoricalSessionsModalProps {
  books: UserBookRecord[];
  onClose: () => void;
  onSave: (sessions: ReadingSession[]) => void;
}

interface HistoricalSessionDraft {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  startProgress?: number;
  endProgress?: number;
  notes: string;
}

const createDraft = (startProgress = 0, date = localDateKey()): HistoricalSessionDraft => ({
  id: crypto.randomUUID(),
  date,
  startTime: '19:00',
  endTime: '19:30',
  startProgress,
  endProgress: startProgress,
  notes: '',
});

const minutesBetween = (startTime: string, endTime: string) => {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null;
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end < start) end += 24 * 60;
  return Math.max(1, end - start);
};

export const BulkHistoricalSessionsModal: React.FC<BulkHistoricalSessionsModalProps> = ({ books, onClose, onSave }) => {
  const initialBook = books[0];
  const initialEdition = initialBook ? getActiveEdition(initialBook) : undefined;
  const initialProgress = initialEdition?.format === 'audiobook'
    ? initialBook?.progressMinutes ?? 0
    : initialBook?.progressPages ?? 0;

  const [bookId, setBookId] = useState(initialBook?.id ?? '');
  const [bookSearch, setBookSearch] = useState('');
  const [rows, setRows] = useState<HistoricalSessionDraft[]>(() => [createDraft(initialProgress)]);
  const [error, setError] = useState('');

  const selectedBook = useMemo(() => books.find((book) => book.id === bookId), [bookId, books]);
  const edition = selectedBook ? getActiveEdition(selectedBook) : undefined;
  const isAudiobook = edition?.format === 'audiobook';

  const matchingBooks = useMemo(() => {
    const query = bookSearch.trim().toLowerCase();
    return [...books]
      .filter((book) => !query ||
        book.work.title.toLowerCase().includes(query)
        || book.work.author.toLowerCase().includes(query)
        || book.work.seriesName?.toLowerCase().includes(query),
      )
      .sort((a, b) => compareLibraryLabels(a.work.title, b.work.title) || compareLibraryLabels(a.work.author, b.work.author))
      .slice(0, 100);
  }, [bookSearch, books]);

  const updateRow = (id: string, changes: Partial<HistoricalSessionDraft>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...changes } : row));
    setError('');
  };

  const selectBook = (nextBookId: string) => {
    setBookId(nextBookId);
    setError('');
    const nextBook = books.find((book) => book.id === nextBookId);
    if (!nextBook) return;
    const nextEdition = getActiveEdition(nextBook);
    const currentProgress = nextEdition?.format === 'audiobook' ? nextBook.progressMinutes : nextBook.progressPages;
    setRows([createDraft(currentProgress)]);
  };

  const addRow = () => {
    const previous = rows.at(-1);
    const previousEnd = previous?.endProgress ?? 0;
    setRows((current) => [
      ...current,
      createDraft(previousEnd, previous?.date ?? localDateKey()),
    ]);
  };

  const duplicateLastRow = () => {
    const previous = rows.at(-1);
    if (!previous) return addRow();
    const previousEnd = previous.endProgress ?? 0;
    setRows((current) => [
      ...current,
      {
        ...previous,
        id: crypto.randomUUID(),
        startProgress: previousEnd,
        endProgress: previousEnd,
        notes: '',
      },
    ]);
  };

  const removeRow = (id: string) => {
    setRows((current) => current.length === 1 ? current : current.filter((row) => row.id !== id));
  };

  const saveAll = () => {
    if (!selectedBook || !edition) {
      setError('Choose a book before adding historical sessions.');
      return;
    }

    const nextSessions: ReadingSession[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const label = `Row ${index + 1}`;

      if (!row.date || row.date > localDateKey()) {
        setError(`${label}: choose a valid date that is not in the future.`);
        return;
      }

      const durationMinutes = minutesBetween(row.startTime, row.endTime);
      if (!durationMinutes) {
        setError(`${label}: choose valid start and end times.`);
        return;
      }

      const startProgress = row.startProgress;
      const endProgress = row.endProgress;
      if (startProgress === undefined || endProgress === undefined) {
        setError(`${label}: enter both starting and ending ${isAudiobook ? 'minutes' : 'pages'}.`);
        return;
      }
      if (endProgress < startProgress) {
        setError(`${label}: ending ${isAudiobook ? 'minutes' : 'page'} cannot be before the starting value.`);
        return;
      }
      if (!isAudiobook && edition.pageCount && endProgress > edition.pageCount) {
        setError(`${label}: ending page cannot be greater than ${edition.pageCount.toLocaleString()}.`);
        return;
      }
      if (isAudiobook && edition.audiobookDurationMins && endProgress > edition.audiobookDurationMins) {
        setError(`${label}: ending minute cannot be greater than ${edition.audiobookDurationMins.toLocaleString()}.`);
        return;
      }

      nextSessions.push({
        id: crypto.randomUUID(),
        bookId: selectedBook.id,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        durationMinutes,
        startPage: isAudiobook ? undefined : startProgress,
        endPage: isAudiobook ? undefined : endProgress,
        pagesRead: isAudiobook ? undefined : Math.max(0, endProgress - startProgress),
        startTimestampSec: isAudiobook ? startProgress * 60 : undefined,
        endTimestampSec: isAudiobook ? endProgress * 60 : undefined,
        minutesListened: isAudiobook ? Math.max(0, endProgress - startProgress) : undefined,
        listeningSpeed: isAudiobook ? 1 : undefined,
        notes: row.notes.trim() || undefined,
      });
    }

    onSave(nextSessions);
    onClose();
  };

  if (!initialBook) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <section className="inkbound-modal-surface mx-auto min-h-0 max-h-[calc(100dvh-1.5rem)] w-full max-w-[960px] overflow-y-auto overscroll-contain rounded-t-3xl border border-[var(--ink-border)] bg-[var(--ink-panel)] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl sm:!max-h-[88dvh] sm:!max-w-[960px] sm:rounded-3xl sm:p-6" style={{ maxWidth: "min(960px, calc(100vw - 24px))" }} role="dialog" aria-modal="true" aria-labelledby="bulk-historical-sessions-title" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="inkbound-kicker">Reading journal</p>
            <h3 id="bulk-historical-sessions-title" className="font-serif text-2xl text-[var(--ink-text-primary)]">Add Past Sessions</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--ink-text-muted)]">Choose one book, then enter as many past sessions as you need. Inkbound derives duration and pages read from the canonical start/end values.</p>
          </div>
          <button type="button" onClick={onClose} className="quiet-shelf-secondary-action h-11 w-11 shrink-0 p-0" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-5 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Find book
            <CanonicalInput value={bookSearch} onValueChange={setBookSearch} placeholder="Search title, author, or series" className="inkbound-select mt-1 w-full" />
          </label>
          <label className="mt-3 block text-xs font-bold text-[var(--ink-text-primary)]">Book
            <select value={bookId} onChange={(event) => selectBook(event.target.value)} className="inkbound-select mt-1 w-full">
              {!matchingBooks.some((book) => book.id === bookId) && selectedBook && <option value={selectedBook.id}>{selectedBook.work.title} — {selectedBook.work.author}</option>}
              {matchingBooks.map((book) => <option key={book.id} value={book.id}>{book.work.title} — {book.work.author}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-5 space-y-3">
          {rows.map((row, index) => {
            const duration = minutesBetween(row.startTime, row.endTime);
            return (
              <article key={row.id} className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm text-[var(--ink-text-primary)]">Session {index + 1}</strong>
                  <button type="button" onClick={() => removeRow(row.id)} disabled={rows.length === 1} className="quiet-shelf-secondary-action min-h-10 px-3 text-rose-300 disabled:opacity-30" aria-label={`Remove session ${index + 1}`}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <label className="text-xs font-bold text-[var(--ink-text-primary)]">Date<input type="date" max={localDateKey()} value={row.date} onChange={(event) => updateRow(row.id, { date: event.target.value })} className="inkbound-select mt-1 w-full" /></label>
                  <label className="text-xs font-bold text-[var(--ink-text-primary)]">Start<input type="time" value={row.startTime} onChange={(event) => updateRow(row.id, { startTime: event.target.value })} className="inkbound-select mt-1 w-full" /></label>
                  <label className="text-xs font-bold text-[var(--ink-text-primary)]">End<input type="time" value={row.endTime} onChange={(event) => updateRow(row.id, { endTime: event.target.value })} className="inkbound-select mt-1 w-full" /></label>
                  <label className="text-xs font-bold text-[var(--ink-text-primary)]">Duration<input readOnly value={duration ?? ''} className="inkbound-select mt-1 w-full cursor-default opacity-80" /></label>
                  <label className="text-xs font-bold text-[var(--ink-text-primary)]">{isAudiobook ? 'Start min' : 'Start page'}<CanonicalNumberInput min={0} inputMode="numeric" value={row.startProgress} allowEmpty onDraftChange={(raw) => { if (!raw.trim()) updateRow(row.id, { startProgress: undefined }); }} onCommit={(value) => updateRow(row.id, { startProgress: value })} className="inkbound-select mt-1 w-full" /></label>
                  <label className="text-xs font-bold text-[var(--ink-text-primary)]">{isAudiobook ? 'End min' : 'End page'}<CanonicalNumberInput min={0} inputMode="numeric" value={row.endProgress} allowEmpty onDraftChange={(raw) => { if (!raw.trim()) updateRow(row.id, { endProgress: undefined }); }} onCommit={(value) => updateRow(row.id, { endProgress: value })} className="inkbound-select mt-1 w-full" /></label>
                  <label className="text-xs font-bold text-[var(--ink-text-primary)] sm:col-span-2 lg:col-span-6">Notes <span className="font-normal text-[var(--ink-text-muted)]">(optional)</span><CanonicalInput value={row.notes} onValueChange={(value) => updateRow(row.id, { notes: value })} className="inkbound-select mt-1 w-full" /></label>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={addRow} className="quiet-shelf-secondary-action justify-center"><Plus className="h-4 w-4" /> Add Blank Row</button>
          <button type="button" onClick={duplicateLastRow} className="quiet-shelf-secondary-action justify-center"><CopyPlus className="h-4 w-4" /> Continue From Last</button>
        </div>

        {error && <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-sm text-rose-200">{error}</p>}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="quiet-shelf-secondary-action justify-center">Cancel</button>
          <button type="button" onClick={saveAll} className="quiet-shelf-primary-action justify-center"><Save className="h-4 w-4" /> Save {rows.length} Session{rows.length === 1 ? '' : 's'}</button>
        </div>
      </section>
    </div>
  );
};
