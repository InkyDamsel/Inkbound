import React, { useMemo } from 'react';
import {
  BarChart3,
  BookOpen,
  Clock3,
  Compass,
  Headphones,
  Lock,
  Moon,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { useUserPlan } from '../context/UserPlanContext';
import { getActiveEdition } from '../features/reading/bookReadingState';
import {
  getSessionDurationMinutes,
  getSessionPagesRead,
  localDateKey,
} from '../features/reading/sessionAnalytics';

type InsightRange = '30-days' | '90-days' | 'all-time';
type InsightCategory = 'all' | 'habits' | 'taste' | 'progress';

interface ReadingInsightsScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

interface InsightCard {
  id: string;
  category: Exclude<InsightCategory, 'all'>;
  eyebrow: string;
  title: string;
  body: string;
  evidence: string;
  icon: React.ComponentType<{ className?: string }>;
}

const rangeDays: Record<InsightRange, number | null> = {
  '30-days': 30,
  '90-days': 90,
  'all-time': null,
};

const parseLocalDateKey = (value?: string): Date | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
};

const getSessionHour = (session: ReadingSession) => {
  const hour = Number(session.startTime?.split(':')[0]);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
};

const mostCommon = (values: string[]) => {
  const counts = new Map<string, number>();
  values.map((value) => value.trim()).filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
};

const percentChange = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
};

const comparisonText = (current: number, previous: number, noun: string) => {
  const change = percentChange(current, previous);
  if (change === null) return `${current} ${noun} now; there were none in the previous period.`;
  if (change === 0) return `${current} ${noun}, unchanged from the previous period.`;
  return `${current} ${noun}, ${Math.abs(change)}% ${change > 0 ? 'higher' : 'lower'} than the previous period (${previous}).`;
};

export const ReadingInsightsScreen: React.FC<ReadingInsightsScreenProps> = ({ books, sessions }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const [range, setRange] = usePersistentState<InsightRange>('inkbound_reading_insights_range', '90-days');
  const [category, setCategory] = usePersistentState<InsightCategory>('inkbound_reading_insights_category', 'all');
  const [dismissedIds, setDismissedIds] = usePersistentState<string[]>('inkbound_reading_insights_dismissed', []);

  const rangeWindow = useMemo(() => {
    const through = parseLocalDateKey(localDateKey())!;
    const days = rangeDays[range];
    if (!days) return { through, cutoff: null as Date | null, previousCutoff: null as Date | null, previousThrough: null as Date | null };
    const cutoff = new Date(through);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const previousThrough = new Date(cutoff);
    previousThrough.setDate(previousThrough.getDate() - 1);
    const previousCutoff = new Date(previousThrough);
    previousCutoff.setDate(previousCutoff.getDate() - (days - 1));
    return { through, cutoff, previousCutoff, previousThrough };
  }, [range]);

  const dateIsInCurrentRange = (value?: string) => {
    const date = parseLocalDateKey(value);
    if (!date || date > rangeWindow.through) return false;
    return rangeWindow.cutoff ? date >= rangeWindow.cutoff : true;
  };

  const dateIsInPreviousRange = (value?: string) => {
    const date = parseLocalDateKey(value);
    if (!date || !rangeWindow.previousCutoff || !rangeWindow.previousThrough) return false;
    return date >= rangeWindow.previousCutoff && date <= rangeWindow.previousThrough;
  };

  const validSessions = useMemo(
    () => sessions.filter((session) => getSessionDurationMinutes(session) > 0 && parseLocalDateKey(session.date) !== null),
    [sessions],
  );
  const filteredSessions = useMemo(() => validSessions.filter((session) => dateIsInCurrentRange(session.date)), [validSessions, rangeWindow]);
  const previousSessions = useMemo(() => validSessions.filter((session) => dateIsInPreviousRange(session.date)), [validSessions, rangeWindow]);

  const insights = useMemo<InsightCard[]>(() => {
    const allTime = range === 'all-time';
    const rangeLabel = allTime ? 'your full history' : 'this period';
    const totalMinutes = filteredSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const previousMinutes = previousSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const avgMinutes = filteredSessions.length ? Math.round(totalMinutes / filteredSessions.length) : 0;
    const previousAvgMinutes = previousSessions.length ? Math.round(previousMinutes / previousSessions.length) : 0;
    const pages = filteredSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const previousPages = previousSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const readingDays = new Set(filteredSessions.map((session) => session.date)).size;
    const previousReadingDays = new Set(previousSessions.map((session) => session.date)).size;

    const timedSessions = filteredSessions.filter((session) => getSessionHour(session) !== null);
    const nightSessions = timedSessions.filter((session) => {
      const hour = getSessionHour(session)!;
      return hour >= 19 || hour < 5;
    });
    const morningSessions = timedSessions.filter((session) => {
      const hour = getSessionHour(session)!;
      return hour >= 5 && hour < 12;
    });
    const preferredTime = nightSessions.length >= morningSessions.length ? 'evening' : 'morning';
    const preferredCount = Math.max(nightSessions.length, morningSessions.length);
    const preferredShare = timedSessions.length ? Math.round((preferredCount / timedSessions.length) * 100) : 0;

    const sessionBookIds = new Set(filteredSessions.map((session) => session.bookId));
    const finishedBooks = books.filter((book) => book.status === 'finished' && (allTime || dateIsInCurrentRange(book.dateFinished)));
    const previousFinishedBooks = allTime ? [] : books.filter((book) => book.status === 'finished' && dateIsInPreviousRange(book.dateFinished));
    const lifecycleBooks = allTime
      ? books.filter((book) => ['currently-reading', 'finished', 'paused', 'dnf'].includes(book.status))
      : books.filter((book) => sessionBookIds.has(book.id) || dateIsInCurrentRange(book.dateFinished));
    const completedPercent = lifecycleBooks.length ? Math.round((finishedBooks.length / lifecycleBooks.length) * 100) : 0;

    const ratedBooks = finishedBooks.filter((book) => typeof book.rating === 'number' && Number.isFinite(book.rating));
    const avgRating = ratedBooks.length ? ratedBooks.reduce((sum, book) => sum + (book.rating ?? 0), 0) / ratedBooks.length : 0;
    const genre = mostCommon(finishedBooks.flatMap((book) => book.work.genres));
    const genreRatings = new Map<string, number[]>();
    ratedBooks.forEach((book) => book.work.genres.forEach((item) => {
      const key = item.trim();
      if (!key) return;
      genreRatings.set(key, [...(genreRatings.get(key) ?? []), book.rating!]);
    }));
    const strongestRatedGenre = [...genreRatings.entries()]
      .filter(([, ratings]) => ratings.length >= 2)
      .map(([name, ratings]) => ({ name, count: ratings.length, average: ratings.reduce((a, b) => a + b, 0) / ratings.length }))
      .sort((a, b) => b.average - a.average || b.count - a.count)[0];

    const location = mostCommon(filteredSessions.map((session) => session.location ?? ''));
    const mood = mostCommon(filteredSessions.map((session) => session.mood ?? ''));
    const formatBooks = allTime ? books : books.filter((book) => sessionBookIds.has(book.id));
    const audiobookBooks = formatBooks.filter((book) => getActiveEdition(book)?.format === 'audiobook');
    const audioShare = formatBooks.length ? Math.round((audiobookBooks.length / formatBooks.length) * 100) : 0;

    const periodComparisonAvailable = !allTime && (filteredSessions.length > 0 || previousSessions.length > 0);
    const dayChange = percentChange(readingDays, previousReadingDays);
    const momentumTitle = !periodComparisonAvailable
      ? 'Your reading momentum needs another period to compare'
      : dayChange === null ? 'A new reading rhythm is taking shape'
        : dayChange > 10 ? 'Your reading consistency is climbing'
          : dayChange < -10 ? 'Your reading rhythm has eased recently'
            : 'Your reading rhythm is holding steady';

    const cards: InsightCard[] = [
      {
        id: 'momentum-comparison', category: 'progress', eyebrow: 'Period-over-period momentum', title: momentumTitle,
        body: allTime
          ? 'Choose 30 or 90 days to compare your current reading rhythm with the immediately preceding period.'
          : periodComparisonAvailable
            ? 'Inkbound compares equal windows so you can see whether reading is actually becoming more or less consistent, rather than guessing from a single total.'
            : 'Complete reading sessions across two periods and Inkbound will show how your consistency changes over time.',
        evidence: allTime ? `${readingDays} reading days are recorded across your full session history.` : comparisonText(readingDays, previousReadingDays, 'active reading days'),
        icon: TrendingUp,
      },
      {
        id: 'page-pace', category: 'progress', eyebrow: 'Reading volume trend',
        title: pages === 0 ? 'Your page-volume trend is waiting for session data' : allTime ? `${pages.toLocaleString()} pages tell the story of your logged reading` : (previousPages > 0 && pages > previousPages ? 'You are moving through more pages than before' : previousPages > pages ? 'Your page pace has softened this period' : 'Your page pace is holding its ground'),
        body: allTime ? 'Your lifetime page total reflects canonical pages recorded through completed sessions.' : 'This compares pages recorded in completed sessions against an equal previous window, keeping the signal tied to your actual reading activity.',
        evidence: allTime ? `${pages.toLocaleString()} canonical pages across ${readingDays} reading days.` : comparisonText(pages, previousPages, 'canonical pages'),
        icon: BarChart3,
      },
      {
        id: 'reading-window', category: 'habits', eyebrow: 'Your natural reading window',
        title: timedSessions.length < 3 ? 'Your preferred reading time needs more evidence' : preferredTime === 'evening' ? 'Your reading life comes alive at night' : 'Mornings are your clearest reading time',
        body: timedSessions.length < 3 ? 'Inkbound waits for at least three timed sessions before treating a time-of-day pattern as meaningful.' : `Your ${preferredTime} pattern is based on when you actually start logged sessions, not a generic reading recommendation.`,
        evidence: timedSessions.length ? `${preferredShare}% of ${timedSessions.length} timed sessions happened in the ${preferredTime}.` : 'No valid timed sessions in this range.',
        icon: preferredTime === 'evening' ? Moon : Clock3,
      },
      {
        id: 'session-shape', category: 'habits', eyebrow: 'Session depth trend',
        title: filteredSessions.length < 3 ? 'Your session style needs a little more history' : avgMinutes >= 40 ? 'Immersive sessions define this reading period' : 'Short sessions are carrying your momentum',
        body: filteredSessions.length < 3 ? 'Three or more completed sessions gives Inkbound a safer baseline for describing your session style.' : allTime ? 'This is the average shape of your completed reading sessions.' : previousSessions.length ? `Your current ${avgMinutes}-minute average can be compared with the previous period instead of viewed in isolation.` : 'Keep logging sessions and Inkbound will compare this average with your next reading period.',
        evidence: allTime ? `${avgMinutes} minute average across ${filteredSessions.length} completed sessions.` : `${avgMinutes} minute current average across ${filteredSessions.length} sessions; previous period: ${previousAvgMinutes || 0} minutes across ${previousSessions.length}.`,
        icon: Clock3,
      },
      {
        id: 'genre-gravity', category: 'taste', eyebrow: 'The stories pulling you back',
        title: genre && genre[1] >= 2 ? `${genre[0]} keeps earning your attention` : 'Your dominant genre needs more evidence',
        body: genre && genre[1] >= 2 ? `Among books finished in ${rangeLabel}, ${genre[0].toLowerCase()} appears more often than any other genre.` : 'Inkbound waits for repeated finished-book evidence before calling a genre part of your current reading pattern.',
        evidence: genre ? `${genre[1]} finished books in ${rangeLabel} include ${genre[0]}.` : `No finished-book genre pattern is available in ${rangeLabel}.`,
        icon: Compass,
      },
      {
        id: 'genre-satisfaction', category: 'taste', eyebrow: 'Taste meets satisfaction',
        title: strongestRatedGenre ? `${strongestRatedGenre.name} is delivering your strongest ratings` : 'Your highest-satisfaction genre is still emerging',
        body: strongestRatedGenre ? 'This goes beyond what you read most: Inkbound looks for genres that repeatedly receive your strongest ratings.' : 'Rate at least two finished books in the same genre before Inkbound treats a genre-rating relationship as meaningful.',
        evidence: strongestRatedGenre ? `${strongestRatedGenre.average.toFixed(1)} average across ${strongestRatedGenre.count} rated ${strongestRatedGenre.name} books in ${rangeLabel}.` : `${ratedBooks.length} rated finished books are available in ${rangeLabel}.`,
        icon: Sparkles,
      },
      {
        id: 'rating-pattern', category: 'taste', eyebrow: 'Overall satisfaction',
        title: ratedBooks.length < 3 ? 'Your satisfaction pattern needs more ratings' : avgRating >= 4.25 ? 'Your recent choices are landing exceptionally well' : avgRating >= 3.5 ? 'Your reading choices are mostly working for you' : 'Your ratings suggest more experimentation than certainty',
        body: ratedBooks.length < 3 ? 'Inkbound waits for at least three rated finishes before drawing a broad satisfaction conclusion.' : 'Your average is calculated only from rated books you actually finished in the selected window.',
        evidence: ratedBooks.length ? `${avgRating.toFixed(1)} average rating across ${ratedBooks.length} rated finishes in ${rangeLabel}.` : `No rated finished books in ${rangeLabel}.`,
        icon: Sparkles,
      },
      {
        id: 'completion-pattern', category: 'progress', eyebrow: 'Completion signal',
        title: lifecycleBooks.length < 3 ? 'Your completion pattern needs more active-reading history' : completedPercent >= 70 ? 'Finishing is a strong part of your reading pattern' : completedPercent >= 40 ? 'Your reading life balances finishing with exploration' : 'Your active shelf shows more exploration than completion',
        body: lifecycleBooks.length < 3 ? 'Inkbound avoids judging completion from an unread library. Only books represented in your active reading lifecycle contribute to this signal.' : 'This separates books you actively engaged with from the unread books simply waiting on your shelf.',
        evidence: lifecycleBooks.length ? `${finishedBooks.length} of ${lifecycleBooks.length} represented books are finished (${completedPercent}%).${!allTime ? ` Previous period recorded ${previousFinishedBooks.length} finishes.` : ''}` : `No active-reading lifecycle books are represented in ${rangeLabel}.`,
        icon: Target,
      },
      {
        id: 'environment-signal', category: 'habits', eyebrow: 'Reading environment signal',
        title: location && location[1] >= 2 ? `${location[0]} is becoming a reliable reading setting` : 'Your reading-place pattern needs more evidence',
        body: location && location[1] >= 2 ? 'Repeated session locations can reveal the settings that naturally support your reading habit.' : 'Log session locations more than once before Inkbound treats a place as part of your reading pattern.',
        evidence: location ? `${location[1]} completed sessions were recorded at ${location[0]} in ${rangeLabel}${mood ? `; ${mood[0]} is the most logged mood` : ''}.` : `No repeated session location is available in ${rangeLabel}.`,
        icon: BookOpen,
      },
      {
        id: 'format-signal', category: 'taste', eyebrow: 'Format mix',
        title: formatBooks.length < 3 ? 'Your format pattern needs more reading history' : audioShare >= 40 ? 'Audio is a major part of how you read' : audioShare >= 15 ? 'Audio gives your reading life a second lane' : 'Your reading is led by print and ebooks',
        body: formatBooks.length < 3 ? 'Inkbound waits for several represented books before describing your format mix.' : 'This signal uses the active editions attached to books represented in the selected reading window.',
        evidence: formatBooks.length ? `${audiobookBooks.length} of ${formatBooks.length} represented books use an audiobook as their active edition (${audioShare}%).` : `No represented book formats are available in ${rangeLabel}.`,
        icon: Headphones,
      },
    ];

    return cards;
  }, [books, filteredSessions, previousSessions, range, rangeWindow]);

  const visibleInsights = insights.filter((insight) => !dismissedIds.includes(insight.id) && (category === 'all' || insight.category === category));
  const isPremium = userPlan === 'premium';

  return (
    <div className="space-y-6 pb-12">
      <section className="inkbound-panel overflow-hidden rounded-3xl p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ink-gold-bright)]"><Sparkles className="h-4 w-4" /> Premium intelligence</div>
            <h2 className="font-serif text-3xl text-[var(--ink-ivory)] md:text-5xl">Reading Insights</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-muted)] md:text-base">See what is changing in your reading life, where your strongest patterns are forming, and the evidence behind every conclusion.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['30-days', '90-days', 'all-time'] as InsightRange[]).map((option) => (
              <button key={option} type="button" onClick={() => setRange(option)} className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold ${range === option ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}>
                {option === '30-days' ? '30 days' : option === '90-days' ? '90 days' : 'All time'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {!isPremium && (
        <section className="inkbound-panel rounded-3xl p-6 md:p-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ink-surface-soft)] text-[var(--ink-gold-bright)]"><Lock className="h-6 w-6" /></span>
            <h3 className="mt-5 font-serif text-3xl text-[var(--ink-ivory)]">Unlock the patterns behind your reading</h3>
            <p className="mt-3 text-sm leading-7 text-[var(--ink-muted)]">Premium compares reading periods, connects taste with ratings, tracks momentum, and only surfaces conclusions when your library has enough evidence to support them.</p>
            <button type="button" onClick={() => openUpgradeModal('Unlock Premium Reading Insights')} className="quiet-shelf-primary-action mx-auto mt-6 justify-center"><Sparkles /> Unlock Reading Insights</button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {(['all', 'habits', 'taste', 'progress'] as InsightCategory[]).map((option) => (
          <button key={option} type="button" onClick={() => setCategory(option)} className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold capitalize ${category === option ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}>{option}</button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {visibleInsights.map((insight, index) => {
          const Icon = insight.icon;
          const locked = !isPremium && index > 1;
          return (
            <article key={insight.id} className="inkbound-panel relative min-w-0 overflow-hidden rounded-3xl p-6">
              {locked && <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--ink-surface)]/80 backdrop-blur-sm"><Lock className="h-6 w-6 text-[var(--ink-gold-bright)]" /></div>}
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--ink-surface-soft)] text-[var(--ink-gold-bright)]"><Icon className="h-5 w-5" /></span>
                {isPremium && <button type="button" onClick={() => setDismissedIds((current) => current.includes(insight.id) ? current : [...current, insight.id])} className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]">Hide</button>}
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-gold-bright)]">{insight.eyebrow}</p>
              <h3 className="mt-2 break-words font-serif text-2xl text-[var(--ink-ivory)]">{insight.title}</h3>
              <p className="mt-3 break-words text-sm leading-7 text-[var(--ink-muted)]">{insight.body}</p>
              <div className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--ink-muted)]"><BarChart3 className="h-4 w-4" /> Evidence</div>
                <p className="mt-2 break-words text-sm text-[var(--ink-ivory)]">{insight.evidence}</p>
              </div>
            </article>
          );
        })}
      </div>

      {isPremium && dismissedIds.length > 0 && <button type="button" onClick={() => setDismissedIds([])} className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ink-gold-bright)]">Restore {dismissedIds.length} hidden insight{dismissedIds.length === 1 ? '' : 's'}</button>}
    </div>
  );
};
