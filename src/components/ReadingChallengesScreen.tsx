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
  Plus,
  Sparkles,
  Trophy,
  X,
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

type ChallengeKind = 'core' | 'rotating' | 'seasonal' | 'custom';
type ChallengeFilter = 'active' | 'featured' | 'custom' | 'completed' | 'all';
type ChallengeMetric = 'books' | 'pages' | 'minutes' | 'days' | 'listening';

interface ChallengeDefinition {
  id: string;
  title: string;
  description: string;
  target: number;
  unit: string;
  icon: React.ComponentType<{ className?: string }>;
  progress: number;
  kind: ChallengeKind;
  badge?: string;
}

interface CustomChallenge {
  id: string;
  title: string;
  target: number;
  metric: ChallengeMetric;
  createdAt: string;
}

const clampProgress = (progress: number, target: number) => Math.min(target, Math.max(0, progress));
const getActiveEdition = (book: UserBookRecord) =>
  book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const hasMonthPrefix = (value: string | undefined, prefix: string) => Boolean(value?.startsWith(prefix));

const metricUnit: Record<ChallengeMetric, string> = {
  books: 'books',
  pages: 'pages',
  minutes: 'minutes',
  days: 'reading days',
  listening: 'minutes listened',
};

export const ReadingChallengesScreen: React.FC<ReadingChallengesScreenProps> = ({ books, sessions }) => {
  const now = new Date();
  const currentMonthKey = monthKey(now);
  const currentMonthLabel = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [joinedChallengeIds, setJoinedChallengeIds] = usePersistentState<string[]>(
    'inkbound_joined_challenges',
    ['finish-five', 'read-seven-days', 'thousand-pages'],
  );
  const [customChallenges, setCustomChallenges] = usePersistentState<CustomChallenge[]>(
    'inkbound_custom_challenges_v1',
    [],
  );
  const [filter, setFilter] = useState<ChallengeFilter>('active');
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customTarget, setCustomTarget] = useState('5');
  const [customMetric, setCustomMetric] = useState<ChallengeMetric>('books');

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
    const activeBooksStarted = books.filter((book) => book.status === 'currently-reading' && Boolean(book.dateStarted)).length;
    const finishedGenres = new Set(finishedBooks.flatMap((book) => book.work.genres ?? []).filter(Boolean)).size;
    const currentStreak = getReadingStreak(completedSessions, localDateKey());

    const monthlySessions = completedSessions.filter((session) => hasMonthPrefix(session.date, currentMonthKey));
    const monthlyFinishedBooks = finishedBooks.filter((book) => hasMonthPrefix(book.dateFinished, currentMonthKey));
    const monthlyPages = monthlySessions.reduce((total, session) => total + getSessionPagesRead(session), 0);
    const monthlyMinutes = monthlySessions.reduce((total, session) => total + getSessionDurationMinutes(session), 0);
    const monthlyListening = monthlySessions.reduce((total, session) => total + getSessionListeningMinutes(session), 0);
    const monthlyDays = new Set(monthlySessions.map((session) => session.date).filter(Boolean)).size;
    const monthlyGenres = new Set(monthlyFinishedBooks.flatMap((book) => book.work.genres ?? []).filter(Boolean)).size;

    const core: ChallengeDefinition[] = [
      { id: 'finish-five', title: 'Five Books Finished', description: 'Complete five books and build momentum on your reading year.', target: 5, unit: 'books', icon: BookOpenCheck, progress: finishedBooks.length, kind: 'core' },
      { id: 'read-seven-days', title: 'Seven Reading Days', description: 'Complete reading sessions on seven different days.', target: 7, unit: 'days', icon: CalendarDays, progress: uniqueSessionDays, kind: 'core' },
      { id: 'thousand-pages', title: 'The Thousand Page Journey', description: 'Read a total of 1,000 tracked pages across completed sessions.', target: 1000, unit: 'pages', icon: LibraryBig, progress: pagesRead, kind: 'core' },
      { id: 'audio-explorer', title: 'Audiobook Explorer', description: 'Finish your first audiobook.', target: 1, unit: 'audiobook', icon: Headphones, progress: audiobookBooks, kind: 'core' },
      { id: 'epic-reader', title: 'Epic Reader', description: 'Finish an active edition with at least 500 pages.', target: 1, unit: 'epic book', icon: Trophy, progress: longBooksFinished, kind: 'core' },
      { id: 'seven-day-streak', title: 'Seven-Day Spark', description: 'Build a seven-day reading streak from tracked Inkbound sessions.', target: 7, unit: 'streak days', icon: Flame, progress: currentStreak, kind: 'core' },
    ];

    const bank: ChallengeDefinition[] = [
      { id: 'bank-page-turner', title: 'Page Turner', description: 'Read 1,500 pages this month.', target: 1500, unit: 'pages', icon: LibraryBig, progress: monthlyPages, kind: 'rotating' },
      { id: 'bank-reading-dates', title: 'Reading Dates', description: 'Read on ten different days this month.', target: 10, unit: 'days', icon: CalendarDays, progress: monthlyDays, kind: 'rotating' },
      { id: 'bank-listening-hours', title: 'Listening Hours', description: 'Listen to five audiobook hours this month.', target: 300, unit: 'minutes listened', icon: Headphones, progress: monthlyListening, kind: 'rotating' },
      { id: 'bank-shelf-sweep', title: 'Shelf Sweep', description: 'Finish four books this month.', target: 4, unit: 'books', icon: BookOpenCheck, progress: monthlyFinishedBooks.length, kind: 'rotating' },
      { id: 'bank-genre-hop', title: 'Genre Hopper', description: 'Finish books from three different genres this month.', target: 3, unit: 'genres', icon: Sparkles, progress: monthlyGenres, kind: 'rotating' },
      { id: 'bank-reading-hours', title: 'Ten Hours Together', description: 'Spend ten tracked hours reading this month.', target: 600, unit: 'minutes', icon: Clock3, progress: monthlyMinutes, kind: 'rotating' },
      { id: 'bank-physical-stack', title: 'Off the Physical Stack', description: 'Finish three hardcover or paperback books.', target: 3, unit: 'physical books', icon: BookOpenCheck, progress: physicalBooks, kind: 'rotating' },
      { id: 'bank-audio-ten', title: 'Ten Hours in Your Ears', description: 'Log ten hours of audiobook listening.', target: 600, unit: 'minutes listened', icon: Headphones, progress: totalListeningMinutes, kind: 'rotating' },
      { id: 'bank-genre-sampler', title: 'Genre Sampler', description: 'Finish books across five different genres.', target: 5, unit: 'genres', icon: Sparkles, progress: finishedGenres, kind: 'rotating' },
      { id: 'bank-reading-momentum', title: 'Reading Momentum', description: 'Start three books and move them into active reading.', target: 3, unit: 'books started', icon: Flame, progress: activeBooksStarted, kind: 'rotating' },
      { id: 'bank-twenty-hours', title: 'Lost in the Pages', description: 'Spend twenty tracked hours reading.', target: 1200, unit: 'minutes', icon: Clock3, progress: totalReadingMinutes, kind: 'rotating' },
      { id: 'bank-two-thousand', title: 'Two Thousand Pages', description: 'Read 2,000 tracked pages this month.', target: 2000, unit: 'pages', icon: LibraryBig, progress: monthlyPages, kind: 'rotating' },
    ];

    // Deterministic monthly rotation: three adjacent picks shift by four slots each month,
    // so the same challenge cannot reappear in consecutive months.
    const rotationStart = ((year * 12 + month) * 4) % bank.length;
    const rotating = [0, 1, 2].map((offset) => ({
      ...bank[(rotationStart + offset) % bank.length],
      id: `${bank[(rotationStart + offset) % bank.length].id}-${currentMonthKey}`,
      badge: currentMonthLabel,
    }));

    const seasonal: ChallengeDefinition[] = [];
    if ([12, 1, 2].includes(month)) seasonal.push({ id: `winter-reading-${year}-${month}`, title: 'Winter Reading Retreat', description: 'Finish three books during the winter season.', target: 3, unit: 'books', icon: Sparkles, progress: monthlyFinishedBooks.length, kind: 'seasonal', badge: 'Winter' });
    if ([3, 4, 5].includes(month)) seasonal.push({ id: `spring-shelf-${year}-${month}`, title: 'Spring Shelf Refresh', description: 'Read on twelve different days this month.', target: 12, unit: 'days', icon: CalendarDays, progress: monthlyDays, kind: 'seasonal', badge: 'Spring' });
    if ([6, 7, 8].includes(month)) seasonal.push({ id: `summer-reading-${year}-${month}`, title: 'Summer Reading', description: 'Finish five books this month.', target: 5, unit: 'books', icon: BookOpenCheck, progress: monthlyFinishedBooks.length, kind: 'seasonal', badge: 'Summer' });
    if ([9, 10, 11].includes(month)) seasonal.push({ id: `cozy-fall-${year}-${month}`, title: 'Cozy Fall Reading', description: 'Read 1,500 pages this month.', target: 1500, unit: 'pages', icon: LibraryBig, progress: monthlyPages, kind: 'seasonal', badge: 'Fall' });
    if (month === 2) seasonal.push({ id: `valentines-${year}`, title: 'Love at First Chapter', description: 'Finish two romance reads during February.', target: 2, unit: 'books', icon: Award, progress: monthlyFinishedBooks.filter((book) => (book.work.genres ?? []).some((genre) => genre.toLowerCase().includes('romance'))).length, kind: 'seasonal', badge: "Valentine's" });
    if (month === 10) seasonal.push({ id: `spooky-${year}`, title: 'Spooky Season', description: 'Finish three horror, thriller, or mystery reads during October.', target: 3, unit: 'books', icon: Flame, progress: monthlyFinishedBooks.filter((book) => (book.work.genres ?? []).some((genre) => /horror|thriller|mystery/i.test(genre))).length, kind: 'seasonal', badge: 'October' });
    if (month === 12) seasonal.push({ id: `year-end-${year}`, title: 'End-of-Year Shelf Sweep', description: 'Finish three books before the year closes.', target: 3, unit: 'books', icon: Trophy, progress: monthlyFinishedBooks.length, kind: 'seasonal', badge: 'Year End' });

    const metricProgress: Record<ChallengeMetric, number> = {
      books: finishedBooks.length,
      pages: pagesRead,
      minutes: totalReadingMinutes,
      days: uniqueSessionDays,
      listening: totalListeningMinutes,
    };
    const custom: ChallengeDefinition[] = customChallenges.map((challenge) => ({
      id: challenge.id,
      title: challenge.title,
      description: `A personal challenge you created. Goal: ${challenge.target.toLocaleString()} ${metricUnit[challenge.metric]}.`,
      target: challenge.target,
      unit: metricUnit[challenge.metric],
      icon: Sparkles,
      progress: metricProgress[challenge.metric],
      kind: 'custom',
      badge: 'My Challenge',
    }));

    return [...core, ...rotating, ...seasonal, ...custom];
  }, [books, currentMonthKey, currentMonthLabel, customChallenges, month, sessions, year]);

  const joinedChallenges = challenges.filter((challenge) => joinedChallengeIds.includes(challenge.id));
  const completedCount = joinedChallenges.filter((challenge) => challenge.progress >= challenge.target).length;
  const inProgressCount = joinedChallenges.filter((challenge) => challenge.progress < challenge.target).length;

  const visibleChallenges = challenges.filter((challenge) => {
    const joined = joinedChallengeIds.includes(challenge.id);
    const completed = challenge.progress >= challenge.target;
    if (filter === 'featured') return challenge.kind === 'rotating' || challenge.kind === 'seasonal';
    if (filter === 'custom') return challenge.kind === 'custom';
    if (filter === 'completed') return joined && completed;
    if (filter === 'active') return joined && !completed;
    return true;
  });

  const toggleChallenge = (challengeId: string) => {
    setJoinedChallengeIds((current) => current.includes(challengeId) ? current.filter((id) => id !== challengeId) : [...current, challengeId]);
  };

  const createCustomChallenge = () => {
    const target = Math.max(1, Number.parseInt(customTarget, 10) || 1);
    const title = customTitle.trim();
    if (!title) return;
    const id = `custom-${Date.now()}`;
    setCustomChallenges((current) => [...current, { id, title, target, metric: customMetric, createdAt: new Date().toISOString() }]);
    setJoinedChallengeIds((current) => [...current, id]);
    setCustomTitle('');
    setCustomTarget('5');
    setCustomMetric('books');
    setShowCustomForm(false);
    setFilter('active');
  };

  const deleteCustomChallenge = (challengeId: string) => {
    setCustomChallenges((current) => current.filter((challenge) => challenge.id !== challengeId));
    setJoinedChallengeIds((current) => current.filter((id) => id !== challengeId));
  };

  return (
    <div className="space-y-7 pb-24 md:pb-12">
      <section className="inkbound-panel overflow-hidden rounded-3xl p-5 sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-2xl">
            <p className="inkbound-kicker">Your Reading Year</p>
            <h1 className="mt-1 font-serif text-3xl font-bold text-[var(--ink-ivory)] sm:text-4xl">Reading Challenges</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
              Pick from Inkbound's rotating challenge bank, join seasonal events, or make a goal that is completely your own. Progress updates automatically from your books and reading sessions.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:min-w-[240px]">
            <div className="min-w-0 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><Award className="h-5 w-5 text-[var(--ink-gold)]" /><p className="mt-3 font-serif text-3xl font-bold text-[var(--ink-ivory)]">{completedCount}</p><p className="text-xs text-[var(--ink-muted)]">Completed</p></div>
            <div className="min-w-0 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><Sparkles className="h-5 w-5 text-[var(--ink-gold)]" /><p className="mt-3 font-serif text-3xl font-bold text-[var(--ink-ivory)]">{inProgressCount}</p><p className="text-xs text-[var(--ink-muted)]">In progress</p></div>
          </div>
        </div>
      </section>

      {showCustomForm && (
        <section className="inkbound-panel rounded-3xl p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4"><div><p className="inkbound-kicker">My Challenge</p><h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Create your own goal</h2></div><button type="button" onClick={() => setShowCustomForm(false)} className="rounded-xl border border-[var(--ink-border)] p-2 text-[var(--ink-muted)]"><X className="h-5 w-5" /></button></div>
          <div className="mt-5 grid gap-4 md:grid-cols-[1fr_180px_220px_auto] md:items-end">
            <label className="text-xs font-semibold text-[var(--ink-muted)]">Challenge name<input value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} placeholder="Finish my giant TBR" className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]" /></label>
            <label className="text-xs font-semibold text-[var(--ink-muted)]">Target<input type="number" min="1" value={customTarget} onChange={(event) => setCustomTarget(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]" /></label>
            <label className="text-xs font-semibold text-[var(--ink-muted)]">Measure<select value={customMetric} onChange={(event) => setCustomMetric(event.target.value as ChallengeMetric)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]"><option value="books">Books finished</option><option value="pages">Pages read</option><option value="minutes">Reading minutes</option><option value="days">Reading days</option><option value="listening">Audiobook minutes</option></select></label>
            <button type="button" onClick={createCustomChallenge} disabled={!customTitle.trim()} className="min-h-11 rounded-xl border border-[var(--ink-border-strong)] bg-[var(--ink-mauve)] px-5 text-sm font-semibold text-white disabled:opacity-40">Create</button>
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="inkbound-kicker">Challenge Library</p><h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Choose what inspires you</h2></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowCustomForm(true)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--ink-border-strong)] px-4 text-xs font-semibold text-[var(--ink-gold-bright)]"><Plus className="h-4 w-4" /> Custom challenge</button>
            {([['active', 'Active'], ['featured', 'Featured'], ['custom', 'My Challenges'], ['completed', 'Completed'], ['all', 'All Challenges']] as Array<[ChallengeFilter, string]>).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setFilter(value)} className={`min-h-10 rounded-full border px-4 text-xs font-semibold transition ${filter === value ? 'border-[var(--ink-gold)] bg-[rgba(197,160,89,0.14)] text-[var(--ink-gold-bright)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]'}`}>{label}</button>
            ))}
          </div>
        </div>

        {visibleChallenges.length === 0 ? (
          <div className="inkbound-panel rounded-3xl px-6 py-12 text-center"><Trophy className="mx-auto h-9 w-9 text-[var(--ink-gold)] opacity-70" /><h3 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">Nothing here yet</h3><p className="mx-auto mt-2 max-w-md text-sm text-[var(--ink-muted)]">Browse Featured or All Challenges, or create a challenge of your own.</p></div>
        ) : (
          <ResponsiveGrid minItemWidth={280} maxColumns={3} gap={16} alignItems="stretch">
            {visibleChallenges.map((challenge) => {
              const Icon = challenge.icon;
              const joined = joinedChallengeIds.includes(challenge.id);
              const progress = clampProgress(challenge.progress, challenge.target);
              const percentage = Math.round((progress / challenge.target) * 100);
              const completed = progress >= challenge.target;
              return (
                <article key={challenge.id} className={`inkbound-panel flex min-h-[315px] min-w-0 flex-col rounded-3xl p-5 transition ${completed && joined ? 'ring-1 ring-[var(--ink-gold)]' : ''}`}>
                  <div className="flex items-start justify-between gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] text-[var(--ink-gold)]"><Icon className="h-6 w-6" /></span><div className="flex flex-wrap justify-end gap-2">{challenge.badge && <span className="rounded-full border border-[var(--ink-border-strong)] px-2.5 py-1 text-[11px] font-bold text-[var(--ink-gold-bright)]">{challenge.badge}</span>}{completed && joined && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[11px] font-bold text-emerald-500"><Check className="h-3.5 w-3.5" /> Complete</span>}</div></div>
                  <h3 className="mt-5 font-serif text-xl font-bold text-[var(--ink-ivory)]">{challenge.title}</h3><p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{challenge.description}</p>
                  <div className="mt-auto pt-6"><div className="flex min-w-0 items-center justify-between gap-3 text-xs text-[var(--ink-muted)]"><span className="min-w-0 break-words">{progress.toLocaleString()} of {challenge.target.toLocaleString()} {challenge.unit}</span><strong className="shrink-0 text-[var(--ink-ivory)]">{percentage}%</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]"><div className="h-full rounded-full bg-gradient-to-r from-[var(--ink-mauve)] to-[var(--ink-gold)] transition-all" style={{ width: `${percentage}%` }} /></div>
                    <div className="mt-5 flex gap-2"><button type="button" onClick={() => toggleChallenge(challenge.id)} className={`min-h-11 flex-1 rounded-xl border px-4 text-sm font-semibold transition ${joined ? 'border-[var(--ink-border)] text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]' : 'border-[var(--ink-border-strong)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]'}`}>{joined ? 'Leave challenge' : 'Join challenge'}</button>{challenge.kind === 'custom' && <button type="button" onClick={() => deleteCustomChallenge(challenge.id)} className="min-h-11 rounded-xl border border-[var(--ink-border)] px-3 text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]" aria-label={`Delete ${challenge.title}`}><X className="h-4 w-4" /></button>}</div>
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