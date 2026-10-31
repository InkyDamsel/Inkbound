import { compareLibraryLabels } from '../features/library/librarySectionSort';
import React, { useMemo, useState } from 'react';
import { CanonicalNumberInput } from './form/CanonicalInput';
import { ReadingSession, UserBookRecord } from '../types';
import { Save, Trash2, X } from 'lucide-react';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { localDateKey } from '../features/reading/sessionAnalytics';

interface SessionEditorModalProps {
  books: UserBookRecord[];
  session?: ReadingSession;
  onClose: () => void;
  onSave: (session: ReadingSession) => void;
  onDelete?: (sessionId: string) => void;
}

const minutesBetween = (startTime: string, endTime: string) => {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null;

  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end < start) end += 24 * 60;
  return Math.max(1, end - start);
};

export const SessionEditorModal: React.FC<SessionEditorModalProps> = ({ books, session, onClose, onSave, onDelete }) => {
  const initialBook = books.find((book) => book.id === session?.bookId) ?? books[0];
  const initialEdition = initialBook ? getActiveEdition(initialBook) : undefined;
  const initialIsAudiobook = initialEdition?.format === 'audiobook';
  const initialProgress = session
    ? session.startPage ?? Math.floor((session.startTimestampSec ?? 0) / 60)
    : initialIsAudiobook
      ? initialBook?.progressMinutes ?? 0
      : initialBook?.progressPages ?? 0;
  const initialEndProgress = session
    ? session.endPage ?? Math.floor((session.endTimestampSec ?? 0) / 60)
    : initialProgress;

  const [bookId, setBookId] = useState(session?.bookId ?? initialBook?.id ?? '');
  const [bookSearch, setBookSearch] = useState('');
  const [date, setDate] = useState(session?.date ?? localDateKey());
  const [startTime, setStartTime] = useState(session?.startTime ?? '19:00');
  const [endTime, setEndTime] = useState(session?.endTime ?? '19:30');
  const [startProgress, setStartProgress] = useState<number | undefined>(initialProgress);
  const [endProgress, setEndProgress] = useState<number | undefined>(initialEndProgress);
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [mood, setMood] = useState(session?.mood ?? '');
  const [location, setLocation] = useState(session?.location ?? '');
  const [error, setError] = useState('');

  const matchingBooks = useMemo(() => {
    const query = bookSearch.trim().toLocaleLowerCase();
    return [...books].filter((book) => !query || `${book.work.title} ${book.work.author} ${book.work.seriesName ?? ''}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => compareLibraryLabels(a.work.title, b.work.title) || compareLibraryLabels(a.work.author, b.work.author));
  }, [books, bookSearch]);
  const selectedBook = useMemo(() => books.find((book) => book.id === bookId), [bookId, books]);
  const edition = selectedBook ? getActiveEdition(selectedBook) : undefined;
  const isAudiobook = edition?.format === 'audiobook';
  const durationMinutes = useMemo(() => minutesBetween(startTime, endTime), [startTime, endTime]);

  const handleBookChange = (nextBookId: string) => {
    setBookId(nextBookId);
    setError('');
    const nextBook = books.find((book) => book.id === nextBookId);
    if (!nextBook) return;
    const nextEdition = getActiveEdition(nextBook);
    const nextIsAudiobook = nextEdition?.format === 'audiobook';
    const currentProgress = nextIsAudiobook ? nextBook.progressMinutes : nextBook.progressPages;
    setStartProgress(currentProgress);
    setEndProgress(currentProgress);
  };

  const save = () => {
    if (!selectedBook) {
      setError('Choose a book for this session.');
      return;
    }
    if (!date) {
      setError('Choose the date of this reading session.');
      return;
    }
    if (date > localDateKey()) {
      setError('A reading session cannot be saved in the future.');
      return;
    }
    if (durationMinutes === null || durationMinutes <= 0) {
      setError('Choose valid start and end times for this session.');
      return;
    }

    const parsedStartProgress = startProgress;
    const parsedEndProgress = endProgress;
    if (parsedStartProgress === undefined || parsedEndProgress === undefined) {
      setError(isAudiobook ? 'Enter starting and ending minutes.' : 'Enter a starting and ending page.');
      return;
    }
    if (parsedEndProgress < parsedStartProgress) {
      setError(isAudiobook ? 'Ending minutes cannot be before starting minutes.' : 'Ending page cannot be before starting page.');
      return;
    }

    if (!isAudiobook && edition?.pageCount && parsedEndProgress > edition.pageCount) {
      setError(`Ending page cannot be greater than this edition's ${edition.pageCount.toLocaleString()} pages.`);
      return;
    }
    if (isAudiobook && edition?.audiobookDurationMins && parsedEndProgress > edition.audiobookDurationMins) {
      setError(`Ending minute cannot be greater than this audiobook's ${edition.audiobookDurationMins.toLocaleString()} minutes.`);
      return;
    }

    onSave({
      id: session?.id ?? crypto.randomUUID(),
      bookId: selectedBook.id,
      date,
      startTime,
      endTime,
      durationMinutes,
      startPage: isAudiobook ? undefined : parsedStartProgress,
      endPage: isAudiobook ? undefined : parsedEndProgress,
      pagesRead: isAudiobook ? undefined : Math.max(0, parsedEndProgress - parsedStartProgress),
      startTimestampSec: isAudiobook ? parsedStartProgress * 60 : undefined,
      endTimestampSec: isAudiobook ? parsedEndProgress * 60 : undefined,
      minutesListened: isAudiobook ? Math.max(0, parsedEndProgress - parsedStartProgress) : undefined,
      listeningSpeed: isAudiobook ? session?.listeningSpeed ?? 1 : undefined,
      notes: notes.trim() || undefined,
      mood: mood.trim() || undefined,
      location: location.trim() || undefined,
    });
    onClose();
  };

  if (!initialBook) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <section className="inkbound-modal-surface mx-auto min-h-0 max-h-[calc(100dvh-1.5rem)] w-full max-w-[960px] overflow-y-auto overscroll-contain rounded-t-3xl border border-[var(--ink-border)] bg-[var(--ink-panel)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl sm:!max-h-[88dvh] sm:!max-w-[960px] sm:rounded-2xl sm:p-6" style={{ maxWidth: "min(960px, calc(100vw - 24px))" }} role="dialog" aria-modal="true" aria-labelledby="session-editor-title" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="inkbound-kicker">Reading journal</p>
            <h3 id="session-editor-title" className="font-serif text-2xl text-[var(--ink-text-primary)]">{session ? 'Edit Session' : 'Add Session Manually'}</h3>
            <p className="mt-1 text-xs text-[var(--ink-text-muted)]">Only activity you record in Inkbound is saved to your reading tracker.</p>
          </div>
          <button type="button" onClick={onClose} className="quiet-shelf-secondary-action h-11 w-11 shrink-0 p-0" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2 text-xs font-bold text-[var(--ink-text-primary)]">Book
            <input type="search" value={bookSearch} onChange={(event) => setBookSearch(event.target.value)} placeholder="Search title, author, or series" aria-label="Search books for session" className="inkbound-select mt-1 w-full" />
            <select value={bookId} onChange={(event) => handleBookChange(event.target.value)} className="inkbound-select mt-2 w-full">
              {selectedBook && !matchingBooks.some((book) => book.id === selectedBook.id) && <option value={selectedBook.id}>{selectedBook.work.title} — {selectedBook.work.author}</option>}
              {matchingBooks.map((book) => <option key={book.id} value={book.id}>{book.work.title} — {book.work.author}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Date<input type="date" max={localDateKey()} value={date} onChange={(event) => setDate(event.target.value)} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Duration (minutes)<input type="number" value={durationMinutes ?? ''} readOnly className="inkbound-select mt-1 w-full cursor-default opacity-80" aria-describedby="session-duration-help" /><span id="session-duration-help" className="mt-1 block font-normal text-[var(--ink-text-muted)]">Calculated from start and end time.</span></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Start time<input type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); setError(''); }} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">End time<input type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); setError(''); }} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">{isAudiobook ? 'Starting minute' : 'Starting page'}<CanonicalNumberInput inputMode="numeric" min={0} value={startProgress} allowEmpty onDraftChange={(raw) => { if (!raw.trim()) setStartProgress(undefined); setError(''); }} onCommit={(value) => { setStartProgress(value); setError(''); }} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">{isAudiobook ? 'Ending minute' : 'Ending page'}<CanonicalNumberInput inputMode="numeric" min={0} value={endProgress} allowEmpty onDraftChange={(raw) => { if (!raw.trim()) setEndProgress(undefined); setError(''); }} onCommit={(value) => { setEndProgress(value); setError(''); }} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Mood <span className="font-normal text-[var(--ink-text-muted)]">(optional)</span><input value={mood} onChange={(event) => setMood(event.target.value)} placeholder="e.g. Cozy, tense, emotional" className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Location <span className="font-normal text-[var(--ink-text-muted)]">(optional)</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Home, commute, café" className="inkbound-select mt-1 w-full" /></label>
          <label className="sm:col-span-2 text-xs font-bold text-[var(--ink-text-primary)]">Notes <span className="font-normal text-[var(--ink-text-muted)]">(optional)</span><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} className="inkbound-select mt-1 w-full resize-y" /></label>
        </div>

        {error && <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-sm text-rose-200">{error}</p>}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          {session && onDelete ? <button type="button" onClick={() => { onDelete(session.id); onClose(); }} className="quiet-shelf-secondary-action w-full justify-center text-rose-300 sm:w-auto"><Trash2 className="h-4 w-4" /> Delete</button> : <span />}
          <button type="button" onClick={save} className="quiet-shelf-primary-action w-full justify-center sm:w-auto"><Save className="h-4 w-4" /> {session ? 'Save Changes' : 'Add Session'}</button>
        </div>
      </section>
    </div>
  );
};