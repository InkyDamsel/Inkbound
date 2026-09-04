import React, { useMemo, useState } from 'react';
import {
  Award,
  BookOpenCheck,
  CalendarDays,
  Check,
  Clock3,
  Flame,
  Headphones,
  LibraryBig,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { ResponsiveGrid } from '../layout/responsive';
import {
  getReadingStreak,
  getSessionDurationMinutes,
  getSessionListeningMinutes,
  getSessionPagesRead,
  localDateKey,
} from '../features/reading/sessionAnalytics';

interface ReadingChallengesScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

type ChallengeKind = 'core' | 'monthly';
type ChallengeFilter = 'active' | 'monthly' | 'completed' | 'all';

interface ChallengeDefinition {
  id: string;
  title: string;
  description: string;
  target: number;
  unit: string;
  icon: React.ComponentType<{ className?: string }>;
  progress: number;
  kind: ChallengeKind;
  monthLabel?: string;
}

const clampProgress = (progress: number, target: number) => Math.min(target, Math.max(0, progress));

const getActiveEdition = (book: UserBookRecord) =>
  book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const hasMonthPrefix = (value: string | undefined, prefix: string) => Boolean(value?.startsWith(prefix));

export const ReadingChallengesScreen: React.FC<ReadingChallengesScreenProps> = ({ books, sessions }) => {
  const now = new Date();
  const currentMonthKey = monthKey(now);
  const currentMonthLabel = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const currentMonthIndex = now.getMonth();
  const currentMonthlyChallengeId = `monthly-${currentMonthKey}`;

  const [joinedChallengeIds, setJoinedChallengeIds] = usePersistentState<string[]>(
    'inkbound_joined_challenges',
    ['finish-five', 'read-seven-days', 'thousand-pages'],
  );
  const [filter, setFilter] = useState<ChallengeFilter>('active');

  const challenges = useMemo<ChallengeDefinition[]>(() => {
    const finishedBooks = books.filter((book) => book.status === 'finished');
    const completedSessions = sessions.filter((session) => getSessionDurationMinutes(session) > 0);
    const uniqueSessionDays = new Set(completedSessions.map((session) => session.date).filter(Boolean)).size;
    const pagesRead = completedSessions.reduce((total, session) => total + getSessionPagesRead(session), 0);
    const totalReadingMinutes = completedSessions.reduce((total, session) => total + getSessionDurationMinutes(session), 0);
    const totalListeningMinutes = completedSessions.reduce((total, session) => total + getSessionListeningMinutes(session), 0);
    const audiobookBooks = finishedBooks.filter((book) => getActiveEdition(book)?.format === 'audiobook').length;
    const physicalBooks = finishedBooks.filter((book) => ['hardcover', 'paperback'].includes(getActiveEdition(book)?.format ?? '')).length;
    const longBooksFinished = finishedBooks.filter((book) => (getActiveEdition(book)?.pageCount ?? 0) >= 500).length;
    const activeBooksStarted = books.filter(
      (book) => book.status === 'currently-reading' && Boolean(book.dateStarted),
    ).length;
    const finishedGenres = new Set(finishedBooks.flatMap((book) => book.work.genres ?? []).filter(Boolean)).size;
    const currentStreak = getReadingStreak(completedSessions, localDateKey());

    const monthlySessions = completedSessions.filter((session) => hasMonthPrefix(session.date, currentMonthKey));
    const monthlyFinishedBooks = finishedBooks.filter((book) => hasMonthPrefix(book.dateFinished, currentMonthKey));
    const monthlyPages = monthlySessions.reduce((total, session) => total + getSessionPagesRead(session), 0);
    const monthlyMinutes = monthlySessions.reduce((total, session) => total + getSessionDurationMinutes(session), 0);
    const monthlyListening = monthlySessions.reduce((total, session) => total + getSessionListeningMinutes(session), 0);
    const monthlyDays = new Set(monthlySessions.map((session) => session.date).filter(Boolean)).size;
    const monthlyFormats = new Set(monthlyFinishedBooks.map((book) => getActiveEdition(book)?.format).filter(Boolean)).size;
    const monthlyGenres = new Set(monthlyFinishedBooks.flatMap((book) => book.work.genres ?? []).filter(Boolean)).size;

    const monthlyDefinitions: Array<Omit<ChallengeDefinition, 'id' | 'kind' | 'monthLabel'>> = [
      { title: 'Fresh Start Five', description: 'Finish five books during January.', target: 5, unit: 'books', icon: BookOpenCheck, progress: monthlyFinishedBooks.length },
      { title: 'February Reading Dates', description: 'Read on ten different days during February.', target: 10, unit: 'days', icon: CalendarDays, progress: monthlyDays },
      { title: 'March Through 1,500', description: 'Read 1,500 tracked pages during March.', target: 1500, unit: 'pages', icon: LibraryBig, progress: monthlyPages },
      { title: 'April Reading Hours', description: 'Spend ten tracked hours reading during April.', target: 600, unit: 'minutes', icon: Clock3, progress: monthlyMinutes },
      { title: 'May Format Mix', description: 'Finish books in three different formats during May.', target: 3, unit: 'formats', icon: Sparkles, progress: monthlyFormats },
      { title: 'June Genre Hop', description: 'Finish books across four different genres during June.', target: 4, unit: 'genres', icon: LibraryBig, progress: monthlyGenres },
      { title: 'July Reading Run', description: 'Read on fifteen different days during July.', target: 15, unit: 'days', icon: Flame, progress: monthlyDays },
      { title: 'August Page Turner', description: 'Read 2,000 tracked pages during August.', target: 2000, unit: 'pages', icon: BookOpenCheck, progress: monthlyPages },
      { title: 'September Shelf Sweep', description: 'Finish four books during September.', target: 4, unit: 'books', icon: Trophy, progress: monthlyFinishedBooks.length },
      { title: 'October After Dark', description: 'Spend eight tracked hours reading during October.', target: 480, unit: 'minutes', icon: Clock3, progress: monthlyMinutes },
      { title: 'November Listen-In', description: 'Listen to five tracked audiobook hours during November.', target: 300, unit: 'minutes listened', icon: Headphones, progress: monthlyListening },
      { title: 'December Finish Line', description: 'Finish six books before the year closes.', target: 6, unit: 'books', icon: Award, progress: monthlyFinishedBooks.length },
    ];

    const monthly = monthlyDefinitions[currentMonthIndex];

    return [
      {
        id: 'finish-five',
        title: 'Five Books Finished',
        description: 'Complete five books and build momentum on your reading year.',
        target: 5,
        unit: 'books',
        icon: BookOpenCheck,
        progress: finishedBooks.length,
        kind: 'core',
      },
      {
        id: 'read-seven-days',
        title: 'Seven Reading Days',
        description: 'Complete reading sessions on seven different days.',
        target: 7,
        unit: 'days',
        icon: CalendarDays,
        progress: uniqueSessionDays,
        kind: 'core',
      },
      {
        id: 'thousand-pages',
        title: 'The Thousand Page Journey',
        description: 'Read a total of 1,000 tracked pages across completed sessions.',
        target: 1000,
        unit: 'pages',
        icon: LibraryBig,
        progress: pagesRead,
        kind: 'core',
      },
      {
        id: 'ten-reading-hours',
        title: 'Ten Hours Together',
        description: 'Spend ten tracked hours reading in Inkbound.',
        target: 600,
        unit: 'minutes',
        icon: Clock3,
        progress: totalReadingMinutes,
        kind: 'core',
      },
      {
        id: 'audio-explorer',
        title: 'Audiobook Explorer',
        description: 'Finish your first audiobook.',
        target: 1,
        unit: 'audiobook',
        icon: Headphones,
        progress: audiobookBooks,
        kind: 'core',
      },
      {
        id: 'audio-hours',
        title: 'Ten Hours in Your Ears',
        description: 'Log ten hours of audiobook listening time.',
        target: 600,
        unit: 'minutes listened',
        icon: Headphones,
        progress: totalListeningMinutes,
        kind: 'core',
      },
      {
        id: 'epic-reader',
        title: 'Epic Reader',
        description: 'Finish an active edition with at least 500 pages.',
        target: 1,
        unit: 'epic book',
        icon: Trophy,
        progress: longBooksFinished,
        kind: 'core',
      },
      {
        id: 'physical-stack',
        title: 'Off the Physical Stack',
        description: 'Finish three hardcover or paperback books.',
        target: 3,
        unit: 'physical books',
        icon: BookOpenCheck,
        progress: physicalBooks,
        kind: 'core',
      },
      {
        id: 'genre-sampler',
        title: 'Genre Sampler',
        description: 'Finish books across five different genres.',
        target: 5,
        unit: 'genres',
        icon: Sparkles,
        progress: finishedGenres,
        kind: 'core',
      },
      {
        id: 'seven-day-streak',
        title: 'Seven-Day Spark',
        description: 'Build a seven-day reading streak from tracked Inkbound sessions.',
        target: 7,
        unit: 'streak days',
        icon: Flame,
        progress: currentStreak,
        kind: 'core',
      },
      {
        id: 'tbr-breaker',
        title: 'Reading Momentum',
        description: 'Start three books and move them into active reading.',
        target: 3,
        unit: 'books started',
        icon: Flame,
        progress: activeBooksStarted,
        kind: 'core',
      },
      {
        ...monthly,
        id: currentMonthlyChallengeId,
        kind: 'monthly',
        monthLabel: currentMonthLabel,
      },
    ];
  }, [books, currentMonthIndex, currentMonthKey, currentMonthLabel, currentMonthlyChallengeId, sessions]);

  const joinedChallenges = challenges.filter((challenge) => joinedChallengeIds.includes(challenge.id));
  const completedCount = joinedChallenges.filter((challenge) => challenge.progress >= challenge.target).length;
  const inProgressCount = joinedChallenges.filter((challenge) => challenge.progress < challenge.target).length;

  const visibleChallenges = challenges.filter((challenge) => {
    const joined = joinedChallengeIds.includes(challenge.id);
    const completed = challenge.progress >= challenge.target;
    if (filter === 'monthly') return challenge.kind === 'monthly';
    if (filter === 'completed') return joined && completed;
    if (filter === 'active') return joined && !completed;
    return true;
  });

  const toggleChallenge = (challengeId: string) => {
    setJoinedChallengeIds((current) =>
      current.includes(challengeId)
        ? current.filter((id) => id !== challengeId)
        : [...current, challengeId],
    );
  };

  return (
    <div className="space-y-7 pb-24 md:pb-12">
      <section className="inkbound-panel overflow-hidden rounded-3xl p-5 sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-2xl">
            <p className="inkbound-kicker">Your Reading Year</p>
            <h1 className="mt-1 font-serif text-3xl font-bold text-[var(--ink-ivory)] sm:text-4xl">
              Reading Challenges
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
              Join goals that fit your reading life. Progress updates automatically from your canonical books and completed reading sessions, with a fresh challenge each month.
            </p>
          </div>

          <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:min-w-[240px]">
            <div className="min-w-0 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
              <Award className="h-5 w-5 text-[var(--ink-gold)]" />
              <p className="mt-3 font-serif text-3xl font-bold text-[var(--ink-ivory)]">{completedCount}</p>
              <p className="text-xs text-[var(--ink-muted)]">Completed</p>
            </div>
            <div className="min-w-0 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
              <Sparkles className="h-5 w-5 text-[var(--ink-gold)]" />
              <p className="mt-3 font-serif text-3xl font-bold text-[var(--ink-ivory)]">{inProgressCount}</p>
              <p className="text-xs text-[var(--ink-muted)]">In progress</p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inkbound-kicker">Challenge Library</p>
            <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Choose what inspires you</h2>
          </div>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Challenge filters">
            {([
              ['active', 'Active'],
              ['monthly', 'Monthly'],
              ['completed', 'Completed'],
              ['all', 'All Challenges'],
            ] as Array<[ChallengeFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`min-h-10 rounded-full border px-4 text-xs font-semibold transition ${
                  filter === value
                    ? 'border-[var(--ink-gold)] bg-[rgba(197,160,89,0.14)] text-[var(--ink-gold-bright)]'
                    : 'border-[var(--ink-border)] text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {visibleChallenges.length === 0 ? (
          <div className="inkbound-panel rounded-3xl px-6 py-12 text-center">
            <Trophy className="mx-auto h-9 w-9 text-[var(--ink-gold)] opacity-70" />
            <h3 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">
              {filter === 'completed' ? 'No completed challenges yet' : 'No active challenges'}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--ink-muted)]">
              {filter === 'completed'
                ? 'Completed joined challenges will collect here as your reading year grows.'
                : 'Open All Challenges or Monthly and join something that sounds fun.'}
            </p>
          </div>
        ) : (
          <ResponsiveGrid minItemWidth={280} maxColumns={3} gap={16} alignItems="stretch">
            {visibleChallenges.map((challenge) => {
              const Icon = challenge.icon;
              const joined = joinedChallengeIds.includes(challenge.id);
              const progress = clampProgress(challenge.progress, challenge.target);
              const percentage = Math.round((progress / challenge.target) * 100);
              const completed = progress >= challenge.target;

              return (
                <article
                  key={challenge.id}
                  className={`inkbound-panel flex min-h-[315px] min-w-0 flex-col rounded-3xl p-5 transition ${
                    completed && joined ? 'ring-1 ring-[var(--ink-gold)]' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] text-[var(--ink-gold)]">
                      <Icon className="h-6 w-6" />
                    </span>
                    <div className="flex flex-wrap justify-end gap-2">
                      {challenge.kind === 'monthly' && (
                        <span className="rounded-full border border-[var(--ink-border-strong)] px-2.5 py-1 text-[11px] font-bold text-[var(--ink-gold-bright)]">
                          {challenge.monthLabel}
                        </span>
                      )}
                      {completed && joined && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[11px] font-bold text-emerald-500">
                          <Check className="h-3.5 w-3.5" /> Complete
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 className="mt-5 font-serif text-xl font-bold text-[var(--ink-ivory)]">{challenge.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{challenge.description}</p>

                  <div className="mt-auto pt-6">
                    <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-[var(--ink-muted)]">
                      <span className="min-w-0 break-words">
                        {progress.toLocaleString()} of {challenge.target.toLocaleString()} {challenge.unit}
                      </span>
                      <strong className="shrink-0 text-[var(--ink-ivory)]">{percentage}%</strong>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[var(--ink-mauve)] to-[var(--ink-gold)] transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleChallenge(challenge.id)}
                      className={`mt-5 min-h-11 w-full rounded-xl border px-4 text-sm font-semibold transition ${
                        joined
                          ? 'border-[var(--ink-border)] text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]'
                          : 'border-[var(--ink-border-strong)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]'
                      }`}
                    >
                      {joined ? 'Leave challenge' : 'Join challenge'}
                    </button>
                  </div>
                </article>
              );
            })}
          </ResponsiveGrid>
        )}
      </section>
    </div>
  );
};