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

const today = () => new Date().toISOString().slice(0, 10);

export const SessionEditorModal: React.FC<SessionEditorModalProps> = ({ books, session, onClose, onSave, onDelete }) => {
  const initialBook = books.find((book) => book.id === session?.bookId) ?? books[0];
  const [bookId, setBookId] = useState(session?.bookId ?? initialBook?.id ?? '');
  const [date, setDate] = useState(session?.date ?? today());
  const [startTime, setStartTime] = useState(session?.startTime ?? '19:00');
  const [endTime, setEndTime] = useState(session?.endTime ?? '19:30');
  const [durationMinutes, setDurationMinutes] = useState(session?.durationMinutes ?? 30);
  const [startProgress, setStartProgress] = useState(session?.startPage ?? Math.floor((session?.startTimestampSec ?? 0) / 60));
  const [endProgress, setEndProgress] = useState(session?.endPage ?? Math.floor((session?.endTimestampSec ?? 0) / 60));
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [mood, setMood] = useState(session?.mood ?? 'Cozy');
  const [location, setLocation] = useState(session?.location ?? 'Home');
  const [error, setError] = useState('');

  const selectedBook = useMemo(() => books.find((book) => book.id === bookId), [bookId, books]);
  const edition = selectedBook?.editions.find((item) => item.id === selectedBook.activeEditionId) ?? selectedBook?.editions[0];
  const isAudiobook = edition?.format === 'audiobook';

  const save = () => {
    if (!selectedBook) {
      setError('Choose a book for this session.');
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
          </div>
          <button type="button" onClick={onClose} className="quiet-shelf-secondary-action p-2" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2 text-xs font-bold text-[var(--ink-text-primary)]">Book
            <select value={bookId} onChange={(event) => setBookId(event.target.value)} className="inkbound-select mt-1 w-full">
              {books.map((book) => <option key={book.id} value={book.id}>{book.work.title} — {book.work.author}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Duration (minutes)<input type="number" min={1} value={durationMinutes} onChange={(event) => setDurationMinutes(Math.max(0, Number(event.target.value) || 0))} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Start time<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">End time<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">{isAudiobook ? 'Starting minute' : 'Starting page'}<input type="number" min={0} value={startProgress} onChange={(event) => setStartProgress(Math.max(0, Number(event.target.value) || 0))} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">{isAudiobook ? 'Ending minute' : 'Ending page'}<input type="number" min={0} value={endProgress} onChange={(event) => setEndProgress(Math.max(0, Number(event.target.value) || 0))} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Mood<input value={mood} onChange={(event) => setMood(event.target.value)} className="inkbound-select mt-1 w-full" /></label>
          <label className="text-xs font-bold text-[var(--ink-text-primary)]">Location<input value={location} onChange={(event) => setLocation(event.target.value)} className="inkbound-select mt-1 w-full" /></label>
          <label className="sm:col-span-2 text-xs font-bold text-[var(--ink-text-primary)]">Notes<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} className="inkbound-select mt-1 w-full resize-y" /></label>
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
