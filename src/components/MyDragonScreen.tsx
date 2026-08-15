import React, { useMemo, useState } from 'react';
import { BookHeart, Feather, Pencil, Sparkles } from 'lucide-react';
import { Format, ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { getSessionDurationMinutes, getSessionPagesRead } from '../features/reading/sessionAnalytics';
import { getActiveEdition } from '../features/reading/bookReadingState';

interface DragonProfile {
  id: string;
  name: string;
}

interface MyDragonScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

const DRAGON_KEY = 'inkbound_dragon';
const AWAKE_LUMIS_ASSET = '/assets/lumis/lumis-awake.svg';
const SLEEPING_LUMIS_ASSET = '/assets/lumis/lumis-sleeping.svg';
const RECENT_READING_WINDOW_MS = 6 * 60 * 60 * 1000;

const DEFAULT_DRAGON: DragonProfile = {
  id: 'library-dragon',
  name: 'Lumis',
};

const FORMAT_LABELS: Record<Format, string> = {
  hardcover: 'Hardcover',
  paperback: 'Paperback',
  ebook: 'eBook',
  audiobook: 'Audiobook',
};

const getSessionTimestamp = (session: ReadingSession): number => {
  const dateMatch = session.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return Number.NEGATIVE_INFINITY;
  const [, yearText, monthText, dayText] = dateMatch;
  const [hourText, minuteText] = (session.endTime || session.startTime || '12:00').split(':');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

const getReadingDaypart = (startTime: string): string => {
  const hour = Number.parseInt(startTime.split(':')[0] ?? '', 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return 'Still discovering';
  if (hour >= 5 && hour < 12) return 'Mornings';
  if (hour >= 12 && hour < 17) return 'Afternoons';
  if (hour >= 17 && hour < 21) return 'Evenings';
  return 'Nights';
};

const formatSessionDuration = (minutes: number): string => {
  if (minutes <= 0) return 'No sessions yet';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes} min`;
  if (remainingMinutes === 0) return `${hours} hr`;
  return `${hours} hr ${remainingMinutes} min`;
};

export const MyDragonScreen: React.FC<MyDragonScreenProps> = ({ books, sessions }) => {
  const [dragon, setDragon] = usePersistentState<DragonProfile>(DRAGON_KEY, DEFAULT_DRAGON);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(dragon.name);

  const finishedBooks = books.filter((book) => book.status === 'finished');
  const completedSessions = useMemo(
    () => sessions.filter((session) => getSessionDurationMinutes(session) > 0 && Number.isFinite(getSessionTimestamp(session))),
    [sessions],
  );
  const totalPages = completedSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);

  const favoriteGenre = useMemo(() => {
    const counts = new Map<string, number>();
    finishedBooks
      .flatMap((book) => book.work.genres)
      .forEach((genre) => counts.set(genre, (counts.get(genre) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Still discovering';
  }, [finishedBooks]);

  const favoriteFormat = useMemo(() => {
    const counts = new Map<Format, number>();
    finishedBooks.forEach((book) => {
      const edition = getActiveEdition(book);
      if (!edition) return;
      counts.set(edition.format, (counts.get(edition.format) ?? 0) + 1);
    });
    const format = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return format ? FORMAT_LABELS[format] : 'Still discovering';
  }, [finishedBooks]);

  const favoriteReadingTime = useMemo(() => {
    const counts = new Map<string, number>();
    completedSessions.forEach((session) => {
      const daypart = getReadingDaypart(session.startTime);
      if (daypart === 'Still discovering') return;
      counts.set(daypart, (counts.get(daypart) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Still discovering';
  }, [completedSessions]);

  const longestReadingSession = useMemo(
    () => formatSessionDuration(Math.max(0, ...completedSessions.map((session) => getSessionDurationMinutes(session)))),
    [completedSessions],
  );

  const recentSession = useMemo(
    () => [...completedSessions].sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a))[0],
    [completedSessions],
  );

  const isAwakePose = Boolean(
    recentSession
      && getSessionTimestamp(recentSession) <= Date.now()
      && Date.now() - getSessionTimestamp(recentSession) <= RECENT_READING_WINDOW_MS,
  );

  const lumisPortrait = isAwakePose
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
                  {completedSessions.length}
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
          {dragon.name} quietly reflects the reading habits you've built together.
        </p>
        <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
            <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Favorite genre</dt>
            <dd className="mt-2 font-serif text-xl text-[var(--ink-ivory)]">{favoriteGenre}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
            <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Favorite format</dt>
            <dd className="mt-2 font-serif text-xl text-[var(--ink-ivory)]">{favoriteFormat}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
            <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
              Favorite reading time
            </dt>
            <dd className="mt-2 font-serif text-xl text-[var(--ink-ivory)]">{favoriteReadingTime}</dd>
          </div>
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
            <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
              Longest reading session
            </dt>
            <dd className="mt-2 font-serif text-xl text-[var(--ink-ivory)]">{longestReadingSession}</dd>
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
