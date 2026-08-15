import React, { useMemo } from 'react';
import { BookHeart, CalendarDays, Clock3, MapPin, MessageSquareQuote, Save, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { getSessionDurationMinutes, getSessionPagesRead } from '../features/reading/sessionAnalytics';
import { getActiveEdition } from '../features/reading/bookReadingState';

interface ReadingMemoryEntry {
  feeling: string;
  lifeMoment: string;
  futureSelfLetter: string;
  favoriteMoment: string;
  updatedAt: string;
}

interface ReadingMemoriesScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
}

const MEMORIES_STORAGE_KEY = 'inkbound_book_memories';
const SELECTED_BOOK_STORAGE_KEY = 'inkbound_memory_selected_book';

const emptyMemory = (): ReadingMemoryEntry => ({
  feeling: '',
  lifeMoment: '',
  futureSelfLetter: '',
  favoriteMoment: '',
  updatedAt: '',
});

const formatMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours > 0 ? `${hours}h ${remaining}m` : `${remaining}m`;
};

export const ReadingMemoriesScreen: React.FC<ReadingMemoriesScreenProps> = ({
  books,
  sessions,
  onSelectBook,
}) => {
  const eligibleBooks = books.filter(
    (book) => book.status === 'finished' || book.status === 'currently-reading',
  );
  const [selectedBookId, setSelectedBookId] = usePersistentState<string>(
    SELECTED_BOOK_STORAGE_KEY,
    eligibleBooks[0]?.id ?? books[0]?.id ?? '',
  );
  const [memories, setMemories] = usePersistentState<Record<string, ReadingMemoryEntry>>(
    MEMORIES_STORAGE_KEY,
    {},
  );

  const selectedBook = books.find((book) => book.id === selectedBookId) ?? eligibleBooks[0] ?? books[0];
  const memory = selectedBook ? memories[selectedBook.id] ?? emptyMemory() : emptyMemory();
  const bookSessions = selectedBook
    ? sessions.filter((session) => session.bookId === selectedBook.id && getSessionDurationMinutes(session) > 0)
    : [];

  const stats = useMemo(() => {
    const totalMinutes = bookSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const pagesRead = bookSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const averageMinutes = bookSessions.length > 0 ? Math.round(totalMinutes / bookSessions.length) : 0;
    const topLocation = Object.entries(
      bookSessions.reduce<Record<string, number>>((counts, session) => {
        const location = session.location?.trim();
        if (location) counts[location] = (counts[location] ?? 0) + 1;
        return counts;
      }, {}),
    ).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topMood = Object.entries(
      bookSessions.reduce<Record<string, number>>((counts, session) => {
        const mood = session.mood?.trim();
        if (mood) counts[mood] = (counts[mood] ?? 0) + 1;
        return counts;
      }, {}),
    ).sort((a, b) => b[1] - a[1])[0]?.[0];
    return { totalMinutes, pagesRead, averageMinutes, topLocation, topMood };
  }, [bookSessions]);

  const updateMemory = (field: keyof ReadingMemoryEntry, value: string) => {
    if (!selectedBook) return;
    setMemories((current) => ({
      ...current,
      [selectedBook.id]: {
        ...(current[selectedBook.id] ?? emptyMemory()),
        [field]: value,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  if (!selectedBook) {
    return (
      <div className="rounded-3xl border border-dashed border-[var(--ink-border)] p-10 text-center">
        <BookHeart className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
        <h1 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">Your memories will begin here</h1>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">Add a book or complete a reading session first.</p>
      </div>
    );
  }

  const activeEdition = getActiveEdition(selectedBook);

  return (
    <div className="space-y-7 pb-24">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inkbound-kicker">Your Reading Life</p>
          <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Reading Memories</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
            Return to the story, the season of life around it, and the thoughts you want your future self to remember.
          </p>
        </div>
        <select
          value={selectedBook.id}
          onChange={(event) => setSelectedBookId(event.target.value)}
          className="min-h-12 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-4 text-sm text-[var(--ink-ivory)]"
        >
          {eligibleBooks.map((book) => (
            <option key={book.id} value={book.id}>{book.work.title}</option>
          ))}
        </select>
      </header>

      <section className="inkbound-panel overflow-hidden rounded-3xl">
        <div className={`bg-gradient-to-br ${activeEdition?.coverGradient ?? 'from-[#76586a] to-[#382b40]'} p-6 sm:p-8`}>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-white/70">
            {selectedBook.status === 'finished' ? 'Finished Memory' : 'Reading in Progress'}
          </p>
          <h2 className="mt-3 max-w-3xl font-serif text-3xl font-bold text-white sm:text-4xl">
            {selectedBook.work.title}
          </h2>
          <p className="mt-2 text-sm text-white/75">{selectedBook.work.author}</p>
          <button type="button" onClick={() => onSelectBook(selectedBook)} className="mt-5 rounded-full border border-white/30 px-4 py-2 text-sm font-semibold text-white">
            Open book details
          </button>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7 lg:grid-cols-4">
          <div className="rounded-2xl bg-[var(--ink-surface-soft)] p-4">
            <Clock3 className="h-4 w-4 text-[var(--ink-gold)]" />
            <strong className="mt-3 block text-xl text-[var(--ink-ivory)]">{formatMinutes(stats.totalMinutes)}</strong>
            <span className="text-xs text-[var(--ink-muted)]">Total reading time</span>
          </div>
          <div className="rounded-2xl bg-[var(--ink-surface-soft)] p-4">
            <CalendarDays className="h-4 w-4 text-[var(--ink-gold)]" />
            <strong className="mt-3 block text-xl text-[var(--ink-ivory)]">{bookSessions.length}</strong>
            <span className="text-xs text-[var(--ink-muted)]">Reading sessions</span>
          </div>
          <div className="rounded-2xl bg-[var(--ink-surface-soft)] p-4">
            <Sparkles className="h-4 w-4 text-[var(--ink-gold)]" />
            <strong className="mt-3 block text-xl text-[var(--ink-ivory)]">{stats.pagesRead}</strong>
            <span className="text-xs text-[var(--ink-muted)]">Pages recorded in sessions</span>
          </div>
          <div className="rounded-2xl bg-[var(--ink-surface-soft)] p-4">
            <MapPin className="h-4 w-4 text-[var(--ink-gold)]" />
            <strong className="mt-3 block truncate text-xl text-[var(--ink-ivory)]">{stats.topLocation ?? 'Not recorded'}</strong>
            <span className="text-xs text-[var(--ink-muted)]">Most common place</span>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <p className="inkbound-kicker">The Memory</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">How did this book make you feel?</h2>
          <textarea
            rows={5}
            value={memory.feeling}
            onChange={(event) => updateMemory('feeling', event.target.value)}
            placeholder="Not a review—just the feeling you want to remember."
            className="mt-4 w-full rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-ivory)]"
          />
        </section>

        <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <p className="inkbound-kicker">Life Around the Book</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">What was happening in your life?</h2>
          <textarea
            rows={5}
            value={memory.lifeMoment}
            onChange={(event) => updateMemory('lifeMoment', event.target.value)}
            placeholder="A vacation, a new home, a difficult season, or an ordinary evening worth remembering."
            className="mt-4 w-full rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-ivory)]"
          />
        </section>

        <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <p className="inkbound-kicker">Favorite Moment</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">What stayed with you?</h2>
          <textarea
            rows={5}
            value={memory.favoriteMoment}
            onChange={(event) => updateMemory('favoriteMoment', event.target.value)}
            placeholder="A character, scene, idea, or moment you still think about."
            className="mt-4 w-full rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-ivory)]"
          />
        </section>

        <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <p className="inkbound-kicker">Time Capsule</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">A letter to your future self</h2>
          <textarea
            rows={5}
            value={memory.futureSelfLetter}
            onChange={(event) => updateMemory('futureSelfLetter', event.target.value)}
            placeholder="What do you hope you never forget about reading this book?"
            className="mt-4 w-full rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-ivory)]"
          />
        </section>
      </div>

      <section className="grid gap-6 lg:grid-cols-3">
        <article className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <MessageSquareQuote className="h-5 w-5 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-xl font-bold text-[var(--ink-ivory)]">Favorite Quote</h2>
          <p className="mt-3 text-sm italic text-[var(--ink-muted)]">
            {selectedBook.favoriteQuotes?.[0]?.quote ?? 'No quote has been saved for this book yet.'}
          </p>
        </article>
        <article className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <Sparkles className="h-5 w-5 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-xl font-bold text-[var(--ink-ivory)]">Your Reading Pattern</h2>
          <p className="mt-3 text-sm text-[var(--ink-muted)]">
            Average session: {formatMinutes(stats.averageMinutes)}. Most common mood: {stats.topMood ?? 'not recorded'}.
          </p>
        </article>
        <article className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <Save className="h-5 w-5 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-xl font-bold text-[var(--ink-ivory)]">Saved Automatically</h2>
          <p className="mt-3 text-sm text-[var(--ink-muted)]">
            Your entries save as you type and are ready for Google Sync.
          </p>
          {memory.updatedAt && <p className="mt-3 text-xs text-[var(--ink-muted)]">Last updated {new Date(memory.updatedAt).toLocaleString()}</p>}
        </article>
      </section>
    </div>
  );
};
