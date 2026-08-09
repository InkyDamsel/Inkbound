import React, { useEffect, useState } from 'react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { CheckCircle2, Clock, Pause, Play, Square, Trash2, X } from 'lucide-react';

interface ReadingSessionModalProps {
  books: UserBookRecord[];
  initialBookId?: string;
  onClose: () => void;
  onSaveSession: (
    session: ReadingSession,
    updatedProgressPages: number,
    updatedProgressMins: number,
  ) => void;
}

interface SessionDraft {
  selectedBookId: string;
  timerSeconds: number;
  isActive: boolean;
  isFinished: boolean;
  lastActiveAt?: number;
  startedAt?: number;
  endedAt?: number;
  startPage: number;
  endPage: number;
  startMins: number;
  endMins: number;
  notes: string;
  mood: string;
  location: string;
}

const SESSION_DRAFT_KEY = 'inkbound_active_session_draft';

export const ReadingSessionModal: React.FC<ReadingSessionModalProps> = ({
  books,
  initialBookId,
  onClose,
  onSaveSession,
}) => {
  const readingBooks = books.filter((book) => book.status === 'currently-reading' || book.status === 'tbr');
  const selectableBooks = readingBooks.length > 0 ? readingBooks : books;
  const initialBook = books.find((book) => book.id === initialBookId) ?? selectableBooks[0] ?? books[0];
  const [error, setError] = useState('');

  const [draft, setDraft] = usePersistentState<SessionDraft>(SESSION_DRAFT_KEY, () => ({
    selectedBookId: initialBook?.id ?? '',
    timerSeconds: 0,
    isActive: false,
    isFinished: false,
    startPage: initialBook?.progressPages ?? 0,
    endPage: (initialBook?.progressPages ?? 0) + 20,
    startMins: initialBook?.progressMinutes ?? 0,
    endMins: (initialBook?.progressMinutes ?? 0) + 30,
    notes: '',
    mood: 'Atmospheric',
    location: 'Cozy Armchair',
  }));

  const selectedBook = books.find((book) => book.id === draft.selectedBookId) || initialBook;
  const activeEdition = selectedBook?.editions.find((edition) => edition.id === selectedBook.activeEditionId) || selectedBook?.editions[0];
  const isAudiobook = activeEdition?.format === 'audiobook';
  const listeningSpeed = 1.2;

  useEffect(() => {
    if (!initialBookId || draft.timerSeconds > 0 || draft.isFinished) return;
    const book = books.find((item) => item.id === initialBookId);
    if (!book || book.id === draft.selectedBookId) return;
    setDraft((current) => ({
      ...current,
      selectedBookId: book.id,
      startPage: book.progressPages,
      endPage: book.progressPages + 20,
      startMins: book.progressMinutes,
      endMins: book.progressMinutes + 30,
    }));
  }, [books, draft.isFinished, draft.selectedBookId, draft.timerSeconds, initialBookId, setDraft]);

  useEffect(() => {
    if (!draft.isActive) return undefined;
    const now = Date.now();
    if (draft.lastActiveAt && now > draft.lastActiveAt) {
      const recoveredSeconds = Math.floor((now - draft.lastActiveAt) / 1000);
      if (recoveredSeconds > 0) {
        setDraft((current) => ({ ...current, timerSeconds: current.timerSeconds + recoveredSeconds, lastActiveAt: now }));
      }
    }
    const interval = window.setInterval(() => {
      setDraft((current) => ({ ...current, timerSeconds: current.timerSeconds + 1, lastActiveAt: Date.now() }));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [draft.isActive, setDraft]);

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleBookChange = (bookId: string) => {
    if (draft.timerSeconds > 0 || draft.isActive) {
      setError('Finish or discard the current session before switching books.');
      return;
    }
    const book = books.find((item) => item.id === bookId);
    if (!book) return;
    setError('');
    setDraft((current) => ({
      ...current,
      selectedBookId: bookId,
      startPage: book.progressPages,
      endPage: book.progressPages + 20,
      startMins: book.progressMinutes,
      endMins: book.progressMinutes + 30,
    }));
  };

  const startOrResume = () => {
    const now = Date.now();
    setError('');
    setDraft((current) => ({
      ...current,
      isActive: true,
      startedAt: current.startedAt ?? now,
      lastActiveAt: now,
    }));
  };

  const pause = () => setDraft((current) => ({ ...current, isActive: false, lastActiveAt: undefined }));

  const handleFinishSession = () => {
    setDraft((current) => ({
      ...current,
      isActive: false,
      isFinished: true,
      lastActiveAt: undefined,
      endedAt: Date.now(),
    }));
  };

  const clearDraft = () => window.localStorage.removeItem(SESSION_DRAFT_KEY);

  const discardSession = () => {
    if (!window.confirm('Discard this reading session? The timer and unsaved notes will be removed.')) return;
    clearDraft();
    onClose();
  };

  const handleSaveAndClose = () => {
    if (!selectedBook) return;
    if (!isAudiobook && draft.endPage < draft.startPage) {
      setError('Ending page cannot be before starting page.');
      return;
    }
    if (isAudiobook && draft.endMins < draft.startMins) {
      setError('Ending minutes cannot be before starting minutes.');
      return;
    }

    const endedAt = draft.endedAt ?? Date.now();
    const startedAt = draft.startedAt ?? Math.max(0, endedAt - draft.timerSeconds * 1000);
    const sessionDurationMins = Math.max(1, Math.round(draft.timerSeconds / 60));
    const pagesCompleted = Math.max(0, draft.endPage - draft.startPage);
    const minsCompleted = Math.max(0, draft.endMins - draft.startMins);

    const session: ReadingSession = {
      id: `sess-${Date.now()}`,
      bookId: selectedBook.id,
      date: new Date(startedAt).toISOString().split('T')[0],
      startTime: new Date(startedAt).toTimeString().substring(0, 5),
      endTime: new Date(endedAt).toTimeString().substring(0, 5),
      durationMinutes: sessionDurationMins,
      startPage: !isAudiobook ? draft.startPage : undefined,
      endPage: !isAudiobook ? draft.endPage : undefined,
      pagesRead: !isAudiobook ? pagesCompleted : undefined,
      startTimestampSec: isAudiobook ? draft.startMins * 60 : undefined,
      endTimestampSec: isAudiobook ? draft.endMins * 60 : undefined,
      minutesListened: isAudiobook ? minsCompleted : undefined,
      listeningSpeed: isAudiobook ? listeningSpeed : undefined,
      notes: draft.notes.trim() || undefined,
      mood: draft.mood,
      location: draft.location,
    };

    clearDraft();
    onSaveSession(session, !isAudiobook ? draft.endPage : draft.startPage, isAudiobook ? draft.endMins : draft.startMins);
    onClose();
  };

  if (!selectedBook) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section className="relative flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="reading-session-title">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 z-10 rounded-full bg-black/30 p-2 text-stone-400 transition hover:bg-black/50 hover:text-white" aria-label="Close reading session without discarding it" title="Close — your session will remain saved"><X className="h-5 w-5" /></button>

        <div className="overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-6 sm:p-6">
          <div className="space-y-5">
            <header className="space-y-1 pr-10 text-center">
              <Clock className="mx-auto h-8 w-8 animate-pulse text-[#e5c158]" />
              <h3 id="reading-session-title" className="font-serif text-2xl font-bold text-[#f4efe6]">Reading Session Companion</h3>
              <p className="text-xs text-stone-300">Your active session saves automatically. Closing this window does not discard it.</p>
            </header>

            {!draft.isFinished && (
              <div>
                <label className="mb-1 block text-xs font-bold text-[#f4efe6]">Select Book</label>
                <select value={draft.selectedBookId} onChange={(event) => handleBookChange(event.target.value)} disabled={draft.timerSeconds > 0 || draft.isActive} className="w-full rounded-xl border border-[#3d2448] bg-[#120817] p-3 text-sm font-medium text-[#f4efe6] focus:border-[#c5a059] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60">
                  {selectableBooks.map((book) => <option key={book.id} value={book.id}>{book.work.title} ({book.work.author})</option>)}
                </select>
              </div>
            )}

            {error && <p className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-sm text-rose-200">{error}</p>}

            {!draft.isFinished ? (
              <div className="space-y-4 rounded-2xl border border-[#c5a059]/30 bg-[#25132f] p-5 text-center text-[#f4efe6] shadow-inner sm:p-6">
                <div className="font-mono font-serif text-4xl font-bold tracking-[0.12em] text-[#e5c158] sm:text-5xl">{formatTime(draft.timerSeconds)}</div>
                <p className="text-xs text-stone-300">{draft.isActive ? 'Session in progress...' : draft.timerSeconds > 0 ? 'Paused' : 'Ready to start'}</p>
                <div className="grid gap-3 pt-2 sm:flex sm:items-center sm:justify-center sm:gap-4">
                  {!draft.isActive ? (
                    <button type="button" onClick={startOrResume} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-6 text-xs font-bold text-[#120817] shadow-md transition hover:opacity-95"><Play className="h-4 w-4 fill-current" /><span>{draft.timerSeconds === 0 ? 'Start Timer' : 'Resume'}</span></button>
                  ) : (
                    <button type="button" onClick={pause} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-amber-600 px-6 text-xs font-bold text-white shadow-md transition hover:bg-amber-700"><Pause className="h-4 w-4 fill-current" /><span>Pause</span></button>
                  )}
                  {draft.timerSeconds > 0 && <button type="button" onClick={handleFinishSession} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-emerald-700 px-6 text-xs font-bold text-white shadow-md transition hover:bg-emerald-800"><Square className="h-4 w-4 fill-current" /><span>Complete Session</span></button>}
                </div>
                {(draft.timerSeconds > 0 || draft.notes) && <button type="button" onClick={discardSession} className="mx-auto flex items-center gap-2 text-xs font-bold text-rose-300 hover:text-rose-200"><Trash2 className="h-3.5 w-3.5" /> Discard Session</button>}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-4 text-emerald-300"><CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" /><div><p className="text-sm font-bold">Session Completed!</p><p className="text-xs text-stone-300">Duration: {Math.max(1, Math.round(draft.timerSeconds / 60))} minutes.</p></div></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><label className="mb-1 block text-xs font-bold text-[#f4efe6]">{isAudiobook ? 'Start Mins Listened' : 'Starting Page'}</label><input min={0} type="number" value={isAudiobook ? draft.startMins : draft.startPage} onChange={(event) => setDraft((current) => ({ ...current, ...(isAudiobook ? { startMins: Math.max(0, Number.parseInt(event.target.value, 10) || 0) } : { startPage: Math.max(0, Number.parseInt(event.target.value, 10) || 0) }) }))} className="w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6] focus:border-[#c5a059] focus:outline-none" /></div>
                  <div><label className="mb-1 block text-xs font-bold text-[#f4efe6]">{isAudiobook ? 'End Mins Listened' : 'Ending Page'}</label><input min={0} type="number" value={isAudiobook ? draft.endMins : draft.endPage} onChange={(event) => setDraft((current) => ({ ...current, ...(isAudiobook ? { endMins: Math.max(0, Number.parseInt(event.target.value, 10) || 0) } : { endPage: Math.max(0, Number.parseInt(event.target.value, 10) || 0) }) }))} className="w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6] focus:border-[#c5a059] focus:outline-none" /></div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><label className="mb-1 block text-xs font-bold text-[#f4efe6]">Reading Mood</label><select value={draft.mood} onChange={(event) => setDraft((current) => ({ ...current, mood: event.target.value }))} className="w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6]"><option value="Atmospheric">Atmospheric</option><option value="Cozy">Cozy</option><option value="Fast-paced">Fast-paced</option><option value="Mind-bending">Mind-bending</option><option value="Relaxing">Relaxing</option></select></div>
                  <div><label className="mb-1 block text-xs font-bold text-[#f4efe6]">Location</label><select value={draft.location} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} className="w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6]"><option value="Cozy Armchair">Cozy Armchair</option><option value="Bed">Bed</option><option value="Coffee Shop">Coffee Shop</option><option value="Library">Library</option><option value="Airport">Airport</option><option value="Commute">Commute</option><option value="Study">Study</option></select></div>
                </div>
                <div><label className="mb-1 block text-xs font-bold text-[#f4efe6]">Session Notes & Reflections</label><textarea rows={3} placeholder="What happened in this session?" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} className="w-full resize-y rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6] focus:border-[#c5a059] focus:outline-none" /></div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <button type="button" onClick={handleSaveAndClose} className="min-h-12 w-full rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] py-3 text-xs font-bold text-[#120817] shadow-md transition hover:opacity-95">Log & Save Session</button>
                  <button type="button" onClick={discardSession} className="quiet-shelf-secondary-action text-rose-300"><Trash2 className="h-4 w-4" /> Discard</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
