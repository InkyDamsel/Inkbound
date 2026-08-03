import React, { useMemo, useState } from 'react';
import { BookHeart, Feather, Pencil, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';

interface DragonProfile {
  id: string;
  name: string;
  hatchDay: string;
  favoriteSleepingSpot: string;
}

interface MyDragonScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

const DRAGON_KEY = 'inkbound_dragon';
const AWAKE_LUMIS_ASSET = '/assets/lumis/lumis-awake.svg';
const SLEEPING_LUMIS_ASSET = '/assets/lumis/lumis-sleeping.svg';
const PROUD_LUMIS_ASSET = '/assets/lumis/lumis-proud.svg';
const RECENT_READING_WINDOW_MS = 6 * 60 * 60 * 1000;

const DEFAULT_DRAGON: DragonProfile = {
  id: 'library-dragon',
  name: 'Lumis',
  hatchDay: new Date().toISOString().slice(0, 10),
  favoriteSleepingSpot: 'By the fireplace',
};

const getSessionTimestamp = (session: ReadingSession): number => {
  const time = session.endTime || session.startTime || '12:00';
  const timestamp = new Date(`${session.date}T${time}`).getTime();
  return Number.isNaN(timestamp) ? new Date(session.date).getTime() : timestamp;
};

const isDateToday = (value?: string): boolean => {
  if (!value) return false;
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
};

export const MyDragonScreen: React.FC<MyDragonScreenProps> = ({ books, sessions }) => {
  const [dragon, setDragon] = usePersistentState<DragonProfile>(DRAGON_KEY, DEFAULT_DRAGON);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(dragon.name);

  const finishedBooks = books.filter((book) => book.status === 'finished');
  const totalPages = finishedBooks.reduce((sum, book) => {
    const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
    return sum + (edition?.pageCount ?? book.progressPages ?? 0);
  }, 0);

  const favoriteGenre = useMemo(() => {
    const counts = new Map<string, number>();
    finishedBooks
      .flatMap((book) => book.work.genres)
      .forEach((genre) => counts.set(genre, (counts.get(genre) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Still discovering';
  }, [finishedBooks]);

  const recentSession = useMemo(
    () => [...sessions].sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a))[0],
    [sessions],
  );

  const finishedBookToday = finishedBooks.some((book) => isDateToday(book.dateFinished));
  const isAwakePose = Boolean(
    recentSession && Date.now() - getSessionTimestamp(recentSession) <= RECENT_READING_WINDOW_MS,
  );

  const lumisPortrait = finishedBookToday
    ? {
        src: PROUD_LUMIS_ASSET,
        alt: `${dragon.name}, a proud purple library dragon sitting on a stack of finished books`,
        title: 'Finished a book today',
        detail: `${dragon.name} looks especially proud today. Another story has found its place.`,
      }
    : isAwakePose
      ? {
          src: AWAKE_LUMIS_ASSET,
          alt: `${dragon.name}, an alert purple library dragon resting on a book beside a candle and tea`,
          title: `${dragon.name} is curled up by your newest book`,
          detail: 'Eager for your next adventure.',
        }
      : {
          src: SLEEPING_LUMIS_ASSET,
          alt: `${dragon.name}, a sleeping purple library dragon resting on a book beside a candle and tea`,
          title: `${dragon.name} is resting after a day of stories`,
          detail: "Dreaming of tomorrow's adventures.",
        };

  const saveName = () => {
    const name = draftName.trim();
    if (!name) return;
    setDragon((current) => ({ ...current, name }));
    setIsRenaming(false);
  };

  return (
    <section className="space-y-6 pb-12">
      <header className="inkbound-panel overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)] lg:items-center">
          <div>
            <span className="inkbound-eyebrow">Project Lumis · Your reading companion</span>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {isRenaming ? (
                <div className="flex flex-wrap gap-2">
                  <input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    maxLength={28}
                    className="min-h-11 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)] outline-none"
                    autoFocus
                  />
                  <button type="button" onClick={saveName} className="quiet-shelf-primary-action">
                    Save name
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="font-serif text-4xl text-[var(--ink-ivory)] sm:text-5xl">
                    {dragon.name}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsRenaming(true)}
                    className="quiet-shelf-icon-button"
                    aria-label="Rename your dragon"
                  >
                    <Pencil />
                  </button>
                </>
              )}
            </div>

            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-muted)] sm:text-base">
              Every Inkbound library is entrusted with a young dragon. {dragon.name} shares your
              reading life, quietly keeping company with every book, quote, and memory you bring home.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
                <span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                  Reading Together
                </span>
                <strong className="mt-2 block font-serif text-xl text-[var(--ink-ivory)]">
                  {finishedBooks.length} books
                </strong>
              </div>
              <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
                <span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                  Sessions Shared
                </span>
                <strong className="mt-2 block font-serif text-xl text-[var(--ink-ivory)]">
                  {sessions.length}
                </strong>
              </div>
              <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
                <span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                  Pages Read Together
                </span>
                <strong className="mt-2 block font-serif text-xl text-[var(--ink-ivory)]">
                  {totalPages.toLocaleString()}
                </strong>
              </div>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[520px] overflow-hidden rounded-[2rem] border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
            <img
              src={lumisPortrait.src}
              alt={lumisPortrait.alt}
              className="block h-auto w-full object-cover"
            />
            <div className="border-t border-[var(--ink-border-subtle)] bg-[linear-gradient(180deg,rgba(20,14,24,0.92),rgba(13,9,16,0.98))] px-5 py-5 text-center">
              <p className="font-serif text-xl leading-snug text-[#f1e8df] sm:text-2xl">
                {lumisPortrait.title}
              </p>
              <p className="mt-1.5 text-sm text-[#b9aeba]">{lumisPortrait.detail}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="inkbound-panel rounded-3xl p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <Sparkles className="text-[var(--ink-mauve)]" />
          <h3 className="font-serif text-2xl text-[var(--ink-ivory)]">About {dragon.name}</h3>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
          A few quiet details shaped by the reading life you share together.
        </p>
        <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
            <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Personality</dt>
            <dd className="mt-2 font-serif text-xl text-[var(--ink-ivory)]">Curious & Gentle</dd>
          </div>
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
            <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Favorite genre</dt>
            <dd className="mt-2 font-serif text-xl text-[var(--ink-ivory)]">{favoriteGenre}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
            <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Companion since</dt>
            <dd className="mt-2 font-serif text-xl text-[var(--ink-ivory)]">
              {new Date(`${dragon.hatchDay}T12:00:00`).toLocaleDateString()}
            </dd>
          </div>
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
            <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Favorite spot</dt>
            <dd className="mt-2 font-serif text-xl text-[var(--ink-ivory)]">
              {dragon.favoriteSleepingSpot}
            </dd>
          </div>
        </dl>
      </section>

      <section className="inkbound-panel rounded-3xl p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <Feather className="text-[var(--ink-mauve)]" />
          <h3 className="font-serif text-2xl text-[var(--ink-ivory)]">The Inkbound Promise</h3>
        </div>
        <blockquote className="mt-4 max-w-3xl font-serif text-2xl leading-10 text-[var(--ink-ivory)]">
          “Inkbound doesn’t reward readers with points. It rewards them with memories.”
        </blockquote>
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
          <BookHeart className="h-4 w-4 text-[var(--ink-mauve)]" />
          Lumis never interrupts reading, creates guilt, or asks for attention.
        </p>
      </section>
    </section>
  );
};
