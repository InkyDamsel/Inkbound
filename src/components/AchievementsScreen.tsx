import React, { useEffect, useMemo } from 'react';
import {
  Award,
  BookOpen,
  Check,
  Clock3,
  Flame,
  Headphones,
  Library,
  Moon,
  Sparkles,
  Star,
} from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { ResponsiveGrid } from '../layout/responsive';

type AchievementFilter = 'all' | 'unlocked' | 'locked';

interface AchievementsScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: React.ElementType;
  progress: number;
  target: number;
  unit: string;
}

const UNLOCKED_STORAGE_KEY = 'inkbound_achievement_unlocks';
const SEEN_STORAGE_KEY = 'inkbound_achievement_seen';
const FILTER_STORAGE_KEY = 'inkbound_achievement_filter';

const readRecord = (key: string): Record<string, string> => {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as Record<string, string>) : {};
  } catch {
    return {};
  }
};

const getActiveEdition = (book: UserBookRecord) =>
  book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

export const AchievementsScreen: React.FC<AchievementsScreenProps> = ({ books, sessions }) => {
  const [unlockDates, setUnlockDates] = usePersistentState<Record<string, string>>(
    UNLOCKED_STORAGE_KEY,
    readRecord(UNLOCKED_STORAGE_KEY),
  );
  const [seenAchievementIds, setSeenAchievementIds] = usePersistentState<string[]>(
    SEEN_STORAGE_KEY,
    [],
  );
  const [filter, setFilter] = usePersistentState<AchievementFilter>(FILTER_STORAGE_KEY, 'all');

  const definitions = useMemo<AchievementDefinition[]>(() => {
    const finishedBooks = books.filter((book) => book.status === 'finished');
    const totalPages = sessions.reduce((sum, session) => sum + (session.pagesRead ?? 0), 0);
    const totalMinutes = sessions.reduce((sum, session) => sum + session.durationMinutes, 0);
    const audiobookBooks = books.filter((book) => getActiveEdition(book)?.format === 'audiobook');
    const audiobookSessions = sessions.filter((session) =>
      audiobookBooks.some((book) => book.id === session.bookId),
    );
    const nightSessions = sessions.filter((session) => {
      const hour = Number.parseInt(session.startTime?.split(':')[0] ?? '0', 10);
      return hour >= 21 || hour < 5;
    });
    const uniqueReadingDays = new Set(sessions.map((session) => session.date)).size;
    const reviewedBooks = books.filter((book) => Boolean(book.review?.trim())).length;
    const quotedBooks = books.filter((book) => book.favoriteQuotes.length > 0).length;
    const largeBooksFinished = finishedBooks.filter((book) => (getActiveEdition(book)?.pageCount ?? 0) >= 500).length;

    return [
      {
        id: 'first-book',
        title: 'First Chapter',
        description: 'Finish your first book in Inkbound.',
        category: 'Milestone',
        icon: BookOpen,
        progress: finishedBooks.length,
        target: 1,
        unit: 'book',
      },
      {
        id: 'five-books',
        title: 'Shelf Starter',
        description: 'Finish five books.',
        category: 'Milestone',
        icon: Library,
        progress: finishedBooks.length,
        target: 5,
        unit: 'books',
      },
      {
        id: 'ten-sessions',
        title: 'Reading Ritual',
        description: 'Complete ten reading sessions.',
        category: 'Habit',
        icon: Clock3,
        progress: sessions.length,
        target: 10,
        unit: 'sessions',
      },
      {
        id: 'seven-days',
        title: 'Seven Days of Stories',
        description: 'Read on seven different days.',
        category: 'Habit',
        icon: Flame,
        progress: uniqueReadingDays,
        target: 7,
        unit: 'days',
      },
      {
        id: 'thousand-pages',
        title: 'Page Turner',
        description: 'Read 1,000 tracked pages.',
        category: 'Volume',
        icon: Sparkles,
        progress: totalPages,
        target: 1000,
        unit: 'pages',
      },
      {
        id: 'ten-hours',
        title: 'Lost in the Pages',
        description: 'Record ten hours of reading time.',
        category: 'Volume',
        icon: Star,
        progress: Math.floor(totalMinutes / 60),
        target: 10,
        unit: 'hours',
      },
      {
        id: 'audiobook',
        title: 'Story in Your Ears',
        description: 'Complete an audiobook reading session.',
        category: 'Format',
        icon: Headphones,
        progress: audiobookSessions.length,
        target: 1,
        unit: 'session',
      },
      {
        id: 'night-reader',
        title: 'Night Owl',
        description: 'Complete five sessions after 9 PM.',
        category: 'Habit',
        icon: Moon,
        progress: nightSessions.length,
        target: 5,
        unit: 'sessions',
      },
      {
        id: 'thoughtful-reader',
        title: 'Thoughtful Reader',
        description: 'Write reviews for three books.',
        category: 'Journal',
        icon: Award,
        progress: reviewedBooks,
        target: 3,
        unit: 'reviews',
      },
      {
        id: 'quote-keeper',
        title: 'Quote Keeper',
        description: 'Save favorite quotes from three books.',
        category: 'Journal',
        icon: Check,
        progress: quotedBooks,
        target: 3,
        unit: 'books',
      },
      {
        id: 'epic-reader',
        title: 'Epic Reader',
        description: 'Finish a book with at least 500 pages.',
        category: 'Milestone',
        icon: Award,
        progress: largeBooksFinished,
        target: 1,
        unit: 'book',
      },
    ];
  }, [books, sessions]);

  useEffect(() => {
    const newlyUnlocked = definitions.filter(
      (achievement) => achievement.progress >= achievement.target && !unlockDates[achievement.id],
    );
    if (newlyUnlocked.length === 0) return;

    const timestamp = new Date().toISOString();
    setUnlockDates((current) => ({
      ...current,
      ...Object.fromEntries(newlyUnlocked.map((achievement) => [achievement.id, timestamp])),
    }));
  }, [definitions, setUnlockDates, unlockDates]);

  const unlockedCount = definitions.filter((item) => item.progress >= item.target).length;
  const unseenUnlocked = definitions.filter(
    (item) => item.progress >= item.target && !seenAchievementIds.includes(item.id),
  );

  useEffect(() => {
    if (unseenUnlocked.length === 0) return;
    setSeenAchievementIds((current) => [
      ...new Set([...current, ...unseenUnlocked.map((item) => item.id)]),
    ]);
  }, [setSeenAchievementIds, unseenUnlocked]);

  const visibleAchievements = definitions.filter((achievement) => {
    const unlocked = achievement.progress >= achievement.target;
    if (filter === 'unlocked') return unlocked;
    if (filter === 'locked') return !unlocked;
    return true;
  });

  return (
    <div className="space-y-6 pb-24">
      <section className="inkbound-panel overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="inkbound-kicker">Permanent Milestones</p>
            <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Achievements</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
              Achievements unlock automatically from your library and reading sessions. Once earned,
              the unlock date is saved permanently on this device and included in cloud sync.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-6 py-4 text-center">
            <p className="font-serif text-4xl font-bold text-[var(--ink-ivory)]">{unlockedCount}</p>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              of {definitions.length} unlocked
            </p>
          </div>
        </div>

        <div className="mt-6 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,var(--ink-gold),var(--ink-gold-bright))]"
            style={{ width: `${Math.round((unlockedCount / definitions.length) * 100)}%` }}
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {(['all', 'unlocked', 'locked'] as AchievementFilter[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`min-h-10 rounded-xl border px-4 text-sm font-semibold capitalize transition ${
              filter === option
                ? 'border-[var(--ink-gold)] bg-[rgba(197,160,89,0.14)] text-[var(--ink-ivory)]'
                : 'border-[var(--ink-border)] bg-[var(--ink-surface-soft)] text-[var(--ink-muted)]'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <ResponsiveGrid minItemWidth={260} maxColumns={3} gap={16} alignItems="stretch">
        {visibleAchievements.map((achievement) => {
          const Icon = achievement.icon;
          const unlocked = achievement.progress >= achievement.target;
          const percent = Math.min(100, Math.round((achievement.progress / achievement.target) * 100));
          const unlockDate = unlockDates[achievement.id];

          return (
            <article
              key={achievement.id}
              className={`inkbound-panel flex min-h-64 flex-col rounded-3xl p-5 transition ${
                unlocked ? 'ring-1 ring-[rgba(197,160,89,0.38)]' : 'opacity-80'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div
                  className={`grid h-14 w-14 place-items-center rounded-2xl border ${
                    unlocked
                      ? 'border-[rgba(197,160,89,0.45)] bg-[rgba(197,160,89,0.14)] text-[var(--ink-gold-bright)]'
                      : 'border-[var(--ink-border)] bg-[var(--ink-surface-soft)] text-[var(--ink-faint)]'
                  }`}
                >
                  <Icon className="h-7 w-7" />
                </div>
                <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                  {achievement.category}
                </span>
              </div>

              <h2 className="mt-5 font-serif text-xl font-bold text-[var(--ink-ivory)]">
                {achievement.title}
              </h2>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">{achievement.description}</p>

              <div className="mt-auto pt-6">
                <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
                  <span>
                    {Math.min(achievement.progress, achievement.target)} of {achievement.target}{' '}
                    {achievement.unit}
                  </span>
                  <strong className="text-[var(--ink-ivory)]">{percent}%</strong>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--ink-gold),var(--ink-gold-bright))]"
                    style={{ width: `${percent}%` }}
                  />
                </div>

                {unlocked ? (
                  <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-[var(--ink-gold-bright)]">
                    <Check className="h-4 w-4" />
                    Unlocked{unlockDate ? ` ${new Date(unlockDate).toLocaleDateString()}` : ''}
                  </p>
                ) : (
                  <p className="mt-4 text-xs text-[var(--ink-faint)]">Keep reading to unlock</p>
                )}
              </div>
            </article>
          );
        })}
      </ResponsiveGrid>
    </div>
  );
};
