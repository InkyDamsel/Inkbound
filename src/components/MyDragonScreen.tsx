import React, { useMemo, useState } from 'react';
import { BookHeart, Eye, Feather, Moon, Pencil, Sparkles, Sun } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';

type DragonMotion = 'full' | 'reduced' | 'static';
type DragonVisibility = 'visible' | 'minimal' | 'hidden';

interface DragonProfile {
  id: string;
  name: string;
  hatchDay: string;
  motion: DragonMotion;
  visibility: DragonVisibility;
  ambientEffects: boolean;
  favoriteSleepingSpot: string;
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
  hatchDay: new Date().toISOString().slice(0, 10),
  motion: 'full',
  visibility: 'visible',
  ambientEffects: true,
  favoriteSleepingSpot: 'By the fireplace',
};

const stageForBooks = (finishedBooks: number) => {
  if (finishedBooks >= 500) return { name: 'Elder Library Dragon', next: null, threshold: 500 };
  if (finishedBooks >= 250) return { name: 'Ancient Book Dragon', next: 500, threshold: 250 };
  if (finishedBooks >= 100) return { name: 'Scholar Dragon', next: 250, threshold: 100 };
  if (finishedBooks >= 25) return { name: 'Young Dragon', next: 100, threshold: 25 };
  return { name: 'Hatchling', next: 25, threshold: 0 };
};

const getSessionTimestamp = (session: ReadingSession): number => {
  const time = session.endTime || session.startTime || '12:00';
  const timestamp = new Date(`${session.date}T${time}`).getTime();
  return Number.isNaN(timestamp) ? new Date(session.date).getTime() : timestamp;
};

export const MyDragonScreen: React.FC<MyDragonScreenProps> = ({ books, sessions }) => {
  const [dragon, setDragon] = usePersistentState<DragonProfile>(DRAGON_KEY, DEFAULT_DRAGON);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(dragon.name);

  const finishedBooks = books.filter((book) => book.status === 'finished');
  const stage = stageForBooks(finishedBooks.length);
  const totalPages = finishedBooks.reduce((sum, book) => {
    const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
    return sum + (edition?.pageCount ?? book.progressPages ?? 0);
  }, 0);

  const favoriteGenre = useMemo(() => {
    const counts = new Map<string, number>();
    finishedBooks
      .flatMap((book) => book.work.genres)
      .forEach((genre) => counts.set(genre, (counts.get(genre) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Waiting for your first story';
  }, [finishedBooks]);

  const recentSession = useMemo(
    () => [...sessions].sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a))[0],
    [sessions],
  );

  const isAwakePose = Boolean(
    recentSession && Date.now() - getSessionTimestamp(recentSession) <= RECENT_READING_WINDOW_MS,
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

  const progress = stage.next
    ? Math.min(
        100,
        Math.round(
          ((finishedBooks.length - stage.threshold) / (stage.next - stage.threshold)) * 100,
        ),
      )
    : 100;

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
              Every Inkbound library is entrusted with a young dragon. {dragon.name} grows beside
              your reading life, quietly guarding every book, quote, and memory you bring home.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
                <span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                  Growth stage
                </span>
                <strong className="mt-2 block font-serif text-xl text-[var(--ink-ivory)]">
                  {stage.name}
                </strong>
              </div>
              <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
                <span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                  Books together
                </span>
                <strong className="mt-2 block font-serif text-xl text-[var(--ink-ivory)]">
                  {finishedBooks.length}
                </strong>
              </div>
              <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
                <span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                  Pages guarded
                </span>
                <strong className="mt-2 block font-serif text-xl text-[var(--ink-ivory)]">
                  {totalPages.toLocaleString()}
                </strong>
              </div>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[520px] overflow-hidden rounded-[2rem] border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
            {dragon.visibility !== 'hidden' ? (
              <div
                className={`transition-all ${
                  dragon.visibility === 'minimal' ? 'scale-[0.92] opacity-75' : ''
                }`}
              >
                <img
                  src={lumisPortrait.src}
                  alt={lumisPortrait.alt}
                  className="block h-auto w-full object-cover"
                />
                <div className="border-t border-[var(--ink-border-subtle)] bg-[linear-gradient(180deg,rgba(20,14,24,0.92),rgba(13,9,16,0.98))] px-5 py-5 text-center">
                  <p className="font-serif text-xl leading-snug text-[var(--ink-ivory)] sm:text-2xl">
                    {lumisPortrait.title}
                  </p>
                  <p className="mt-1.5 text-sm text-[var(--ink-muted)]">
                    {lumisPortrait.detail}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid min-h-72 place-items-center px-8 text-center text-sm leading-7 text-[var(--ink-muted)]">
                Your dragon is hidden, but your reading journey still helps it grow.
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="inkbound-panel rounded-3xl p-6">
          <div className="flex items-center gap-3">
            <Sparkles className="text-[var(--ink-mauve)]" />
            <h3 className="font-serif text-2xl text-[var(--ink-ivory)]">Growing Together</h3>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]">
            <span
              className="block h-full rounded-full bg-[var(--ink-mauve)]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-[var(--ink-muted)]">
            {stage.next
              ? `${stage.next - finishedBooks.length} more finished books until the next gentle growth stage.`
              : `${dragon.name} has reached the eldest known Library Dragon stage.`}
          </p>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                Favorite genre
              </dt>
              <dd className="mt-1 text-[var(--ink-ivory)]">{favoriteGenre}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                Hatch Day
              </dt>
              <dd className="mt-1 text-[var(--ink-ivory)]">
                {new Date(`${dragon.hatchDay}T12:00:00`).toLocaleDateString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                Favorite spot
              </dt>
              <dd className="mt-1 text-[var(--ink-ivory)]">{dragon.favoriteSleepingSpot}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                Sessions shared
              </dt>
              <dd className="mt-1 text-[var(--ink-ivory)]">{sessions.length}</dd>
            </div>
          </dl>
        </section>

        <section className="inkbound-panel rounded-3xl p-6">
          <div className="flex items-center gap-3">
            <Eye className="text-[var(--ink-mauve)]" />
            <h3 className="font-serif text-2xl text-[var(--ink-ivory)]">
              Comfort & Accessibility
            </h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Lumis never interrupts reading. Choose how quietly your companion appears throughout
            Inkbound.
          </p>
          <label className="mt-5 block">
            <span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Motion</span>
            <select
              value={dragon.motion}
              onChange={(event) =>
                setDragon((current) => ({
                  ...current,
                  motion: event.target.value as DragonMotion,
                }))
              }
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)]"
            >
              <option value="full">Full gentle motion</option>
              <option value="reduced">Reduced motion</option>
              <option value="static">Static</option>
            </select>
          </label>
          <label className="mt-4 block">
            <span className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
              Dragon visibility
            </span>
            <select
              value={dragon.visibility}
              onChange={(event) =>
                setDragon((current) => ({
                  ...current,
                  visibility: event.target.value as DragonVisibility,
                }))
              }
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)]"
            >
              <option value="visible">Visible</option>
              <option value="minimal">Minimal</option>
              <option value="hidden">Hidden</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              setDragon((current) => ({
                ...current,
                ambientEffects: !current.ambientEffects,
              }))
            }
            className="mt-4 flex min-h-11 w-full items-center justify-between rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 text-left text-sm text-[var(--ink-ivory)]"
          >
            <span className="inline-flex items-center gap-2">
              {dragon.ambientEffects ? (
                <Moon className="h-4 w-4 text-[var(--ink-mauve)]" />
              ) : (
                <Sun className="h-4 w-4 text-[var(--ink-muted)]" />
              )}
              Ambient portrait effects
            </span>
            <strong>{dragon.ambientEffects ? 'On' : 'Off'}</strong>
          </button>
        </section>
      </div>

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
