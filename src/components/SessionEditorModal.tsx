import React, { useMemo, useState } from 'react';
import { ReadingSession, UserBookRecord } from '../types';
import { Save, Trash2, X } from 'lucide-react';

interface SessionEditorModalProps {
  books: UserBookRecord[];
  session?: ReadingSession;
  onClose: () => void;
  onSave: (session: ReadingSession) => void;
  onDelete?: (sessionId: string) => void;
}

const localDate = (value = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
  const initialEdition = initialBook?.editions.find((item) => item.id === initialBook.activeEditionId) ?? initialBook?.editions[0];
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
  const [date, setDate] = useState(session?.date ?? localDate());
  const [startTime, setStartTime] = useState(session?.startTime ?? '19:00');
  const [endTime, setEndTime] = useState(session?.endTime ?? '19:30');
  const [durationMinutes, setDurationMinutes] = useState(session?.durationMinutes ?? 30);
  const [startProgress, setStartProgress] = useState(initialProgress);
  const [endProgress, setEndProgress] = useState(initialEndProgress);
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [mood, setMood] = useState(session?.mood ?? '');
  const [location, setLocation] = useState(session?.location ?? '');
  const [error, setError] = useState('');

  const selectedBook = useMemo(() => books.find((book) => book.id === bookId), [bookId, books]);
  const edition = selectedBook?.editions.find((item) => item.id === selectedBook.activeEditionId) ?? selectedBook?.editions[0];
  const isAudiobook = edition?.format === 'audiobook';

  const handleBookChange = (nextBookId: string) => {
    setBookId(nextBookId);
    setError('');
    const nextBook = books.find((book) => book.id === nextBookId);
    if (!nextBook) return;
    const nextEdition = nextBook.editions.find((item) => item.id === nextBook.activeEditionId) ?? nextBook.editions[0];
    const nextIsAudiobook = nextEdition?.format === 'audiobook';
    const currentProgress = nextIsAudiobook ? nextBook.progressMinutes : nextBook.progressPages;
    setStartProgress(currentProgress);
    setEndProgress(currentProgress);
  };

  const updateTime = (kind: 'start' | 'end', value: string) => {
    const nextStart = kind === 'start' ? value : startTime;
    const nextEnd = kind === 'end' ? value : endTime;
    if (kind === 'start') setStartTime(value);
    else setEndTime(value);

    const derivedDuration = minutesBetween(nextStart, nextEnd);
    if (derivedDuration !== null) setDurationMinutes(derivedDuration);
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
    if (date > localDate()) {
      setError('A reading session cannot be saved in the future.');
      return;
    }
    if (durationMinutes <= 0) {
      setError('Duration must be at least 1 minute.');
      return;
    }
    if (endProgress < startProgress) {
      setError(isAudiobook ? 'Ending minutes cannot be before starting minutes.' : 'Ending page cannot be before starting page.');
      return;
    }

    if (!isAudiobook && edition?.pageCount && endProgress > edition.pageCount) {
      setError(`Ending page cannot be greater than this edition's ${edition.pageCount.toLocaleString()} pages.`);
      return;
    }
    if (isAudiobook && edition?.audiobookDurationMins && endProgress > edition.audiobookDurationMins) {
      setError(`Ending minute cannot be greater than this audiobook's ${edition.audiobookDurationMins.toLocaleString()} minutes.`);
      return;
    }

    onSave({
      id: session?.id ?? `sess-${Date.now()}`,
      bookId: selectedBook.id,
      date,
      startTime,
      endTime,
      durationMinutes,
      startPage: isAudiobook ? undefined : startProgress,
      endPage: isAudiobook ? undefined : endProgress,
      pagesRead: isAudiobook ? undefined : Math.max(0, endProgress - startProgress),
      startTimestampSec: isAudiobook ? startProgress * 60 : undefined,
      endTimestampSec: isAudiobook ? endProgress * 60 : undefined,
      minutesListened: isAudiobook ? Math.max(0, endProgress - startProgress) : undefined,
      listeningSpeed: isAudiobook ? session?.listeningSpeed ?? 1 : undefined,
      notes: notes.trim() || undefined,
      mood: mood.trim() || undefined,
      location: location.trim() || undefined,
    });
    onClose();
  };

  if (!initialBook) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section className="w-full max-w-xl rounded-t-3xl border border-[var(--ink-border)] bg-[var(--ink-panel)] p-5 shadow-2xl sm:rounded-2xl sm:p-6" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="inkbound-kicker">Reading journal</p>
            <h3 className="font-serif text-2xl text-[var(--ink-text-primary)]">{session ? 'Edit Session' : 'Add Session Manually'}</h3>
            <p className="mt-1 text-xs text-[var(--ink-text-muted)]">Only activity you record in Inkbound is saved to your reading tracker.</p>
          </div>
          <button type="button" onClick={onClose} className="quiet-shelf-secondary-action p-2" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2 text-xs font-bold text-[var(--ink-text-primary)]">Book
            <select value={bookId} onChange={(event) => handleBookChange(event.target.value)} className="inkbound-select mt-1 w-full">
              {books.map((book) => <option key={book.id} value={book.id}>{book.work.title} — {book.work.author}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Date<input type="date" max={localDate()} value={date} onChange={(event) => setDate(event.target.value)} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Duration (minutes)<input type="number" min={1} value={durationMinutes} onChange={(event) => setDurationMinutes(Math.max(0, Number(event.target.value) || 0))} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Start time<input type="time" value={startTime} onChange={(event) => updateTime('start', event.target.value)} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">End time<input type="time" value={endTime} onChange={(event) => updateTime('end', event.target.value)} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">{isAudiobook ? 'Starting minute' : 'Starting page'}<input type="number" min={0} value={startProgress} onChange={(event) => setStartProgress(Math.max(0, Number(event.target.value) || 0))} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">{isAudiobook ? 'Ending minute' : 'Ending page'}<input type="number" min={0} value={endProgress} onChange={(event) => setEndProgress(Math.max(0, Number(event.target.value) || 0))} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Mood <span className="font-normal text-[var(--ink-text-muted)]">(optional)</span><input value={mood} onChange={(event) => setMood(event.target.value)} placeholder="e.g. Cozy, tense, emotional" className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Location <span className="font-normal text-[var(--ink-text-muted)]">(optional)</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Home, commute, café" className="inkbound-select mt-1 w-full" /></label>
          <label className="sm:col-span-2 text-xs font-bold text-[var(--ink-text-primary)]">Notes <span className="font-normal text-[var(--ink-text-muted)]">(optional)</span><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} className="inkbound-select mt-1 w-full resize-y" /></label>
        </div>

        {error && <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-sm text-rose-200">{error}</p>}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          {session && onDelete ? <button type="button" onClick={() => { if (window.confirm('Delete this reading session?')) { onDelete(session.id); onClose(); } }} className="quiet-shelf-secondary-action text-rose-300"><Trash2 className="h-4 w-4" /> Delete</button> : <span />}
          <button type="button" onClick={save} className="quiet-shelf-primary-action"><Save className="h-4 w-4" /> {session ? 'Save Changes' : 'Add Session'}</button>
        </div>
      </section>
    </div>
  );
};
