import React, { useMemo } from 'react';
import {
  Award,
  BookOpenCheck,
  CalendarDays,
  Check,
  Flame,
  Headphones,
  LibraryBig,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { ResponsiveGrid } from '../layout/responsive';

interface ReadingChallengesScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

interface ChallengeDefinition {
  id: string;
  title: string;
  description: string;
  target: number;
  unit: string;
  icon: React.ComponentType<{ className?: string }>;
  progress: number;
}

const clampProgress = (progress: number, target: number) => Math.min(target, Math.max(0, progress));

export const ReadingChallengesScreen: React.FC<ReadingChallengesScreenProps> = ({ books, sessions }) => {
  const [joinedChallengeIds, setJoinedChallengeIds] = usePersistentState<string[]>(
    'inkbound_joined_challenges',
    ['finish-five', 'read-seven-days', 'thousand-pages'],
  );

  const challenges = useMemo<ChallengeDefinition[]>(() => {
    const finishedBooks = books.filter((book) => book.status === 'finished');
    const uniqueSessionDays = new Set(sessions.map((session) => session.date)).size;
    const pagesRead = sessions.reduce((total, session) => total + (session.pagesRead ?? 0), 0);
    const audiobookBooks = finishedBooks.filter((book) => {
      const edition =
        book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
      return edition?.format === 'audiobook';
    }).length;
    const longBooksFinished = finishedBooks.filter((book) =>
      book.editions.some((edition) => (edition.pageCount ?? 0) >= 500),
    ).length;
    const tbrBooksStarted = books.filter(
      (book) => book.status === 'currently-reading' && book.dateAdded,
    ).length;

    return [
      {
        id: 'finish-five',
        title: 'Five Books Finished',
        description: 'Complete five books and build momentum on your reading year.',
        target: 5,
        unit: 'books',
        icon: BookOpenCheck,
        progress: finishedBooks.length,
      },
      {
        id: 'read-seven-days',
        title: 'Seven Reading Days',
        description: 'Record reading sessions on seven different days.',
        target: 7,
        unit: 'days',
        icon: CalendarDays,
        progress: uniqueSessionDays,
      },
      {
        id: 'thousand-pages',
        title: 'The Thousand Page Journey',
        description: 'Read a total of 1,000 pages across your logged sessions.',
        target: 1000,
        unit: 'pages',
        icon: LibraryBig,
        progress: pagesRead,
      },
      {
        id: 'audio-explorer',
        title: 'Audiobook Explorer',
        description: 'Finish your first audiobook.',
        target: 1,
        unit: 'audiobook',
        icon: Headphones,
        progress: audiobookBooks,
      },
      {
        id: 'epic-reader',
        title: 'Epic Reader',
        description: 'Finish a book with at least 500 pages.',
        target: 1,
        unit: 'epic book',
        icon: Trophy,
        progress: longBooksFinished,
      },
      {
        id: 'tbr-breaker',
        title: 'TBR Breaker',
        description: 'Move three books from waiting on your TBR into active reading.',
        target: 3,
        unit: 'books started',
        icon: Flame,
        progress: tbrBooksStarted,
      },
    ];
  }, [books, sessions]);

  const joinedChallenges = challenges.filter((challenge) => joinedChallengeIds.includes(challenge.id));
  const completedCount = joinedChallenges.filter(
    (challenge) => challenge.progress >= challenge.target,
  ).length;

  const toggleChallenge = (challengeId: string) => {
    setJoinedChallengeIds((current) =>
      current.includes(challengeId)
        ? current.filter((id) => id !== challengeId)
        : [...current, challengeId],
    );
  };

  return (
    <div className="space-y-7 pb-24 md:pb-12">
      <section className="inkbound-panel overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <p className="inkbound-kicker">Your Reading Year</p>
            <h1 className="mt-1 font-serif text-3xl font-bold text-[var(--ink-ivory)] sm:text-4xl">
              Reading Challenges
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
              Join challenges that fit your reading life. Progress updates automatically from your
              books and reading sessions, and your selections are saved across refreshes and cloud sync.
            </p>
          </div>

          <div className="grid min-w-[240px] grid-cols-2 gap-3">
            <div className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
              <Award className="h-5 w-5 text-[var(--ink-gold)]" />
              <p className="mt-3 font-serif text-3xl font-bold text-[var(--ink-ivory)]">
                {completedCount}
              </p>
              <p className="text-xs text-[var(--ink-muted)]">Completed</p>
            </div>
            <div className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
              <Sparkles className="h-5 w-5 text-[var(--ink-gold)]" />
              <p className="mt-3 font-serif text-3xl font-bold text-[var(--ink-ivory)]">
                {joinedChallenges.length}
              </p>
              <p className="text-xs text-[var(--ink-muted)]">In progress</p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="inkbound-kicker">Challenge Library</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">
            Choose what inspires you
          </h2>
        </div>

        <ResponsiveGrid minItemWidth={280} maxColumns={3} gap={16} alignItems="stretch">
          {challenges.map((challenge) => {
            const Icon = challenge.icon;
            const joined = joinedChallengeIds.includes(challenge.id);
            const progress = clampProgress(challenge.progress, challenge.target);
            const percentage = Math.round((progress / challenge.target) * 100);
            const completed = progress >= challenge.target;

            return (
              <article
                key={challenge.id}
                className={`inkbound-panel flex min-h-[300px] flex-col rounded-3xl p-5 transition ${
                  completed ? 'ring-1 ring-[var(--ink-gold)]' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] text-[var(--ink-gold)]">
                    <Icon className="h-6 w-6" />
                  </span>
                  {completed && joined && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[11px] font-bold text-emerald-500">
                      <Check className="h-3.5 w-3.5" /> Complete
                    </span>
                  )}
                </div>

                <h3 className="mt-5 font-serif text-xl font-bold text-[var(--ink-ivory)]">
                  {challenge.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                  {challenge.description}
                </p>

                <div className="mt-auto pt-6">
                  <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
                    <span>
                      {progress.toLocaleString()} of {challenge.target.toLocaleString()} {challenge.unit}
                    </span>
                    <strong className="text-[var(--ink-ivory)]">{percentage}%</strong>
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
      </section>
    </div>
  );
};
