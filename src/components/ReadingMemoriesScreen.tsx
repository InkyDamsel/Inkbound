import React, { useMemo } from 'react';
import { BookHeart, CalendarDays, Clock3, Headphones, MapPin, MessageSquareQuote, Save, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { getSessionDurationMinutes, getSessionListeningMinutes, getSessionPagesRead } from '../features/reading/sessionAnalytics';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { ACCOUNT_DATA_STORAGE_KEYS } from '../features/sync/storageKeys';
import { BookPicker } from './BookPicker';

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

const MEMORIES_STORAGE_KEY = ACCOUNT_DATA_STORAGE_KEYS.readingMemories;
const SELECTED_MEMORY_VIEW_KEY = 'inkbound_memory_selected_book';
const MEMORIES_BANNER_URL = '/assets/memories/cozy-memories-banner.png';

const emptyMemory = (): ReadingMemoryEntry => ({
  feeling: '',
  lifeMoment: '',
  futureSelfLetter: '',
  favoriteMoment: '',
  updatedAt: '',
});

const formatMinutes = (minutes: number) => {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
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
    SELECTED_MEMORY_VIEW_KEY,
    eligibleBooks[0]?.id ?? '',
  );
  const [memories, setMemories] = usePersistentState<Record<string, ReadingMemoryEntry>>(
    MEMORIES_STORAGE_KEY,
    {},
  );

  const selectedBook = eligibleBooks.find((book) => book.id === selectedBookId) ?? eligibleBooks[0];
  const memory = selectedBook ? memories[selectedBook.id] ?? emptyMemory() : emptyMemory();
  const activeEdition = selectedBook ? getActiveEdition(selectedBook) : undefined;
  const isAudiobook = activeEdition?.format === 'audiobook';
  const bookSessions = selectedBook
    ? sessions.filter((session) => session.bookId === selectedBook.id && getSessionDurationMinutes(session) > 0)
    : [];

  const stats = useMemo(() => {
    const totalMinutes = bookSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const pagesRead = bookSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const listeningMinutes = bookSessions.reduce((sum, session) => sum + getSessionListeningMinutes(session), 0);
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
    return { totalMinutes, pagesRead, listeningMinutes, averageMinutes, topLocation, topMood };
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
        <p className="mt-2 text-sm text-[var(--ink-muted)]">Start reading or finish a book and it will become available for reflection here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-7 pb-24">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="inkbound-kicker">Your Reading Life</p>
          <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Reading Memories</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
            Return to the story, the season of life around it, and the thoughts you want your future self to remember.
          </p>
        </div>
        <BookPicker books={eligibleBooks} value={selectedBook.id} onChange={setSelectedBookId} label="Reading memory book" className="w-full sm:max-w-sm" />
      </header>

      <section className="inkbound-artwork-hero inkbound-panel overflow-hidden rounded-3xl">
        <div
          className="relative flex min-h-[210px] items-center overflow-hidden p-6 sm:min-h-[250px] sm:p-8"
          style={{
            backgroundImage: `linear-gradient(90deg, rgba(12,8,15,.84) 0%, rgba(12,8,15,.56) 40%, rgba(12,8,15,.18) 72%, rgba(12,8,15,.08) 100%), url("${MEMORIES_BANNER_URL}")`,
            backgroundPosition: 'center center',
            backgroundSize: 'cover',
            backgroundRepeat: 'no-repeat',
          }}
        >
          <div className="relative z-10 max-w-2xl rounded-2xl border border-white/10 bg-black/20 p-5 backdrop-blur-[2px] sm:p-6" style={{ textShadow: '0 2px 10px rgba(0,0,0,.72)' }}>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-white/75">
              {selectedBook.status === 'finished' ? 'Finished Memory' : 'Reading in Progress'}
            </p>
            <h2 className="mt-3 max-w-3xl break-words font-serif text-3xl font-bold text-white sm:text-4xl">
              {selectedBook.work.title}
            </h2>
            <p className="mt-2 break-words text-sm text-white/80">{selectedBook.work.author}</p>
            <button type="button" onClick={() => onSelectBook(selectedBook)} className="mt-5 min-h-11 rounded-full border border-white/30 bg-black/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur-[2px]">
              Open book details
            </button>
          </div>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7 lg:grid-cols-4">
          <div className="rounded-2xl bg-[var(--ink-surface-soft)] p-4">
            <Clock3 className="h-4 w-4 text-[var(--ink-gold)]" />
            <strong className="mt-3 block break-words text-xl text-[var(--ink-ivory)]">{formatMinutes(stats.totalMinutes)}</strong>
            <span className="text-xs text-[var(--ink-muted)]">Total reading time</span>
          </div>
          <div className="rounded-2xl bg-[var(--ink-surface-soft)] p-4">
            <CalendarDays className="h-4 w-4 text-[var(--ink-gold)]" />
            <strong className="mt-3 block text-xl text-[var(--ink-ivory)]">{bookSessions.length}</strong>
            <span className="text-xs text-[var(--ink-muted)]">Reading sessions</span>
          </div>
          <div className="rounded-2xl bg-[var(--ink-surface-soft)] p-4">
            {isAudiobook ? <Headphones className="h-4 w-4 text-[var(--ink-gold)]" /> : <Sparkles className="h-4 w-4 text-[var(--ink-gold)]" />}
            <strong className="mt-3 block break-words text-xl text-[var(--ink-ivory)]">{isAudiobook ? formatMinutes(stats.listeningMinutes) : stats.pagesRead.toLocaleString()}</strong>
            <span className="text-xs text-[var(--ink-muted)]">{isAudiobook ? 'Listening progress recorded' : 'Pages recorded in sessions'}</span>
          </div>
          <div className="min-w-0 rounded-2xl bg-[var(--ink-surface-soft)] p-4">
            <MapPin className="h-4 w-4 text-[var(--ink-gold)]" />
            <strong className="mt-3 block break-words text-xl text-[var(--ink-ivory)]">{stats.topLocation ?? 'Not recorded'}</strong>
            <span className="text-xs text-[var(--ink-muted)]">Most common place</span>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <p className="inkbound-kicker">The Memory</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">How did this book make you feel?</h2>
          <textarea rows={5} value={memory.feeling} onChange={(event) => updateMemory('feeling', event.target.value)} placeholder="Not a review—just the feeling you want to remember." className="mt-4 w-full rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-ivory)]" />
        </section>

        <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <p className="inkbound-kicker">Life Around the Book</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">What was happening in your life?</h2>
          <textarea rows={5} value={memory.lifeMoment} onChange={(event) => updateMemory('lifeMoment', event.target.value)} placeholder="A vacation, a new home, a difficult season, or an ordinary evening worth remembering." className="mt-4 w-full rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-ivory)]" />
        </section>

        <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <p className="inkbound-kicker">Favorite Moment</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">What stayed with you?</h2>
          <textarea rows={5} value={memory.favoriteMoment} onChange={(event) => updateMemory('favoriteMoment', event.target.value)} placeholder="A character, scene, idea, or moment you still think about." className="mt-4 w-full rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-ivory)]" />
        </section>

        <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <p className="inkbound-kicker">Time Capsule</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">A letter to your future self</h2>
          <textarea rows={5} value={memory.futureSelfLetter} onChange={(event) => updateMemory('futureSelfLetter', event.target.value)} placeholder="What do you hope you never forget about reading this book?" className="mt-4 w-full rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-ivory)]" />
        </section>
      </div>

      <section className="grid gap-6 lg:grid-cols-3">
        <article className="inkbound-panel min-w-0 rounded-3xl p-5 sm:p-7">
          <MessageSquareQuote className="h-5 w-5 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-xl font-bold text-[var(--ink-ivory)]">Favorite Quote</h2>
          <p className="mt-3 break-words text-sm italic text-[var(--ink-muted)]">{selectedBook.favoriteQuotes?.[0]?.quote ?? 'No quote has been saved for this book yet.'}</p>
        </article>
        <article className="inkbound-panel min-w-0 rounded-3xl p-5 sm:p-7">
          <Sparkles className="h-5 w-5 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-xl font-bold text-[var(--ink-ivory)]">Your Reading Pattern</h2>
          <p className="mt-3 break-words text-sm text-[var(--ink-muted)]">Average session: {formatMinutes(stats.averageMinutes)}. Most common mood: {stats.topMood ?? 'not recorded'}.</p>
        </article>
        <article className="inkbound-panel min-w-0 rounded-3xl p-5 sm:p-7">
          <Save className="h-5 w-5 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-xl font-bold text-[var(--ink-ivory)]">Saved Automatically</h2>
          <p className="mt-3 text-sm text-[var(--ink-muted)]">Your entries save as you type and follow your Inkbound account sync.</p>
          {memory.updatedAt && <p className="mt-3 break-words text-xs text-[var(--ink-muted)]">Last updated {new Date(memory.updatedAt).toLocaleString()}</p>}
        </article>
      </section>
    </div>
  );
};
