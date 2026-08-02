import React, { useMemo, useState } from 'react';
import { BookOpen, Clock, Library, Paintbrush, Play, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../../../types';
import { resolveLivingLibraryScene } from '../behavior/livingLibraryEngine';
import { resolveMemoryShelf } from '../memories/memoryShelfResolver';
import { useLibrarySanctuary } from '../state/useLibrarySanctuary';
import { LivingLibraryRenderer } from './LivingLibraryRenderer';
import { ShelfDesignerScreen } from './ShelfDesignerScreen';

interface HearthScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
  onStartSessionForBook: (book: UserBookRecord) => void;
  onNavigateToLibrary: () => void;
}

export const HearthScreen: React.FC<HearthScreenProps> = ({
  books,
  sessions,
  onSelectBook,
  onStartSessionForBook,
  onNavigateToLibrary,
}) => {
  const [isDesigning, setIsDesigning] = useState(false);
  const {
    sanctuary,
    status,
    errorMessage,
    updateSanctuary,
    clearError,
  } = useLibrarySanctuary();

  const currentBook = books.find((book) => book.status === 'currently-reading') ?? null;
  const finishedBooks = books.filter((book) => book.status === 'finished');
  const recentSession = [...sessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )[0];

  const favoriteGenre = useMemo(() => {
    const counts = new Map<string, number>();
    finishedBooks.forEach((book) => {
      book.work.genres.forEach((genre) => {
        counts.set(genre, (counts.get(genre) ?? 0) + 1);
      });
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [finishedBooks]);

  const scene = useMemo(
    () => resolveLivingLibraryScene({
      sanctuary,
      reading: {
        favoriteGenre,
        finishedBookCount: finishedBooks.length,
        longestSessionMinutes: sessions.reduce(
          (longest, session) => Math.max(longest, session.durationMinutes),
          0,
        ),
        recentSessionMinutes: recentSession?.durationMinutes ?? null,
        hasFavoriteBook: books.some((book) => book.rating === 5),
        recentlyFinishedBook: finishedBooks.some((book) => {
          if (!book.dateFinished) return false;
          const finishedAt = new Date(`${book.dateFinished}T12:00:00`).getTime();
          return Date.now() - finishedAt <= 3 * 24 * 60 * 60 * 1000;
        }),
      },
      preferences: {
        motionMode: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'reduced'
          : 'full',
        ambientEffectsEnabled: true,
        ambientSoundEnabled: false,
      },
    }),
    [books, favoriteGenre, finishedBooks, recentSession, sanctuary, sessions],
  );

  const memoryShelf = useMemo(
    () => resolveMemoryShelf({
      books: books.map((book) => {
        const edition = book.editions.find((item) => item.id === book.activeEditionId)
          ?? book.editions[0];
        return {
          id: book.id,
          title: book.work.title,
          author: book.work.author,
          coverGradient: edition?.coverGradient,
          rating: book.rating,
          dateFinished: book.dateFinished,
          isFavorite: book.rating === 5,
          genres: book.work.genres,
        };
      }),
      sessions: sessions.map((session) => ({
        id: session.id,
        bookId: session.bookId,
        date: session.date,
        durationMinutes: session.durationMinutes,
      })),
      memories: [],
      maximumItems: 4,
    }),
    [books, sessions],
  );

  const todayKey = new Date().toISOString().slice(0, 10);
  const todaySessions = sessions.filter((session) => session.date.slice(0, 10) === todayKey);
  const todayMinutes = todaySessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const todayPages = todaySessions.reduce((sum, session) => sum + (session.pagesRead ?? 0), 0);

  if (isDesigning) {
    return (
      <ShelfDesignerScreen
        sanctuary={sanctuary}
        dragonName="Lumis"
        finishedBookCount={finishedBooks.length}
        onUpdateSanctuary={updateSanctuary}
        onClose={() => setIsDesigning(false)}
      />
    );
  }

  return (
    <section className="space-y-6 pb-24 md:pb-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inkbound-eyebrow">Welcome home</span>
          <h1 className="mt-2 font-serif text-4xl text-[var(--ink-ivory)] sm:text-5xl">
            The Hearth
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-muted)] sm:text-base">
            Your books, memories, and quiet companion are waiting exactly where you left them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsDesigning(true)}
          className="quiet-shelf-primary-action"
        >
          <Paintbrush className="h-4 w-4" />
          Design sanctuary
        </button>
      </header>

      {errorMessage && (
        <button
          type="button"
          onClick={clearError}
          className="w-full rounded-2xl border border-[var(--ink-error,#a76661)]/35 bg-[var(--ink-error,#a76661)]/10 p-4 text-left text-sm text-[var(--ink-ivory)]"
        >
          {errorMessage}
        </button>
      )}

      <div className="inkbound-panel overflow-hidden rounded-[2rem] p-3 sm:p-5">
        <LivingLibraryRenderer
          sanctuary={sanctuary}
          scene={scene}
          memoryShelf={memoryShelf}
          dragonName="Lumis"
          onSelectMemory={(item) => {
            const book = item.bookId ? books.find((candidate) => candidate.id === item.bookId) : null;
            if (book) onSelectBook(book);
          }}
        />
        {status === 'loading' && (
          <p className="mt-3 text-center text-xs text-[var(--ink-muted)]">
            Opening your sanctuary…
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
        <section className="inkbound-panel rounded-3xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BookOpen className="h-5 w-5 text-[var(--ink-mauve)]" />
              <div>
                <span className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                  Reading table
                </span>
                <h2 className="mt-1 font-serif text-2xl text-[var(--ink-ivory)]">
                  {currentBook?.work.title ?? 'Your next story is waiting'}
                </h2>
              </div>
            </div>
            {currentBook && (
              <span className="rounded-full border border-[var(--ink-border-subtle)] px-3 py-1 text-xs text-[var(--ink-muted)]">
                {currentBook.progressPercentage}%
              </span>
            )}
          </div>

          {currentBook ? (
            <>
              <p className="mt-3 text-sm text-[var(--ink-muted)]">{currentBook.work.author}</p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]">
                <span
                  className="block h-full rounded-full bg-[var(--ink-mauve)]"
                  style={{ width: `${currentBook.progressPercentage}%` }}
                />
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onStartSessionForBook(currentBook)}
                  className="quiet-shelf-primary-action"
                >
                  <Play className="h-4 w-4" />
                  Continue reading
                </button>
                <button
                  type="button"
                  onClick={() => onSelectBook(currentBook)}
                  className="quiet-shelf-secondary-action"
                >
                  View book
                </button>
              </div>
            </>
          ) : (
            <div className="mt-5">
              <p className="text-sm leading-6 text-[var(--ink-muted)]">
                Choose a book from your library and it will appear here beside the reading chair.
              </p>
              <button
                type="button"
                onClick={onNavigateToLibrary}
                className="quiet-shelf-primary-action mt-4"
              >
                <Library className="h-4 w-4" />
                Visit library
              </button>
            </div>
          )}
        </section>

        <section className="inkbound-panel rounded-3xl p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-[var(--ink-mauve)]" />
            <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Today</h2>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <HearthMetric value={`${todayMinutes}`} label="peaceful minutes" />
            <HearthMetric value={`${todayPages}`} label="pages read" />
          </div>
          <p className="mt-4 inline-flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <Sparkles className="h-4 w-4 text-[var(--ink-mauve)]" />
            {todaySessions.length > 0
              ? `${todaySessions.length} reading ${todaySessions.length === 1 ? 'moment' : 'moments'} remembered today.`
              : 'The library is ready whenever you are.'}
          </p>
        </section>
      </div>
    </section>
  );
};

const HearthMetric: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
    <strong className="block font-serif text-3xl text-[var(--ink-ivory)]">{value}</strong>
    <span className="mt-1 block text-xs text-[var(--ink-muted)]">{label}</span>
  </div>
);
