import React, { useEffect, useState } from 'react';
import { ReadingSession, UserBookRecord } from '../types';
import { CheckCircle2, Clock, Pause, Play, Square, X } from 'lucide-react';

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

export const ReadingSessionModal: React.FC<ReadingSessionModalProps> = ({
  books,
  initialBookId,
  onClose,
  onSaveSession,
}) => {
  const readingBooks = books.filter(
    (book) => book.status === 'currently-reading' || book.status === 'tbr',
  );
  const selectableBooks = readingBooks.length > 0 ? readingBooks : books;
  const [selectedBookId, setSelectedBookId] = useState<string>(
    initialBookId || selectableBooks[0]?.id || '',
  );

  const selectedBook = books.find((book) => book.id === selectedBookId) || books[0];
  const activeEdition =
    selectedBook?.editions.find((edition) => edition.id === selectedBook.activeEditionId) ||
    selectedBook?.editions[0];
  const isAudiobook = activeEdition?.format === 'audiobook';

  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  const [startPage, setStartPage] = useState(selectedBook?.progressPages || 0);
  const [endPage, setEndPage] = useState((selectedBook?.progressPages || 0) + 20);
  const [startMins, setStartMins] = useState(selectedBook?.progressMinutes || 0);
  const [endMins, setEndMins] = useState((selectedBook?.progressMinutes || 0) + 30);
  const [listeningSpeed] = useState(1.2);
  const [notes, setNotes] = useState('');
  const [mood, setMood] = useState('Atmospheric');
  const [location, setLocation] = useState('Cozy Armchair');

  useEffect(() => {
    if (!isActive) return undefined;

    const interval = window.setInterval(() => {
      setTimerSeconds((previous) => previous + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isActive]);

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
        .toString()
        .padStart(2, '0')}`;
    }

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleBookChange = (bookId: string) => {
    setSelectedBookId(bookId);
    const book = books.find((item) => item.id === bookId);
    if (!book) return;

    setStartPage(book.progressPages);
    setEndPage(book.progressPages + 20);
    setStartMins(book.progressMinutes);
    setEndMins(book.progressMinutes + 30);
  };

  const handleFinishSession = () => {
    setIsActive(false);
    setIsFinished(true);
  };

  const handleSaveAndClose = () => {
    if (!selectedBook) return;

    const sessionDurationMins = Math.max(1, Math.round(timerSeconds / 60));
    const pagesCompleted = Math.max(0, endPage - startPage);
    const minsCompleted = Math.max(0, endMins - startMins);

    const session: ReadingSession = {
      id: `sess-${Date.now()}`,
      bookId: selectedBook.id,
      date: new Date().toISOString().split('T')[0],
      startTime: new Date(Date.now() - sessionDurationMins * 60000)
        .toTimeString()
        .substring(0, 5),
      endTime: new Date().toTimeString().substring(0, 5),
      durationMinutes: sessionDurationMins,
      startPage: !isAudiobook ? startPage : undefined,
      endPage: !isAudiobook ? endPage : undefined,
      pagesRead: !isAudiobook ? pagesCompleted : undefined,
      startTimestampSec: isAudiobook ? startMins * 60 : undefined,
      endTimestampSec: isAudiobook ? endMins * 60 : undefined,
      minutesListened: isAudiobook ? minsCompleted : undefined,
      listeningSpeed: isAudiobook ? listeningSpeed : undefined,
      notes: notes.trim() || undefined,
      mood,
      location,
    };

    onSaveSession(
      session,
      !isAudiobook ? endPage : startPage,
      isAudiobook ? endMins : startMins,
    );
    onClose();
  };

  if (!selectedBook) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section
        className="relative flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reading-session-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full bg-black/30 p-2 text-stone-400 transition hover:bg-black/50 hover:text-white"
          aria-label="Close reading session"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-6 sm:p-6">
          <div className="space-y-5">
            <header className="space-y-1 pr-10 text-center">
              <Clock className="mx-auto h-8 w-8 animate-pulse text-[#e5c158]" />
              <h3 id="reading-session-title" className="font-serif text-2xl font-bold text-[#f4efe6]">
                Reading Session Companion
              </h3>
              <p className="text-xs text-stone-300">
                Track your reading focus and immersion metrics
              </p>
            </header>

            {!isFinished && (
              <div>
                <label className="mb-1 block text-xs font-bold text-[#f4efe6]">Select Book</label>
                <select
                  value={selectedBookId}
                  onChange={(event) => handleBookChange(event.target.value)}
                  className="w-full rounded-xl border border-[#3d2448] bg-[#120817] p-3 text-sm font-medium text-[#f4efe6] focus:border-[#c5a059] focus:outline-none"
                >
                  {selectableBooks.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.work.title} ({book.work.author})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!isFinished ? (
              <div className="space-y-4 rounded-2xl border border-[#c5a059]/30 bg-[#25132f] p-5 text-center text-[#f4efe6] shadow-inner sm:p-6">
                <div className="font-mono font-serif text-4xl font-bold tracking-[0.12em] text-[#e5c158] sm:text-5xl">
                  {formatTime(timerSeconds)}
                </div>
                <p className="text-xs text-stone-300">
                  {isActive ? 'Session in progress...' : timerSeconds > 0 ? 'Paused' : 'Ready to start'}
                </p>

                <div className="grid gap-3 pt-2 sm:flex sm:items-center sm:justify-center sm:gap-4">
                  {!isActive ? (
                    <button
                      type="button"
                      onClick={() => setIsActive(true)}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-6 text-xs font-bold text-[#120817] shadow-md transition hover:opacity-95"
                    >
                      <Play className="h-4 w-4 fill-current" />
                      <span>{timerSeconds === 0 ? 'Start Timer' : 'Resume'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsActive(false)}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-amber-600 px-6 text-xs font-bold text-white shadow-md transition hover:bg-amber-700"
                    >
                      <Pause className="h-4 w-4 fill-current" />
                      <span>Pause</span>
                    </button>
                  )}

                  {timerSeconds > 0 && (
                    <button
                      type="button"
                      onClick={handleFinishSession}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-emerald-700 px-6 text-xs font-bold text-white shadow-md transition hover:bg-emerald-800"
                    >
                      <Square className="h-4 w-4 fill-current" />
                      <span>Complete Session</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-4 text-emerald-300">
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" />
                  <div>
                    <p className="text-sm font-bold">Session Completed!</p>
                    <p className="text-xs text-stone-300">
                      Duration: {Math.max(1, Math.round(timerSeconds / 60))} minutes read.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-[#f4efe6]">
                      {isAudiobook ? 'Start Mins Listened' : 'Starting Page'}
                    </label>
                    <input
                      type="number"
                      value={isAudiobook ? startMins : startPage}
                      onChange={(event) =>
                        isAudiobook
                          ? setStartMins(Number.parseInt(event.target.value, 10) || 0)
                          : setStartPage(Number.parseInt(event.target.value, 10) || 0)
                      }
                      className="w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6] focus:border-[#c5a059] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-[#f4efe6]">
                      {isAudiobook ? 'End Mins Listened' : 'Ending Page'}
                    </label>
                    <input
                      type="number"
                      value={isAudiobook ? endMins : endPage}
                      onChange={(event) =>
                        isAudiobook
                          ? setEndMins(Number.parseInt(event.target.value, 10) || 0)
                          : setEndPage(Number.parseInt(event.target.value, 10) || 0)
                      }
                      className="w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6] focus:border-[#c5a059] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-[#f4efe6]">Reading Mood</label>
                    <select
                      value={mood}
                      onChange={(event) => setMood(event.target.value)}
                      className="w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6]"
                    >
                      <option value="Atmospheric">Atmospheric</option>
                      <option value="Cozy">Cozy</option>
                      <option value="Fast-paced">Fast-paced</option>
                      <option value="Mind-bending">Mind-bending</option>
                      <option value="Relaxing">Relaxing</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-[#f4efe6]">Location</label>
                    <select
                      value={location}
                      onChange={(event) => setLocation(event.target.value)}
                      className="w-full rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6]"
                    >
                      <option value="Cozy Armchair">Cozy Armchair</option>
                      <option value="Bed">Bed</option>
                      <option value="Coffee Shop">Coffee Shop</option>
                      <option value="Library">Library</option>
                      <option value="Airport">Airport</option>
                      <option value="Commute">Commute</option>
                      <option value="Study">Study</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-[#f4efe6]">
                    Session Notes & Reflections
                  </label>
                  <textarea
                    rows={3}
                    placeholder="What happened in this session?"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="w-full resize-y rounded-lg border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6] focus:border-[#c5a059] focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSaveAndClose}
                  className="min-h-12 w-full rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] py-3 text-xs font-bold text-[#120817] shadow-md transition hover:opacity-95"
                >
                  Log & Save Session
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
