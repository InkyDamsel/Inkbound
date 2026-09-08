import React, { useEffect, useMemo, useState } from 'react';
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
import { getActiveEdition } from '../features/reading/bookReadingState';
import {
  getReadingStreak,
  getSessionDurationMinutes,
  getSessionListeningMinutes,
  getSessionPagesRead,
  localDateKey,
} from '../features/reading/sessionAnalytics';
import { isInkboundFinishedBook, isInkboundStartedBook } from '../features/reading/inkboundActivity';
import {
  BankMetric,
  buildMonthlyRotation,
  CHALLENGE_BANK,
  ChallengeRotationState,
  findBankTemplate,
} from '../features/challenges/challengeBank';
import { ACCOUNT_DATA_STORAGE_KEYS } from '../features/sync/storageKeys';

interface ReadingChallengesScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

type ChallengeKind = 'core' | 'rotating' | 'seasonal' | 'custom';
type ChallengeFilter = 'active' | 'featured' | 'custom' | 'completed' | 'all';
type ChallengeMetric = 'books' | 'pages' | 'minutes' | 'days' | 'listening';

type IconType = React.ComponentType<{ className?: string }>;

interface ChallengeDefinition {
  id: string;
  baseId?: string;
  title: string;
  description: string;
  target: number;
  unit: string;
  icon: IconType;
  progress: number;
  kind: ChallengeKind;
  badge?: string;
  startMonthKey?: string;
  metric?: BankMetric;
  genrePattern?: string;
}

interface CustomChallenge {
  id: string;
  title: string;
  target: number;
  metric: ChallengeMetric;
  createdAt: string;
}

interface JoinedChallengeSnapshot {
  id: string;
  baseId: string;
  title: string;
  description: string;
  target: number;
  unit: string;
  kind: 'rotating' | 'seasonal';
  badge?: string;
  startMonthKey: string;
  metric: BankMetric;
  iconKey: keyof typeof iconMap;
  genrePattern?: string;
}

const iconMap = {
  book: BookOpenCheck,
  calendar: CalendarDays,
  headphones: Headphones,
  pages: LibraryBig,
  clock: Clock3,
  sparkles: Sparkles,
  flame: Flame,
  trophy: Trophy,
} as const;

const clampProgress = (progress: number, target: number) => Math.min(target, Math.max(0, progress));
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const monthStart = (key: string) => `${key}-01`;
const onOrAfter = (value: string | undefined, key: string) => Boolean(value && value >= monthStart(key));

const metricUnit: Record<ChallengeMetric, string> = {
  books: 'books',
  pages: 'pages',
  minutes: 'minutes',
  days: 'reading days',
  listening: 'minutes listened',
};

const makeInitialRotation = (key: string): ChallengeRotationState => buildMonthlyRotation(key);

export const ReadingChallengesScreen: React.FC<ReadingChallengesScreenProps> = ({ books, sessions }) => {
  const now = new Date();
  const currentMonthKey = monthKey(now);
  const currentMonthLabel = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [joinedChallengeIds, setJoinedChallengeIds] = usePersistentState<string[]>(
    ACCOUNT_DATA_STORAGE_KEYS.joinedChallenges,
    ['finish-five', 'read-seven-days', 'thousand-pages'],
  );
  const [customChallenges, setCustomChallenges] = usePersistentState<CustomChallenge[]>(
    ACCOUNT_DATA_STORAGE_KEYS.customChallenges,
    [],
  );
  const [rotation, setRotation] = usePersistentState<ChallengeRotationState>(
    ACCOUNT_DATA_STORAGE_KEYS.challengeRotation,
    makeInitialRotation(currentMonthKey),
  );
  const [joinedSnapshots, setJoinedSnapshots] = usePersistentState<JoinedChallengeSnapshot[]>(
    ACCOUNT_DATA_STORAGE_KEYS.joinedChallengeSnapshots,
    [],
  );
  const [filter, setFilter] = useState<ChallengeFilter>('active');
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customTarget, setCustomTarget] = useState('5');
  const [customMetric, setCustomMetric] = useState<ChallengeMetric>('books');

  useEffect(() => {
    if (rotation.monthKey === currentMonthKey) return;
    setRotation(buildMonthlyRotation(currentMonthKey, rotation.seen, rotation.previous));
  }, [currentMonthKey, rotation, setRotation]);

  const challenges = useMemo<ChallengeDefinition[]>(() => {
    const completedSessions = sessions.filter((session) => getSessionDurationMinutes(session) > 0);
    const trackedBookIds = new Set(completedSessions.map((session) => session.bookId));
    const finishedBooks = books.filter((book) => isInkboundFinishedBook(book, trackedBookIds));
    const uniqueSessionDays = new Set(completedSessions.map((session) => session.date).filter(Boolean)).size;
    const pagesRead = completedSessions.reduce((total, session) => total + getSessionPagesRead(session), 0);
    const totalReadingMinutes = completedSessions.reduce((total, session) => total + getSessionDurationMinutes(session), 0);
    const totalListeningMinutes = completedSessions.reduce((total, session) => total + getSessionListeningMinutes(session), 0);
    const audiobookBooks = finishedBooks.filter((book) => getActiveEdition(book)?.format === 'audiobook').length;
    const longBooksFinished = finishedBooks.filter((book) => (getActiveEdition(book)?.pageCount ?? 0) >= 500).length;
    const currentStreak = getReadingStreak(completedSessions, localDateKey());

    const core: ChallengeDefinition[] = [
      { id: 'finish-five', title: 'Five Books Finished', description: 'Complete five books and build momentum on your reading year.', target: 5, unit: 'books', icon: BookOpenCheck, progress: finishedBooks.length, kind: 'core' },
      { id: 'read-seven-days', title: 'Seven Reading Days', description: 'Complete reading sessions on seven different days.', target: 7, unit: 'days', icon: CalendarDays, progress: uniqueSessionDays, kind: 'core' },
      { id: 'thousand-pages', title: 'The Thousand Page Journey', description: 'Read a total of 1,000 tracked pages across completed sessions.', target: 1000, unit: 'pages', icon: LibraryBig, progress: pagesRead, kind: 'core' },
      { id: 'audio-explorer', title: 'Audiobook Explorer', description: 'Finish your first audiobook.', target: 1, unit: 'audiobook', icon: Headphones, progress: audiobookBooks, kind: 'core' },
      { id: 'epic-reader', title: 'Epic Reader', description: 'Finish an active edition with at least 500 pages.', target: 1, unit: 'epic book', icon: Trophy, progress: longBooksFinished, kind: 'core' },
      { id: 'seven-day-streak', title: 'Seven-Day Spark', description: 'Build a seven-day reading streak from tracked Inkbound sessions.', target: 7, unit: 'streak days', icon: Flame, progress: currentStreak, kind: 'core' },
    ];

    const progressFor = (metric: BankMetric, startKey: string, genrePattern?: string) => {
      const scopedSessions = completedSessions.filter((session) => onOrAfter(session.date, startKey));
      const scopedTrackedBookIds = new Set(scopedSessions.map((session) => session.bookId));
      const scopedFinished = finishedBooks.filter((book) => onOrAfter(book.dateFinished, startKey));
      switch (metric) {
        case 'pages': return scopedSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
        case 'days': return new Set(scopedSessions.map((session) => session.date).filter(Boolean)).size;
        case 'listening': return scopedSessions.reduce((sum, session) => sum + getSessionListeningMinutes(session), 0);
        case 'minutes': return scopedSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
        case 'sessions': return scopedSessions.length;
        case 'genres': return new Set(scopedFinished.flatMap((book) => book.work.genres ?? []).filter(Boolean)).size;
        case 'physical': return scopedFinished.filter((book) => ['hardcover', 'paperback'].includes(getActiveEdition(book)?.format ?? '')).length;
        case 'audiobooks': return scopedFinished.filter((book) => getActiveEdition(book)?.format === 'audiobook').length;
        case 'ebooks': return scopedFinished.filter((book) => getActiveEdition(book)?.format === 'ebook').length;
        case 'long-books': return scopedFinished.filter((book) => (getActiveEdition(book)?.pageCount ?? 0) >= 500).length;
        case 'started-books': return books.filter((book) => onOrAfter(book.dateStarted, startKey) && isInkboundStartedBook(book, scopedTrackedBookIds)).length;
        case 'books':
        default:
          return genrePattern
            ? scopedFinished.filter((book) => (book.work.genres ?? []).some((genre) => new RegExp(genrePattern, 'i').test(genre))).length
            : scopedFinished.length;
      }
    };

    const rotationIds = rotation.monthKey === currentMonthKey ? rotation.selections : [];
    const rotating: ChallengeDefinition[] = rotationIds.flatMap((baseId) => {
      const template = findBankTemplate(baseId);
      if (!template) return [];
      return [{
        id: `${template.id}:${currentMonthKey}`,
        baseId: template.id,
        title: template.title,
        description: `${template.description} This month's challenge only rotates away if you never join it.`,
        target: template.target,
        unit: template.unit,
        icon: iconMap[template.icon],
        progress: progressFor(template.metric, currentMonthKey),
        kind: 'rotating' as const,
        badge: currentMonthLabel,
        startMonthKey: currentMonthKey,
        metric: template.metric,
      }];
    });

    const seasonal: ChallengeDefinition[] = [];
    const addSeasonal = (baseId: string, title: string, description: string, target: number, unit: string, metric: BankMetric, icon: IconType, badge: string, genrePattern?: string) => {
      seasonal.push({
        id: `${baseId}:${year}:${month}`,
        baseId,
        title,
        description,
        target,
        unit,
        icon,
        progress: progressFor(metric, currentMonthKey, genrePattern),
        kind: 'seasonal',
        badge,
        startMonthKey: currentMonthKey,
        metric,
        genrePattern,
      });
    };

    if ([12, 1, 2].includes(month)) addSeasonal(`winter-${year}`, 'Winter Reading Retreat', 'Settle in and finish three books during this winter reading window.', 3, 'books', 'books', Sparkles, 'Winter');
    if ([3, 4, 5].includes(month)) addSeasonal(`spring-${year}`, 'Spring Shelf Refresh', 'Read on twelve different days and bring fresh momentum to your shelf.', 12, 'days', 'days', CalendarDays, 'Spring');
    if ([6, 7, 8].includes(month)) addSeasonal(`summer-${year}`, 'Summer Reading Escape', 'Finish five books during the summer reading season.', 5, 'books', 'books', BookOpenCheck, 'Summer');
    if ([9, 10, 11].includes(month)) addSeasonal(`autumn-${year}`, 'Cozy Fall Reading', 'Read 1,500 tracked pages during cozy reading season.', 1500, 'pages', 'pages', LibraryBig, 'Fall');
    if (month === 1) addSeasonal(`new-year-${year}`, 'Fresh Chapter', 'Start three new books to open the reading year.', 3, 'books started', 'started-books', Flame, 'New Year');
    if (month === 2) addSeasonal(`valentine-${year}`, 'Love at First Chapter', 'Finish two romance reads during February.', 2, 'books', 'books', Award, "Valentine's", 'romance');
    if (month === 10) addSeasonal(`spooky-${year}`, 'Spooky Season', 'Finish three horror, thriller, or mystery reads during October.', 3, 'books', 'books', Flame, 'October', 'horror|thriller|mystery');
    if (month === 12) addSeasonal(`year-end-${year}`, 'End-of-Year Shelf Sweep', 'Finish three books before the year closes.', 3, 'books', 'books', Trophy, 'Year End');

    const currentIds = new Set([...rotating, ...seasonal].map((challenge) => challenge.id));
    const carried: ChallengeDefinition[] = joinedSnapshots
      .filter((snapshot) => joinedChallengeIds.includes(snapshot.id) && !currentIds.has(snapshot.id))
      .map((snapshot) => ({
        id: snapshot.id,
        baseId: snapshot.baseId,
        title: snapshot.title,
        description: `${snapshot.description} You started this challenge earlier, so Inkbound kept it active instead of rotating it away.`,
        target: snapshot.target,
        unit: snapshot.unit,
        icon: iconMap[snapshot.iconKey],
        progress: progressFor(snapshot.metric, snapshot.startMonthKey, snapshot.genrePattern),
        kind: snapshot.kind,
        badge: snapshot.badge ? `${snapshot.badge} · In progress` : 'In progress',
        startMonthKey: snapshot.startMonthKey,
        metric: snapshot.metric,
        genrePattern: snapshot.genrePattern,
      }));

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

    return [...core, ...carried, ...rotating, ...seasonal, ...custom];
  }, [books, currentMonthKey, currentMonthLabel, customChallenges, joinedChallengeIds, joinedSnapshots, month, rotation, sessions, year]);

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

  const toggleChallenge = (challenge: ChallengeDefinition) => {
    const joined = joinedChallengeIds.includes(challenge.id);
    if (joined) {
      setJoinedChallengeIds((current) => current.filter((id) => id !== challenge.id));
      return;
    }

    setJoinedChallengeIds((current) => [...current, challenge.id]);
    if ((challenge.kind === 'rotating' || challenge.kind === 'seasonal') && challenge.baseId && challenge.metric && challenge.startMonthKey) {
      const iconEntry = (Object.entries(iconMap) as Array<[keyof typeof iconMap, IconType]>).find(([, Icon]) => Icon === challenge.icon);
      const snapshot: JoinedChallengeSnapshot = {
        id: challenge.id,
        baseId: challenge.baseId,
        title: challenge.title,
        description: challenge.description.replace(" This month's challenge only rotates away if you never join it.", ''),
        target: challenge.target,
        unit: challenge.unit,
        kind: challenge.kind,
        badge: challenge.badge,
        startMonthKey: challenge.startMonthKey,
        metric: challenge.metric,
        iconKey: iconEntry?.[0] ?? 'sparkles',
        genrePattern: challenge.genrePattern,
      };
      setJoinedSnapshots((current) => current.some((item) => item.id === snapshot.id) ? current : [...current, snapshot]);
    }
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
              Inkbound quietly rotates a deep challenge bank every month, adds seasonal and holiday events, and keeps anything you actually start. Unstarted monthly challenges move aside for something fresh.
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
          <div><p className="inkbound-kicker">Challenge Library</p><h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Choose what inspires you</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">{CHALLENGE_BANK.length} rotating challenge ideas live behind the scenes, plus seasonal and holiday events.</p></div>
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
                    <div className="mt-5 flex gap-2"><button type="button" onClick={() => toggleChallenge(challenge)} className={`min-h-11 flex-1 rounded-xl border px-4 text-sm font-semibold transition ${joined ? 'border-[var(--ink-border)] text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]' : 'border-[var(--ink-border-strong)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]'}`}>{joined ? 'Leave challenge' : 'Join challenge'}</button>{challenge.kind === 'custom' && <button type="button" onClick={() => deleteCustomChallenge(challenge.id)} className="min-h-11 rounded-xl border border-[var(--ink-border)] px-3 text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]" aria-label={`Delete ${challenge.title}`}><X className="h-4 w-4" /></button>}</div>
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