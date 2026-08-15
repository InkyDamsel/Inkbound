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
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) return null;
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

export const ReadingInsightsScreen: React.FC<ReadingInsightsScreenProps> = ({ books, sessions }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const [range, setRange] = usePersistentState<InsightRange>('inkbound_reading_insights_range', '90-days');
  const [category, setCategory] = usePersistentState<InsightCategory>('inkbound_reading_insights_category', 'all');
  const [dismissedIds, setDismissedIds] = usePersistentState<string[]>('inkbound_reading_insights_dismissed', []);

  const rangeWindow = useMemo(() => {
    const through = parseLocalDateKey(localDateKey())!;
    const days = rangeDays[range];
    if (!days) return { through, cutoff: null as Date | null };
    const cutoff = new Date(through);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    return { through, cutoff };
  }, [range]);

  const dateIsInRange = (value?: string) => {
    const date = parseLocalDateKey(value);
    if (!date) return false;
    if (date > rangeWindow.through) return false;
    return rangeWindow.cutoff ? date >= rangeWindow.cutoff : true;
  };

  const filteredSessions = useMemo(() => {
    const validSessions = sessions.filter((session) => getSessionDurationMinutes(session) > 0 && parseLocalDateKey(session.date) !== null);
    return validSessions.filter((session) => dateIsInRange(session.date));
  }, [rangeWindow, sessions]);

  const insights = useMemo<InsightCard[]>(() => {
    const totalMinutes = filteredSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const avgMinutes = filteredSessions.length ? Math.round(totalMinutes / filteredSessions.length) : 0;
    const timedSessions = filteredSessions.filter((session) => getSessionHour(session) !== null);
    const nightSessions = timedSessions.filter((session) => {
      const hour = getSessionHour(session)!;
      return hour >= 19 || hour < 5;
    });
    const morningSessions = timedSessions.filter((session) => {
      const hour = getSessionHour(session)!;
      return hour >= 5 && hour < 12;
    });

    const sessionBookIds = new Set(filteredSessions.map((session) => session.bookId));
    const allTime = range === 'all-time';
    const finishedBooks = books.filter((book) => (
      book.status === 'finished'
      && (allTime || dateIsInRange(book.dateFinished))
    ));
    const readingLifecycleBooks = allTime
      ? books.filter((book) => ['currently-reading', 'finished', 'paused', 'dnf'].includes(book.status))
      : books.filter((book) => sessionBookIds.has(book.id) || dateIsInRange(book.dateFinished));
    const ratedBooks = finishedBooks.filter((book) => typeof book.rating === 'number' && Number.isFinite(book.rating));
    const avgRating = ratedBooks.length
      ? ratedBooks.reduce((sum, book) => sum + (book.rating ?? 0), 0) / ratedBooks.length
      : 0;
    const genre = mostCommon(finishedBooks.flatMap((book) => book.work.genres));
    const location = mostCommon(filteredSessions.map((session) => session.location ?? ''));
    const mood = mostCommon(filteredSessions.map((session) => session.mood ?? ''));
    const formatBooks = allTime ? books : books.filter((book) => sessionBookIds.has(book.id));
    const audiobookBooks = formatBooks.filter((book) => getActiveEdition(book)?.format === 'audiobook');
    const readingDays = new Set(filteredSessions.map((session) => session.date)).size;
    const pages = filteredSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const completedPercent = readingLifecycleBooks.length
      ? Math.round((finishedBooks.length / readingLifecycleBooks.length) * 100)
      : 0;

    const preferredTime = nightSessions.length >= morningSessions.length ? 'evening' : 'morning';
    const preferredCount = Math.max(nightSessions.length, morningSessions.length);
    const preferredShare = timedSessions.length
      ? Math.round((preferredCount / timedSessions.length) * 100)
      : 0;

    const rangeLabel = allTime ? 'your full history' : 'this range';
    const formatBaseCount = formatBooks.length;
    const audioIsMeaningful = audiobookBooks.length >= Math.max(2, Math.round(formatBaseCount * 0.25));

    return [
      {
        id: 'reading-window',
        category: 'habits',
        eyebrow: 'Your natural reading window',
        title: timedSessions.length === 0
          ? 'Your preferred reading time has not emerged yet'
          : preferredTime === 'evening' ? 'Your reading life comes alive at night' : 'Mornings are your clearest reading time',
        body: timedSessions.length === 0
          ? 'Log sessions with start times and Inkbound will identify when reading most naturally fits your day.'
          : preferredTime === 'evening'
            ? 'Your sessions cluster after the day has quieted down. Protecting a small evening window may help you read more consistently.'
            : 'You tend to read before the day becomes busy. A short morning ritual could turn that pattern into a dependable habit.',
        evidence: timedSessions.length ? `${preferredShare}% of ${timedSessions.length} timed sessions happened in the ${preferredTime}.` : 'No valid timed sessions in this range.',
        icon: preferredTime === 'evening' ? Moon : Clock3,
      },
      {
        id: 'session-shape',
        category: 'habits',
        eyebrow: 'Your session style',
        title: filteredSessions.length === 0 ? 'Your session pattern is still waiting to form' : avgMinutes >= 40 ? 'You prefer immersive reading sessions' : 'Short sessions are carrying your momentum',
        body: filteredSessions.length === 0
          ? 'Complete a few reading sessions and Inkbound will summarize the shape of your reading time.'
          : avgMinutes >= 40
            ? 'You settle in for long stretches, which is ideal for complex stories and sustained immersion.'
            : 'You are making progress through manageable pockets of time rather than waiting for a perfect long reading block.',
        evidence: filteredSessions.length ? `${avgMinutes} minute average across ${filteredSessions.length} completed sessions.` : 'No completed sessions in this range.',
        icon: Clock3,
      },
      {
        id: 'genre-gravity',
        category: 'taste',
        eyebrow: 'The stories pulling you back',
        title: genre ? `${genre[0]} has the strongest hold on your shelf` : 'Your reading taste is still taking shape',
        body: genre
          ? `You return to ${genre[0].toLowerCase()} more than any other genre among books finished in ${rangeLabel}.`
          : 'Finish and rate a few more books to reveal the genres that consistently earn your attention.',
        evidence: genre ? `${genre[1]} finished books in ${rangeLabel} include this genre.` : `Not enough finished-book genre data in ${rangeLabel} yet.`,
        icon: Compass,
      },
      {
        id: 'rating-pattern',
        category: 'taste',
        eyebrow: 'Your satisfaction pattern',
        title: ratedBooks.length === 0 ? 'Your rating pattern has not emerged yet' : avgRating >= 4.25 ? 'You are choosing books you genuinely love' : 'Your ratings show thoughtful selectiveness',
        body: ratedBooks.length === 0
          ? 'Rate finished books and Inkbound will look for patterns in what consistently works for you.'
          : avgRating >= 4.25
            ? 'Your completed books are landing exceptionally well, suggesting that your selection habits are closely aligned with your taste.'
            : 'You are willing to distinguish between an enjoyable book and a true favorite instead of rating everything the same.',
        evidence: ratedBooks.length ? `${avgRating.toFixed(1)} average rating across ${ratedBooks.length} rated books finished in ${rangeLabel}.` : `No rated finished books in ${rangeLabel} yet.`,
        icon: Sparkles,
      },
      {
        id: 'completion-pattern',
        category: 'progress',
        eyebrow: 'Your completion rhythm',
        title: readingLifecycleBooks.length === 0 ? 'Your completion rhythm is still forming' : completedPercent >= 60 ? 'You tend to finish what you begin' : 'Your reading history reflects exploration over completion',
        body: readingLifecycleBooks.length === 0
          ? 'Once books move into your active reading history, Inkbound can distinguish finishing patterns from the unread books still waiting on your shelf.'
          : completedPercent >= 60
            ? 'Your reading history shows strong follow-through. You may enjoy longer series and ambitious reading goals because completion is already part of your pattern.'
            : 'You sample widely and keep options open. A smaller active-reading list may help when you want more finishes without losing variety.',
        evidence: readingLifecycleBooks.length ? `${finishedBooks.length} of ${readingLifecycleBooks.length} books represented in ${rangeLabel} are finished (${completedPercent}%).` : `No books entered the active reading lifecycle in ${rangeLabel}.`,
        icon: Target,
      },
      {
        id: 'pace-signal',
        category: 'progress',
        eyebrow: 'Recent momentum',
        title: readingDays >= 12 ? 'Consistency is becoming your strongest advantage' : 'A few extra reading days would change your month',
        body: readingDays >= 12
          ? 'You are returning often enough that reading is becoming part of your normal rhythm rather than an occasional event.'
          : 'Your session length is less important than frequency right now. Even ten minutes on two additional days each week could create visible momentum.',
        evidence: `${readingDays} active reading days and ${pages} canonical pages recorded in ${rangeLabel}.`,
        icon: TrendingUp,
      },
      {
        id: 'environment-signal',
        category: 'habits',
        eyebrow: 'Your reading environment',
        title: location ? `${location[0]} is where reading happens most naturally` : 'Your favorite reading place has not emerged yet',
        body: location
          ? `Your sessions repeatedly return to ${location[0].toLowerCase()}. That setting may be an important cue that helps you settle into a book.`
          : 'Add locations to sessions and Inkbound will identify the environments where you read most consistently.',
        evidence: location ? `${location[1]} completed sessions were recorded there in ${rangeLabel}.` : `No session locations recorded in ${rangeLabel}.`,
        icon: BookOpen,
      },
      {
        id: 'format-signal',
        category: 'taste',
        eyebrow: 'Format flexibility',
        title: formatBaseCount === 0 ? 'Your format pattern has not emerged yet' : audioIsMeaningful ? 'Audio is a meaningful part of your reading life' : 'Your reading is led by the page',
        body: formatBaseCount === 0
          ? 'Read across a few formats and Inkbound will show how audio, print, and ebooks fit into your reading life.'
          : audioIsMeaningful
            ? 'Audiobooks are helping your reading fit into more parts of your day, giving you a second route into stories.'
            : 'Physical books and ebooks currently dominate the books represented in this reading window.',
        evidence: formatBaseCount
          ? `${audiobookBooks.length} of ${formatBaseCount} books represented in ${rangeLabel} use an audiobook as their active edition${mood ? `; ${mood[0]} is your most logged mood in ${rangeLabel}` : ''}.`
          : `No books are represented in ${rangeLabel} yet.`,
        icon: Headphones,
      },
    ];
  }, [books, filteredSessions, range, rangeWindow]);

  const visibleInsights = insights.filter(
    (insight) => !dismissedIds.includes(insight.id) && (category === 'all' || insight.category === category),
  );

  const isPremium = userPlan === 'premium';

  return (
    <div className="space-y-6 pb-12">
      <section className="inkbound-panel overflow-hidden rounded-3xl p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ink-gold-bright)]">
              <Sparkles className="h-4 w-4" /> Premium intelligence
            </div>
            <h2 className="font-serif text-3xl text-[var(--ink-ivory)] md:text-5xl">Reading Insights</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-muted)] md:text-base">
              Inkbound finds meaningful patterns in your reading life and explains the evidence behind them. Your books and sessions remain the source of truth.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['30-days', '90-days', 'all-time'] as InsightRange[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRange(option)}
                className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold ${range === option ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}
              >
                {option === '30-days' ? '30 days' : option === '90-days' ? '90 days' : 'All time'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {!isPremium && (
        <section className="inkbound-panel rounded-3xl p-6 md:p-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ink-surface-soft)] text-[var(--ink-gold-bright)]">
              <Lock className="h-6 w-6" />
            </span>
            <h3 className="mt-5 font-serif text-3xl text-[var(--ink-ivory)]">Unlock your full reading pattern</h3>
            <p className="mt-3 text-sm leading-7 text-[var(--ink-muted)]">
              Free readers can preview the kinds of patterns Inkbound analyzes. Premium unlocks the full evidence-backed insight feed.
            </p>
            <button
              type="button"
              onClick={() => openUpgradeModal('Unlock Premium Reading Insights')}
              className="quiet-shelf-primary-action mx-auto mt-6 justify-center"
            >
              <Sparkles /> Unlock Reading Insights
            </button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {(['all', 'habits', 'taste', 'progress'] as InsightCategory[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setCategory(option)}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold capitalize ${category === option ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}
          >
            {option}
          </button>
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
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--ink-surface-soft)] text-[var(--ink-gold-bright)]">
                  <Icon className="h-5 w-5" />
                </span>
                {isPremium && (
                  <button
                    type="button"
                    onClick={() => setDismissedIds((current) => current.includes(insight.id) ? current : [...current, insight.id])}
                    className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]"
                  >
                    Hide
                  </button>
                )}
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

      {isPremium && dismissedIds.length > 0 && (
        <button type="button" onClick={() => setDismissedIds([])} className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ink-gold-bright)]">
          Restore {dismissedIds.length} hidden insight{dismissedIds.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
};
