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

const getSessionHour = (session: ReadingSession) => {
  const hour = Number(session.startTime?.split(':')[0]);
  return Number.isFinite(hour) ? hour : 12;
};

const mostCommon = (values: string[]) => {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
};

export const ReadingInsightsScreen: React.FC<ReadingInsightsScreenProps> = ({ books, sessions }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const [range, setRange] = usePersistentState<InsightRange>('inkbound_reading_insights_range', '90-days');
  const [category, setCategory] = usePersistentState<InsightCategory>('inkbound_reading_insights_category', 'all');
  const [dismissedIds, setDismissedIds] = usePersistentState<string[]>('inkbound_reading_insights_dismissed', []);

  const filteredSessions = useMemo(() => {
    const days = rangeDays[range];
    if (!days) return sessions;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return sessions.filter((session) => new Date(session.date) >= cutoff);
  }, [range, sessions]);

  const insights = useMemo<InsightCard[]>(() => {
    const totalMinutes = filteredSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
    const avgMinutes = filteredSessions.length ? Math.round(totalMinutes / filteredSessions.length) : 0;
    const nightSessions = filteredSessions.filter((session) => getSessionHour(session) >= 19 || getSessionHour(session) < 5);
    const morningSessions = filteredSessions.filter((session) => getSessionHour(session) >= 5 && getSessionHour(session) < 12);
    const finishedBooks = books.filter((book) => book.status === 'finished');
    const ratedBooks = finishedBooks.filter((book) => typeof book.rating === 'number');
    const avgRating = ratedBooks.length
      ? ratedBooks.reduce((sum, book) => sum + (book.rating ?? 0), 0) / ratedBooks.length
      : 0;
    const genre = mostCommon(finishedBooks.flatMap((book) => book.work.genres));
    const location = mostCommon(filteredSessions.map((session) => session.location ?? ''));
    const mood = mostCommon(filteredSessions.map((session) => session.mood ?? ''));
    const audiobookBooks = books.filter((book) =>
      book.editions.some((edition) => edition.id === book.activeEditionId && edition.format === 'audiobook'),
    );
    const readingDays = new Set(filteredSessions.map((session) => session.date)).size;
    const pages = filteredSessions.reduce((sum, session) => sum + (session.pagesRead ?? 0), 0);
    const completedPercent = books.length ? Math.round((finishedBooks.length / books.length) * 100) : 0;

    const preferredTime = nightSessions.length >= morningSessions.length ? 'evening' : 'morning';
    const preferredCount = Math.max(nightSessions.length, morningSessions.length);
    const preferredShare = filteredSessions.length
      ? Math.round((preferredCount / filteredSessions.length) * 100)
      : 0;

    return [
      {
        id: 'reading-window',
        category: 'habits',
        eyebrow: 'Your natural reading window',
        title: preferredTime === 'evening' ? 'Your reading life comes alive at night' : 'Mornings are your clearest reading time',
        body: preferredTime === 'evening'
          ? 'Your sessions cluster after the day has quieted down. Protecting a small evening window may help you read more consistently.'
          : 'You tend to read before the day becomes busy. A short morning ritual could turn that pattern into a dependable habit.',
        evidence: `${preferredShare}% of timed sessions happened in the ${preferredTime}.`,
        icon: preferredTime === 'evening' ? Moon : Clock3,
      },
      {
        id: 'session-shape',
        category: 'habits',
        eyebrow: 'Your session style',
        title: avgMinutes >= 40 ? 'You prefer immersive reading sessions' : 'Short sessions are carrying your momentum',
        body: avgMinutes >= 40
          ? 'You settle in for long stretches, which is ideal for complex stories and sustained immersion.'
          : 'You are making progress through manageable pockets of time rather than waiting for a perfect long reading block.',
        evidence: `${avgMinutes || 0} minute average across ${filteredSessions.length} sessions.`,
        icon: Clock3,
      },
      {
        id: 'genre-gravity',
        category: 'taste',
        eyebrow: 'The stories pulling you back',
        title: genre ? `${genre[0]} has the strongest hold on your shelf` : 'Your reading taste is still taking shape',
        body: genre
          ? `You return to ${genre[0].toLowerCase()} more than any other genre. It is currently the clearest signal in your finished-book history.`
          : 'Finish and rate a few more books to reveal the genres that consistently earn your attention.',
        evidence: genre ? `${genre[1]} finished books include this genre.` : 'Not enough finished-book data yet.',
        icon: Compass,
      },
      {
        id: 'rating-pattern',
        category: 'taste',
        eyebrow: 'Your satisfaction pattern',
        title: avgRating >= 4.25 ? 'You are choosing books you genuinely love' : 'Your ratings show thoughtful selectiveness',
        body: avgRating >= 4.25
          ? 'Your completed books are landing exceptionally well, suggesting that your selection habits are closely aligned with your taste.'
          : 'You are willing to distinguish between an enjoyable book and a true favorite instead of rating everything the same.',
        evidence: ratedBooks.length ? `${avgRating.toFixed(1)} average rating across ${ratedBooks.length} finished books.` : 'Add ratings to unlock this pattern.',
        icon: Sparkles,
      },
      {
        id: 'completion-pattern',
        category: 'progress',
        eyebrow: 'Your completion rhythm',
        title: completedPercent >= 60 ? 'You tend to finish what you begin' : 'Your library reflects exploration over completion',
        body: completedPercent >= 60
          ? 'Your shelf shows strong follow-through. You may enjoy longer series and ambitious reading goals because completion is already part of your pattern.'
          : 'You sample widely and keep options open. A smaller active-reading list may help when you want more finishes without losing variety.',
        evidence: `${completedPercent}% of your library is marked finished.`,
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
        evidence: `${readingDays} active reading days and ${pages} pages recorded in this range.`,
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
        evidence: location ? `${location[1]} sessions were recorded there.` : 'No session locations recorded.',
        icon: BookOpen,
      },
      {
        id: 'format-signal',
        category: 'taste',
        eyebrow: 'Format flexibility',
        title: audiobookBooks.length >= Math.max(2, Math.round(books.length * 0.25)) ? 'Audio is a meaningful part of your reading life' : 'Your reading is led by the page',
        body: audiobookBooks.length >= Math.max(2, Math.round(books.length * 0.25))
          ? 'Audiobooks are helping your reading fit into more parts of your day, giving you a second route into stories.'
          : 'Physical books and ebooks currently dominate your shelf, suggesting you value visual reading time and page-based progress.',
        evidence: `${audiobookBooks.length} audiobook editions in your library${mood ? `; ${mood[0]} is your most logged mood` : ''}.`,
        icon: Headphones,
      },
    ];
  }, [books, filteredSessions]);

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
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${range === option ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}
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
              Free readers can preview the kinds of patterns Inkbound analyzes. Premium unlocks the full evidence-backed insight feed and future AI-generated reflections.
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
            className={`rounded-full border px-4 py-2 text-sm font-semibold capitalize ${category === option ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}
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
            <article key={insight.id} className="inkbound-panel relative overflow-hidden rounded-3xl p-6">
              {locked && <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--ink-surface)]/80 backdrop-blur-sm"><Lock className="h-6 w-6 text-[var(--ink-gold-bright)]" /></div>}
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--ink-surface-soft)] text-[var(--ink-gold-bright)]">
                  <Icon className="h-5 w-5" />
                </span>
                {isPremium && (
                  <button type="button" onClick={() => setDismissedIds([...dismissedIds, insight.id])} className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]">
                    Hide
                  </button>
                )}
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-gold-bright)]">{insight.eyebrow}</p>
              <h3 className="mt-2 font-serif text-2xl text-[var(--ink-ivory)]">{insight.title}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--ink-muted)]">{insight.body}</p>
              <div className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--ink-muted)]"><BarChart3 className="h-4 w-4" /> Evidence</div>
                <p className="mt-2 text-sm text-[var(--ink-ivory)]">{insight.evidence}</p>
              </div>
            </article>
          );
        })}
      </div>

      {isPremium && dismissedIds.length > 0 && (
        <button type="button" onClick={() => setDismissedIds([])} className="text-sm font-semibold text-[var(--ink-gold-bright)]">
          Restore {dismissedIds.length} hidden insight{dismissedIds.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
};
