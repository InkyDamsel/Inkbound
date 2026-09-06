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
  Trophy,
} from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { ResponsiveGrid } from '../layout/responsive';
import {
  getSessionDurationMinutes,
  getSessionPagesRead,
} from '../features/reading/sessionAnalytics';
import { readRuntimeJson } from '../platform/runtimeStorage';

type AchievementFilter = 'all' | 'unlocked' | 'in-progress';

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

// v2 intentionally resets the beta achievement ledger so imported finished books
// that previously unlocked milestones do not remain credited after the provenance fix.
const UNLOCKED_STORAGE_KEY = 'inkbound_achievement_unlocks_v2';
const REVEALED_STORAGE_KEY = 'inkbound_achievement_reveals_v2';
const SEEN_STORAGE_KEY = 'inkbound_achievement_seen_v2';
const FILTER_STORAGE_KEY = 'inkbound_achievement_filter';

const readRecord = (key: string): Record<string, string> => {
  const parsed = readRuntimeJson<unknown>(key, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, string>)
    : {};
};

const readStringArray = (key: string): string[] => {
  const parsed = readRuntimeJson<unknown>(key, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
};

const readFilter = (): AchievementFilter => {
  const parsed = readRuntimeJson<unknown>(FILTER_STORAGE_KEY, 'all');
  return parsed === 'unlocked' || parsed === 'in-progress' ? parsed : 'all';
};

const getActiveEdition = (book: UserBookRecord) =>
  book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

const safeNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const isImportedBook = (book: UserBookRecord): boolean => Boolean(
  book.sourceOfImport?.toLowerCase().includes('import')
  || book.privateTags?.includes('imported')
  || book.id.startsWith('book-import-')
);

const achievementFamily = (id: string) => id.replace(/-\d+$/, '');

const makeLadder = (
  prefix: string,
  category: string,
  icon: React.ElementType,
  progress: number,
  unit: string,
  milestones: Array<[number, string, string]>,
): AchievementDefinition[] =>
  milestones.map(([target, title, description]) => ({
    id: `${prefix}-${target}`,
    title,
    description,
    category,
    icon,
    progress,
    target,
    unit,
  }));

export const AchievementsScreen: React.FC<AchievementsScreenProps> = ({ books, sessions }) => {
  const [unlockDates, setUnlockDates] = usePersistentState<Record<string, string>>(
    UNLOCKED_STORAGE_KEY,
    () => readRecord(UNLOCKED_STORAGE_KEY),
  );
  const [revealedAchievementIds, setRevealedAchievementIds] = usePersistentState<string[]>(
    REVEALED_STORAGE_KEY,
    () => readStringArray(REVEALED_STORAGE_KEY),
  );
  const [seenAchievementIds, setSeenAchievementIds] = usePersistentState<string[]>(
    SEEN_STORAGE_KEY,
    () => readStringArray(SEEN_STORAGE_KEY),
  );
  const [filter, setFilter] = usePersistentState<AchievementFilter>(FILTER_STORAGE_KEY, readFilter);

  const safeUnlockDates =
    unlockDates && typeof unlockDates === 'object' && !Array.isArray(unlockDates) ? unlockDates : {};
  const safeRevealedAchievementIds = Array.isArray(revealedAchievementIds) ? revealedAchievementIds : [];
  const safeSeenAchievementIds = Array.isArray(seenAchievementIds) ? seenAchievementIds : [];
  const safeFilter: AchievementFilter =
    filter === 'unlocked' || filter === 'in-progress' ? filter : 'all';

  const definitions = useMemo<AchievementDefinition[]>(() => {
    const completedSessions = sessions.filter((session) => getSessionDurationMinutes(session) > 0);
    const booksWithTrackedActivity = new Set(completedSessions.map((session) => session.bookId));

    // Imported history never earns completion achievements by itself. An imported book
    // becomes eligible only after Inkbound has evidence that the reader interacted with
    // it here: a tracked session, or an Inkbound status transition that supplied both
    // dateStarted and dateFinished. Raw imports do not populate dateStarted.
    const finishedBooks = books.filter((book) => {
      if (book.status !== 'finished') return false;
      if (!isImportedBook(book)) return true;
      return booksWithTrackedActivity.has(book.id) || Boolean(book.dateStarted && book.dateFinished);
    });

    const totalPages = completedSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const totalMinutes = completedSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const totalHours = Math.floor(totalMinutes / 60);
    const uniqueReadingDays = new Set(completedSessions.map((session) => session.date).filter(Boolean)).size;

    const audiobookBookIds = new Set(
      books.filter((book) => getActiveEdition(book)?.format === 'audiobook').map((book) => book.id),
    );
    const audiobookSessions = completedSessions.filter((session) => audiobookBookIds.has(session.bookId));
    const finishedAudiobooks = finishedBooks.filter((book) => getActiveEdition(book)?.format === 'audiobook').length;
    const finishedEbooks = finishedBooks.filter((book) => getActiveEdition(book)?.format === 'ebook').length;
    const finishedPhysical = finishedBooks.filter((book) =>
      ['hardcover', 'paperback'].includes(getActiveEdition(book)?.format ?? ''),
    ).length;

    const nightSessions = completedSessions.filter((session) => {
      const hour = Number.parseInt(session.startTime?.split(':')[0] ?? '', 10);
      return Number.isFinite(hour) && (hour >= 21 || hour < 5);
    }).length;

    // Imported reviews can arrive with an export, so journal achievements only count
    // books that have become legitimate Inkbound-finished books as defined above.
    const reviewedBooks = finishedBooks.filter((book) => Boolean(book.review?.trim())).length;
    const quotedBooks = finishedBooks.filter(
      (book) => Array.isArray(book.favoriteQuotes) && book.favoriteQuotes.length > 0,
    ).length;
    const largeBooksFinished = finishedBooks.filter(
      (book) => safeNumber(getActiveEdition(book)?.pageCount) >= 500,
    ).length;
    const veryLargeBooksFinished = finishedBooks.filter(
      (book) => safeNumber(getActiveEdition(book)?.pageCount) >= 700,
    ).length;
    const distinctFinishedGenres = new Set(
      finishedBooks.flatMap((book) => book.work.genres ?? []).filter(Boolean),
    ).size;
    const activeBooks = books.filter((book) =>
      book.status === 'currently-reading'
      && (!isImportedBook(book) || booksWithTrackedActivity.has(book.id) || Boolean(book.dateStarted)),
    ).length;

    return [
      ...makeLadder('books-finished', 'Milestone', Library, finishedBooks.length, 'books', [
        [1, 'First Chapter', 'Finish your first book in Inkbound.'],
        [5, 'Shelf Starter', 'Finish five books.'],
        [10, 'Ten Down', 'Finish ten books.'],
        [15, 'Shelf Builder', 'Finish fifteen books.'],
        [25, 'Quarter Century', 'Finish twenty-five books.'],
        [50, 'Half a Hundred', 'Finish fifty books.'],
        [75, 'Deep Shelf', 'Finish seventy-five books.'],
        [100, 'Century Reader', 'Finish one hundred books.'],
        [150, 'Library in Motion', 'Finish one hundred fifty books.'],
        [200, 'Two Hundred Tales', 'Finish two hundred books.'],
        [300, 'Endless Shelves', 'Finish three hundred books.'],
        [500, 'Legendary Library', 'Finish five hundred books.'],
      ]),
      ...makeLadder('sessions', 'Habit', Clock3, completedSessions.length, 'sessions', [
        [1, 'Reading Begins', 'Complete your first tracked reading session.'],
        [10, 'Reading Ritual', 'Complete ten reading sessions.'],
        [25, 'Settling In', 'Complete twenty-five reading sessions.'],
        [50, 'Session Regular', 'Complete fifty reading sessions.'],
        [100, 'Hundred Sessions', 'Complete one hundred reading sessions.'],
        [250, 'Always Reading', 'Complete two hundred fifty reading sessions.'],
        [500, 'Reading Is the Routine', 'Complete five hundred reading sessions.'],
      ]),
      ...makeLadder('reading-days', 'Habit', Flame, uniqueReadingDays, 'days', [
        [3, 'Three Days of Stories', 'Read on three different days.'],
        [7, 'Seven Days of Stories', 'Read on seven different days.'],
        [14, 'Two Weeks in the Pages', 'Read on fourteen different days.'],
        [30, 'A Month of Reading Days', 'Read on thirty different days.'],
        [60, 'Reading Season', 'Read on sixty different days.'],
        [100, 'Hundred Reading Days', 'Read on one hundred different days.'],
        [180, 'Half a Year of Stories', 'Read on one hundred eighty different days.'],
        [365, 'A Year in Pages', 'Read on three hundred sixty-five different days.'],
      ]),
      ...makeLadder('pages', 'Volume', Sparkles, totalPages, 'pages', [
        [100, 'First Hundred Pages', 'Read one hundred tracked pages.'],
        [500, 'Pages Are Turning', 'Read five hundred tracked pages.'],
        [1000, 'Page Turner', 'Read one thousand tracked pages.'],
        [2500, 'Paper Trail', 'Read two thousand five hundred tracked pages.'],
        [5000, 'Five Thousand Pages', 'Read five thousand tracked pages.'],
        [10000, 'Ten Thousand Pages', 'Read ten thousand tracked pages.'],
        [25000, 'Mountain of Pages', 'Read twenty-five thousand tracked pages.'],
        [50000, 'Page Devourer', 'Read fifty thousand tracked pages.'],
        [100000, 'Six Figures of Stories', 'Read one hundred thousand tracked pages.'],
      ]),
      ...makeLadder('hours', 'Volume', Star, totalHours, 'hours', [
        [1, 'An Hour Away', 'Record one hour of reading time.'],
        [5, 'Five Hours Lost', 'Record five hours of reading time.'],
        [10, 'Lost in the Pages', 'Record ten hours of reading time.'],
        [25, 'Storytime Regular', 'Record twenty-five hours of reading time.'],
        [50, 'Fifty Hours Elsewhere', 'Record fifty hours of reading time.'],
        [100, 'Hundred Hour Reader', 'Record one hundred hours of reading time.'],
        [250, 'Time Well Read', 'Record two hundred fifty hours of reading time.'],
        [500, 'Five Hundred Hours', 'Record five hundred hours of reading time.'],
        [1000, 'A Thousand Hours Away', 'Record one thousand hours of reading time.'],
      ]),
      ...makeLadder('night-sessions', 'Habit', Moon, nightSessions, 'sessions', [
        [1, 'After Dark', 'Complete a reading session after 9 PM.'],
        [5, 'Night Owl', 'Complete five sessions after 9 PM.'],
        [15, 'Moonlit Reader', 'Complete fifteen sessions after 9 PM.'],
        [30, 'Midnight Habit', 'Complete thirty sessions after 9 PM.'],
        [75, 'Creature of the Night', 'Complete seventy-five sessions after 9 PM.'],
      ]),
      ...makeLadder('reviews', 'Journal', Award, reviewedBooks, 'reviews', [
        [1, 'First Impression', 'Write your first book review.'],
        [3, 'Thoughtful Reader', 'Write reviews for three books.'],
        [10, 'Reviewer in Residence', 'Write reviews for ten books.'],
        [25, 'Reading Critic', 'Write reviews for twenty-five books.'],
        [50, 'Shelf Chronicler', 'Write reviews for fifty books.'],
      ]),
      ...makeLadder('quotes', 'Journal', Check, quotedBooks, 'books', [
        [1, 'A Line Worth Keeping', 'Save a favorite quote from a book.'],
        [3, 'Quote Keeper', 'Save favorite quotes from three books.'],
        [10, 'Margin of Memory', 'Save favorite quotes from ten books.'],
        [25, 'Collector of Lines', 'Save favorite quotes from twenty-five books.'],
        [50, 'Words Worth Saving', 'Save favorite quotes from fifty books.'],
      ]),
      ...makeLadder('audiobooks', 'Format', Headphones, finishedAudiobooks, 'audiobooks', [
        [1, 'Story in Your Ears', 'Finish your first audiobook.'],
        [5, 'Audio Shelf', 'Finish five audiobooks.'],
        [10, 'Ten Tales Heard', 'Finish ten audiobooks.'],
        [25, 'Always Listening', 'Finish twenty-five audiobooks.'],
        [50, 'Audiobook Devotee', 'Finish fifty audiobooks.'],
      ]),
      ...makeLadder('audio-sessions', 'Format', Headphones, audiobookSessions.length, 'sessions', [
        [10, 'Headphones On', 'Complete ten audiobook reading sessions.'],
        [50, 'Audio Habit', 'Complete fifty audiobook reading sessions.'],
        [100, 'Hundred Listening Sessions', 'Complete one hundred audiobook reading sessions.'],
      ]),
      ...makeLadder('ebooks', 'Format', BookOpen, finishedEbooks, 'ebooks', [
        [1, 'Digital First', 'Finish your first ebook.'],
        [10, 'Digital Shelf', 'Finish ten ebooks.'],
        [25, 'Pocket Library', 'Finish twenty-five ebooks.'],
        [50, 'Screen Reader', 'Finish fifty ebooks.'],
      ]),
      ...makeLadder('physical', 'Format', Library, finishedPhysical, 'books', [
        [1, 'Paper and Ink', 'Finish your first hardcover or paperback.'],
        [10, 'Physical Shelf', 'Finish ten hardcover or paperback books.'],
        [25, 'Stacked High', 'Finish twenty-five physical books.'],
        [50, 'Shelf Space Required', 'Finish fifty physical books.'],
      ]),
      ...makeLadder('epic-500', 'Milestone', Trophy, largeBooksFinished, 'books', [
        [1, 'Epic Reader', 'Finish a book with at least five hundred pages.'],
        [5, 'Epic Shelf', 'Finish five books with at least five hundred pages.'],
        [10, 'Long-Haul Reader', 'Finish ten books with at least five hundred pages.'],
      ]),
      ...makeLadder('epic-700', 'Milestone', Trophy, veryLargeBooksFinished, 'books', [
        [1, 'Doorstopper', 'Finish a book with at least seven hundred pages.'],
        [5, 'Heavy Reading', 'Finish five books with at least seven hundred pages.'],
      ]),
      ...makeLadder('genres', 'Discovery', Sparkles, distinctFinishedGenres, 'genres', [
        [3, 'Genre Curious', 'Finish books from three different genres.'],
        [5, 'Genre Hopper', 'Finish books from five different genres.'],
        [10, 'Wide-Ranging Reader', 'Finish books across ten different genres.'],
        [20, 'Story Explorer', 'Finish books across twenty different genres.'],
      ]),
      ...makeLadder('active-books', 'Discovery', BookOpen, activeBooks, 'active books', [
        [3, 'Three at Once', 'Have three books currently in progress.'],
        [5, 'Many Worlds Open', 'Have five books currently in progress.'],
        [10, 'Chaos Reader', 'Have ten books currently in progress at once.'],
      ]),
    ];
  }, [books, sessions]);

  const newlyUnlocked = useMemo(
    () => definitions.filter((achievement) => achievement.progress >= achievement.target && !safeUnlockDates[achievement.id]),
    [definitions, safeUnlockDates],
  );

  useEffect(() => {
    if (newlyUnlocked.length === 0) return;
    const timestamp = new Date().toISOString();
    setUnlockDates((current) => ({
      ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}),
      ...Object.fromEntries(newlyUnlocked.map((achievement) => [achievement.id, timestamp])),
    }));
  }, [newlyUnlocked, setUnlockDates]);

  const achievementIdsToReveal = useMemo(() => {
    const byFamily = new Map<string, AchievementDefinition[]>();
    definitions.forEach((achievement) => {
      const family = achievementFamily(achievement.id);
      const current = byFamily.get(family) ?? [];
      current.push(achievement);
      byFamily.set(family, current);
    });

    const reveal = new Set<string>();
    byFamily.forEach((familyAchievements) => {
      const sorted = [...familyAchievements].sort((a, b) => a.target - b.target);
      const hasStarted = sorted.some((achievement) => achievement.progress > 0);
      if (!hasStarted) return;

      sorted.forEach((achievement) => {
        if (achievement.progress >= achievement.target) reveal.add(achievement.id);
      });

      const next = sorted.find((achievement) => achievement.progress < achievement.target);
      if (next) reveal.add(next.id);
    });

    return [...reveal];
  }, [definitions]);

  useEffect(() => {
    if (achievementIdsToReveal.length === 0) return;
    setRevealedAchievementIds((current) => [
      ...new Set([...(Array.isArray(current) ? current : []), ...achievementIdsToReveal]),
    ]);
  }, [achievementIdsToReveal, setRevealedAchievementIds]);

  const unseenUnlockedIds = useMemo(
    () => definitions
      .filter((item) => item.progress >= item.target && !safeSeenAchievementIds.includes(item.id))
      .map((item) => item.id),
    [definitions, safeSeenAchievementIds],
  );

  useEffect(() => {
    if (unseenUnlockedIds.length === 0) return;
    setSeenAchievementIds((current) => [
      ...new Set([...(Array.isArray(current) ? current : []), ...unseenUnlockedIds]),
    ]);
  }, [setSeenAchievementIds, unseenUnlockedIds]);

  // Current progress is authoritative. Persisted reveal/unlock records only keep dates/history;
  // they must never make a zero-progress achievement appear or look completed.
  const unlockedAchievements = definitions.filter((item) => item.progress >= item.target);
  const revealedAchievements = definitions.filter((item) => achievementIdsToReveal.includes(item.id));
  const inProgressAchievements = revealedAchievements.filter((item) => item.progress < item.target);
  const visibleAchievements =
    safeFilter === 'unlocked'
      ? unlockedAchievements
      : safeFilter === 'in-progress'
        ? inProgressAchievements
        : revealedAchievements;

  return (
    <div className="space-y-6 pb-24">
      <section className="inkbound-panel overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="inkbound-kicker">Permanent Milestones</p>
            <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Achievements</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
              Achievement paths stay hidden until your Inkbound activity starts them. Imported reading history does not earn achievements; imported books begin counting only after you read them here or mark them finished in Inkbound.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-6 py-4 text-center">
              <p className="font-serif text-4xl font-bold text-[var(--ink-ivory)]">{unlockedAchievements.length}</p>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">unlocked</p>
            </div>
            <div className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-6 py-4 text-center">
              <p className="font-serif text-4xl font-bold text-[var(--ink-ivory)]">{inProgressAchievements.length}</p>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">in progress</p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {([
          ['all', 'All visible'],
          ['unlocked', 'Unlocked'],
          ['in-progress', 'In progress'],
        ] as Array<[AchievementFilter, string]>).map(([option, label]) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition ${
              safeFilter === option
                ? 'border-[var(--ink-gold)] bg-[rgba(197,160,89,0.14)] text-[var(--ink-ivory)]'
                : 'border-[var(--ink-border)] bg-[var(--ink-surface-soft)] text-[var(--ink-muted)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {visibleAchievements.length === 0 ? (
        <div className="inkbound-panel rounded-3xl px-6 py-14 text-center">
          <Award className="mx-auto h-10 w-10 text-[var(--ink-gold)] opacity-70" />
          <h2 className="mt-4 font-serif text-2xl font-bold text-[var(--ink-ivory)]">Your first achievement path is waiting</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--ink-muted)]">
            Read, finish books, track sessions, save quotes, and write reviews in Inkbound. New achievement paths reveal themselves as soon as you begin making progress.
          </p>
        </div>
      ) : (
        <ResponsiveGrid minItemWidth={260} maxColumns={3} gap={16} alignItems="stretch">
          {visibleAchievements.map((achievement) => {
            const Icon = achievement.icon;
            const unlocked = achievement.progress >= achievement.target;
            const progress = Math.min(achievement.progress, achievement.target);
            const percent = Math.min(
              100,
              Math.max(0, Math.round((progress / achievement.target) * 100)),
            );
            const unlockDate = unlocked ? safeUnlockDates[achievement.id] : undefined;
            const parsedUnlockDate = unlockDate ? new Date(unlockDate) : null;
            const formattedUnlockDate =
              parsedUnlockDate && !Number.isNaN(parsedUnlockDate.getTime())
                ? parsedUnlockDate.toLocaleDateString()
                : null;

            return (
              <article
                key={achievement.id}
                className={`inkbound-panel flex min-h-64 flex-col rounded-3xl p-5 transition ${
                  unlocked ? 'ring-1 ring-[rgba(197,160,89,0.38)]' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div
                    className={`grid h-14 w-14 place-items-center rounded-2xl border ${
                      unlocked
                        ? 'border-[rgba(197,160,89,0.45)] bg-[rgba(197,160,89,0.14)] text-[var(--ink-gold-bright)]'
                        : 'border-[var(--ink-border)] bg-[var(--ink-surface-soft)] text-[var(--ink-gold)]'
                    }`}
                  >
                    <Icon className="h-7 w-7" />
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                      {achievement.category}
                    </span>
                    {!unlocked && (
                      <span className="rounded-full border border-[var(--ink-border-strong)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-gold-bright)]">
                        In progress
                      </span>
                    )}
                  </div>
                </div>

                <h2 className="mt-5 font-serif text-xl font-bold text-[var(--ink-ivory)]">{achievement.title}</h2>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">{achievement.description}</p>

                <div className="mt-auto pt-6">
                  <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
                    <span>
                      {progress.toLocaleString()} / {achievement.target.toLocaleString()} {achievement.unit}
                    </span>
                    <strong className="text-[var(--ink-ivory)]">{percent}%</strong>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,var(--ink-gold),var(--ink-gold-bright))] transition-all"
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  {unlocked ? (
                    <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-[var(--ink-gold-bright)]">
                      <Check className="h-4 w-4" />
                      Unlocked{formattedUnlockDate ? ` ${formattedUnlockDate}` : ''}
                    </p>
                  ) : (
                    <p className="mt-4 text-xs font-semibold text-[var(--ink-muted)]">
                      Keep going — this is your next milestone.
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </ResponsiveGrid>
      )}
    </div>
  );
};
