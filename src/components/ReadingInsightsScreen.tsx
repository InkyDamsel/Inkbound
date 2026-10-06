import React, { useMemo } from 'react';
import { BarChart3, BookOpen, Clock3, Compass, Headphones, Lock, Moon, Sparkles, Target, TrendingUp } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { useUserPlan } from '../context/UserPlanContext';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { hasTrustworthyFinishedHistory, isImportedBook } from '../features/reading/inkboundActivity';
import { getSessionDurationMinutes, getSessionPagesRead, isRecordedReadingActivity, localDateKey } from '../features/reading/sessionAnalytics';

type InsightRange = '30-days' | '90-days' | 'all-time';
type InsightCategory = 'all' | 'habits' | 'taste' | 'progress';

interface ReadingInsightsScreenProps { books: UserBookRecord[]; sessions: ReadingSession[]; }
interface InsightCard { id: string; category: Exclude<InsightCategory, 'all'>; eyebrow: string; title: string; body: string; evidence: string; icon: React.ComponentType<{ className?: string }>; }

const rangeDays: Record<InsightRange, number | null> = { '30-days': 30, '90-days': 90, 'all-time': null };
const parseLocalDateKey = (value?: string): Date | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : null;
};
const getSessionHour = (session: ReadingSession) => {
  // A progress confirmation records when the reader confirmed the activity, not
  // necessarily when the pages were read. Do not turn that timestamp into a
  // false time-of-day habit signal.
  if (session.activitySource === 'progress-confirmation') return null;
  const hour = Number(session.startTime?.split(':')[0]);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
};
const mostCommon = (values: string[]) => { const counts = new Map<string, number>(); values.map((value) => value.trim()).filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1)); return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]; };
const percentChange = (current: number, previous: number) => previous === 0 ? (current > 0 ? null : 0) : Math.round(((current - previous) / previous) * 100);
const shortDelta = (current: number, previous: number) => { const change = percentChange(current, previous); if (change === null) return 'New activity'; if (change === 0) return 'No change'; return `${change > 0 ? '↑' : '↓'} ${Math.abs(change)}%`; };
const comparisonText = (current: number, previous: number, noun: string) => { const change = percentChange(current, previous); if (change === null) return `${current} ${noun} now; there were none in the previous period.`; if (change === 0) return `${current} ${noun}, unchanged from the previous period.`; return `${current} ${noun}, ${Math.abs(change)}% ${change > 0 ? 'higher' : 'lower'} than the previous period (${previous}).`; };
const importedMetadataIsUsable = (book: UserBookRecord) => !isImportedBook(book) || book.importMetadataReviewNeeded !== true;

export const ReadingInsightsScreen: React.FC<ReadingInsightsScreenProps> = ({ books, sessions }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const [range, setRange] = usePersistentState<InsightRange>('inkbound_reading_insights_range', '90-days');
  const [category, setCategory] = usePersistentState<InsightCategory>('inkbound_reading_insights_category', 'all');
  const [dismissedIds, setDismissedIds] = usePersistentState<string[]>('inkbound_reading_insights_dismissed', []);

  const rangeWindow = useMemo(() => {
    const through = parseLocalDateKey(localDateKey())!;
    const days = rangeDays[range];
    if (!days) return { through, cutoff: null as Date | null, previousCutoff: null as Date | null, previousThrough: null as Date | null };
    const cutoff = new Date(through); cutoff.setDate(cutoff.getDate() - (days - 1));
    const previousThrough = new Date(cutoff); previousThrough.setDate(previousThrough.getDate() - 1);
    const previousCutoff = new Date(previousThrough); previousCutoff.setDate(previousCutoff.getDate() - (days - 1));
    return { through, cutoff, previousCutoff, previousThrough };
  }, [range]);

  const dateIsInCurrentRange = (value?: string) => { const date = parseLocalDateKey(value); if (!date || date > rangeWindow.through) return false; return rangeWindow.cutoff ? date >= rangeWindow.cutoff : true; };
  const dateIsInPreviousRange = (value?: string) => { const date = parseLocalDateKey(value); if (!date || !rangeWindow.previousCutoff || !rangeWindow.previousThrough) return false; return date >= rangeWindow.previousCutoff && date <= rangeWindow.previousThrough; };
  const validSessions = useMemo(() => sessions.filter((session) => isRecordedReadingActivity(session) && parseLocalDateKey(session.date) !== null), [sessions]);
  const filteredSessions = useMemo(() => validSessions.filter((session) => dateIsInCurrentRange(session.date)), [validSessions, rangeWindow]);
  const previousSessions = useMemo(() => validSessions.filter((session) => dateIsInPreviousRange(session.date)), [validSessions, rangeWindow]);
  const importedBooks = useMemo(() => books.filter(isImportedBook), [books]);
  const importedReviewCount = useMemo(() => importedBooks.filter((book) => book.importMetadataReviewNeeded === true).length, [importedBooks]);

  const analytics = useMemo(() => {
    const currentMinutes = filteredSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const previousMinutes = previousSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const currentPages = filteredSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const previousPages = previousSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const currentDays = new Set(filteredSessions.map((session) => session.date)).size;
    const previousDays = new Set(previousSessions.map((session) => session.date)).size;
    const trustworthyFinished = books.filter(hasTrustworthyFinishedHistory);
    const currentFinished = trustworthyFinished.filter((book) => range === 'all-time' || dateIsInCurrentRange(book.dateFinished));
    const previousFinished = range === 'all-time' ? [] : trustworthyFinished.filter((book) => dateIsInPreviousRange(book.dateFinished));
    const bucketCount = range === '30-days' ? 10 : range === '90-days' ? 12 : 12;
    const buckets = Array.from({ length: bucketCount }, () => 0);
    if (range !== 'all-time' && rangeWindow.cutoff) {
      const totalDays = rangeDays[range] ?? 1;
      filteredSessions.forEach((session) => { const date = parseLocalDateKey(session.date); if (!date) return; const offset = Math.max(0, Math.floor((date.getTime() - rangeWindow.cutoff!.getTime()) / 86400000)); const index = Math.min(bucketCount - 1, Math.floor(offset / Math.max(1, totalDays / bucketCount))); buckets[index] += getSessionDurationMinutes(session); });
    } else {
      filteredSessions.forEach((session) => { const date = parseLocalDateKey(session.date); if (date) buckets[date.getMonth()] += getSessionDurationMinutes(session); });
    }
    return { currentMinutes, previousMinutes, currentPages, previousPages, currentDays, previousDays, currentFinished, previousFinished, buckets };
  }, [books, filteredSessions, previousSessions, range, rangeWindow]);

  const insights = useMemo<InsightCard[]>(() => {
    const allTime = range === 'all-time';
    const rangeLabel = allTime ? 'your verified reading history' : 'this period';
    const totalMinutes = analytics.currentMinutes;
    const previousMinutes = analytics.previousMinutes;
    const timedFilteredSessions = filteredSessions.filter((session) => getSessionDurationMinutes(session) > 0);
    const avgMinutes = timedFilteredSessions.length ? Math.round(totalMinutes / timedFilteredSessions.length) : 0;
    const timedPreviousSessions = previousSessions.filter((session) => getSessionDurationMinutes(session) > 0);
    const previousAvgMinutes = timedPreviousSessions.length ? Math.round(previousMinutes / timedPreviousSessions.length) : 0;
    const pages = analytics.currentPages;
    const previousPages = analytics.previousPages;
    const readingDays = analytics.currentDays;
    const previousReadingDays = analytics.previousDays;
    const timedSessions = filteredSessions.filter((session) => getSessionHour(session) !== null);
    const nightSessions = timedSessions.filter((session) => { const hour = getSessionHour(session)!; return hour >= 19 || hour < 5; });
    const morningSessions = timedSessions.filter((session) => { const hour = getSessionHour(session)!; return hour >= 5 && hour < 12; });
    const preferredTime = nightSessions.length >= morningSessions.length ? 'evening' : 'morning';
    const preferredCount = Math.max(nightSessions.length, morningSessions.length);
    const preferredShare = timedSessions.length ? Math.round((preferredCount / timedSessions.length) * 100) : 0;
    const currentSessionBookIds = new Set(filteredSessions.map((session) => session.bookId));
    const allSessionBookIds = new Set(validSessions.map((session) => session.bookId));
    const finishedBooks = analytics.currentFinished.filter(importedMetadataIsUsable);
    const previousFinishedBooks = analytics.previousFinished;
    const lifecycleBooks = books.filter((book) => {
      if (allTime) {
        if (allSessionBookIds.has(book.id) || hasTrustworthyFinishedHistory(book)) return true;
        return !isImportedBook(book) && ['currently-reading', 'paused', 'dnf'].includes(book.status);
      }
      return currentSessionBookIds.has(book.id) || (hasTrustworthyFinishedHistory(book) && dateIsInCurrentRange(book.dateFinished));
    });
    const completedPercent = lifecycleBooks.length ? Math.round((finishedBooks.length / lifecycleBooks.length) * 100) : 0;
    const ratedBooks = finishedBooks.filter((book) => typeof book.rating === 'number' && Number.isFinite(book.rating));
    const avgRating = ratedBooks.length ? ratedBooks.reduce((sum, book) => sum + (book.rating ?? 0), 0) / ratedBooks.length : 0;
    const genre = mostCommon(finishedBooks.flatMap((book) => book.work.genres));
    const genreRatings = new Map<string, number[]>();
    ratedBooks.forEach((book) => book.work.genres.forEach((item) => { const key = item.trim(); if (key) genreRatings.set(key, [...(genreRatings.get(key) ?? []), book.rating!]); }));
    const strongestRatedGenre = [...genreRatings.entries()].filter(([, ratings]) => ratings.length >= 2).map(([name, ratings]) => ({ name, count: ratings.length, average: ratings.reduce((a, b) => a + b, 0) / ratings.length })).sort((a, b) => b.average - a.average || b.count - a.count)[0];
    const location = mostCommon(filteredSessions.map((session) => session.location ?? ''));
    const mood = mostCommon(filteredSessions.map((session) => session.mood ?? ''));
    const formatBooks = books.filter((book) => {
      if (!importedMetadataIsUsable(book)) return false;
      if (allTime) return allSessionBookIds.has(book.id) || hasTrustworthyFinishedHistory(book);
      return currentSessionBookIds.has(book.id) || (hasTrustworthyFinishedHistory(book) && dateIsInCurrentRange(book.dateFinished));
    });
    const audiobookBooks = formatBooks.filter((book) => getActiveEdition(book)?.format === 'audiobook');
    const audioShare = formatBooks.length ? Math.round((audiobookBooks.length / formatBooks.length) * 100) : 0;
    const dayChange = percentChange(readingDays, previousReadingDays);

    return [
      { id: 'momentum-comparison', category: 'progress', eyebrow: 'Period-over-period momentum', title: allTime ? 'Your long-term reading rhythm' : dayChange === null ? 'A new reading rhythm is taking shape' : dayChange > 10 ? 'Your reading consistency is climbing' : dayChange < -10 ? 'Your reading rhythm has eased recently' : 'Your reading rhythm is holding steady', body: allTime ? 'Choose a shorter range to compare equal windows.' : 'Inkbound compares equal windows so changes in consistency are visible instead of buried in totals.', evidence: allTime ? `${readingDays} reading days are recorded across your Inkbound session history.` : comparisonText(readingDays, previousReadingDays, 'active reading days'), icon: TrendingUp },
      { id: 'page-pace', category: 'progress', eyebrow: 'Reading volume trend', title: pages === 0 ? 'Your page-volume trend is waiting' : allTime ? `${pages.toLocaleString()} pages tell the story of your logged reading` : previousPages > pages ? 'Your page pace has softened this period' : previousPages < pages ? 'You are moving through more pages than before' : 'Your page pace is steady', body: 'This signal uses pages recorded in completed sessions rather than imported library page counts.', evidence: allTime ? `${pages.toLocaleString()} pages across ${readingDays} reading days.` : comparisonText(pages, previousPages, 'pages'), icon: BarChart3 },
      { id: 'reading-window', category: 'habits', eyebrow: 'Natural reading window', title: timedSessions.length < 3 ? 'Your preferred reading time needs more evidence' : preferredTime === 'evening' ? 'Your reading life comes alive at night' : 'Mornings are your clearest reading time', body: timedSessions.length < 3 ? 'Inkbound waits for at least three timed sessions before treating this as a pattern.' : 'This is based only on when your real Inkbound sessions begin.', evidence: timedSessions.length ? `${preferredShare}% of ${timedSessions.length} timed sessions happened in the ${preferredTime}.` : 'No timed sessions in this range.', icon: preferredTime === 'evening' ? Moon : Clock3 },
      { id: 'session-shape', category: 'habits', eyebrow: 'Session depth', title: filteredSessions.length < 3 ? 'Your session style needs more history' : avgMinutes >= 40 ? 'Immersive sessions define this period' : 'Short sessions are carrying your momentum', body: 'Session depth shows how your tracked reading time is actually distributed.', evidence: allTime ? `${avgMinutes} minute average across ${filteredSessions.length} sessions.` : `${avgMinutes} minute current average; previous period: ${previousAvgMinutes || 0} minutes.`, icon: Clock3 },
      { id: 'genre-gravity', category: 'taste', eyebrow: 'Stories pulling you back', title: genre && genre[1] >= 2 ? `${genre[0]} keeps earning your attention` : 'Your dominant genre needs more evidence', body: genre && genre[1] >= 2 ? `${genre[0]} appears more often than any other genre among trustworthy finished-book records in ${rangeLabel}.` : 'Inkbound waits for repeated finished-book evidence before naming a dominant genre.', evidence: genre ? `${genre[1]} trustworthy finished books include ${genre[0]}.` : 'No reliable genre pattern is available yet.', icon: Compass },
      { id: 'genre-satisfaction', category: 'taste', eyebrow: 'Taste meets satisfaction', title: strongestRatedGenre ? `${strongestRatedGenre.name} is delivering your strongest ratings` : 'Your highest-satisfaction genre is still emerging', body: strongestRatedGenre ? 'This connects reliable finished-book history with the ratings you gave those books.' : 'Rate at least two trustworthy finished books in the same genre to form this signal.', evidence: strongestRatedGenre ? `${strongestRatedGenre.average.toFixed(1)} average across ${strongestRatedGenre.count} rated ${strongestRatedGenre.name} books.` : `${ratedBooks.length} reliable rated finishes are available.`, icon: Sparkles },
      { id: 'rating-pattern', category: 'taste', eyebrow: 'Overall satisfaction', title: ratedBooks.length < 3 ? 'Your satisfaction pattern needs more ratings' : avgRating >= 4.25 ? 'Your recent choices are landing exceptionally well' : avgRating >= 3.5 ? 'Your reading choices are mostly working for you' : 'Your ratings show more experimentation than certainty', body: 'Only rated books with trustworthy finished history are included.', evidence: ratedBooks.length ? `${avgRating.toFixed(1)} average rating across ${ratedBooks.length} reliable rated finishes.` : 'No reliable rated finishes in this range.', icon: Sparkles },
      { id: 'completion-pattern', category: 'progress', eyebrow: 'Completion signal', title: lifecycleBooks.length < 3 ? 'Your completion pattern needs more active-reading history' : completedPercent >= 70 ? 'Finishing is a strong part of your reading pattern' : completedPercent >= 40 ? 'You balance finishing with exploration' : 'Your active shelf shows more exploration than completion', body: 'This ignores a giant unread import and only uses books represented by real sessions, native reading state, or trustworthy finish history.', evidence: lifecycleBooks.length ? `${finishedBooks.length} of ${lifecycleBooks.length} represented books are finished (${completedPercent}%).${!allTime ? ` Previous period: ${previousFinishedBooks.length} trustworthy finishes.` : ''}` : 'No reliable active-reading lifecycle books are represented.', icon: Target },
      { id: 'environment-signal', category: 'habits', eyebrow: 'Reading environment', title: location && location[1] >= 2 ? `${location[0]} is becoming a reliable reading setting` : 'Your reading-place pattern needs more evidence', body: 'Repeated locations come only from completed Inkbound sessions.', evidence: location ? `${location[1]} sessions were recorded at ${location[0]}${mood ? `; ${mood[0]} is the most logged mood` : ''}.` : 'No repeated session location is available.', icon: BookOpen },
      { id: 'format-signal', category: 'taste', eyebrow: 'Format mix', title: formatBooks.length < 3 ? 'Your format pattern needs more history' : audioShare >= 40 ? 'Audio is a major part of how you read' : audioShare >= 15 ? 'Audio gives your reading life a second lane' : 'Your reading is led by print and ebooks', body: 'This uses active editions only for books represented by tracked activity or trustworthy finished history; imported metadata marked for review is excluded.', evidence: formatBooks.length ? `${audiobookBooks.length} of ${formatBooks.length} reliable represented books are audiobooks (${audioShare}%).` : 'No reliable represented formats are available.', icon: Headphones },
    ];
  }, [analytics, books, filteredSessions, previousSessions, range, rangeWindow, validSessions]);

  const visibleInsights = insights.filter((insight) => !dismissedIds.includes(insight.id) && (category === 'all' || insight.category === category));
  const isPremium = userPlan === 'premium';
  const maxBucket = Math.max(1, ...analytics.buckets);

  return (
    <div className="space-y-6 pb-12">
      <section className="inkbound-panel overflow-hidden rounded-3xl p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div className="max-w-3xl"><div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ink-gold-bright)]"><Sparkles className="h-4 w-4" /> Premium intelligence</div><h2 className="font-serif text-3xl text-[var(--ink-ivory)] md:text-5xl">Reading Insights</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-muted)] md:text-base">See what is changing in your reading life, where your strongest patterns are forming, and the evidence behind every conclusion.</p></div><div className="flex flex-wrap gap-2">{(['30-days', '90-days', 'all-time'] as InsightRange[]).map((option) => <button key={option} type="button" onClick={() => setRange(option)} className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold ${range === option ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}>{option === '30-days' ? '30 days' : option === '90-days' ? '90 days' : 'All time'}</button>)}</div></div>
      </section>

      {!isPremium && <section className="inkbound-panel rounded-3xl p-6 md:p-8"><div className="mx-auto max-w-2xl text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ink-surface-soft)] text-[var(--ink-gold-bright)]"><Lock className="h-6 w-6" /></span><h3 className="mt-5 font-serif text-3xl text-[var(--ink-ivory)]">Unlock the patterns behind your reading</h3><p className="mt-3 text-sm leading-7 text-[var(--ink-muted)]">Premium compares reading periods, connects taste with ratings, tracks momentum, and only surfaces conclusions when your history has enough evidence.</p><button type="button" onClick={() => openUpgradeModal('Unlock Premium Reading Insights')} className="quiet-shelf-primary-action mx-auto mt-6 justify-center"><Sparkles /> Unlock Reading Insights</button></div></section>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Books finished', analytics.currentFinished.length.toString(), range === 'all-time' ? 'Trustworthy history' : shortDelta(analytics.currentFinished.length, analytics.previousFinished.length)],
          ['Pages read', analytics.currentPages.toLocaleString(), range === 'all-time' ? 'Tracked sessions' : shortDelta(analytics.currentPages, analytics.previousPages)],
          ['Reading time', `${Math.floor(analytics.currentMinutes / 60)}h ${analytics.currentMinutes % 60}m`, range === 'all-time' ? 'Tracked sessions' : shortDelta(analytics.currentMinutes, analytics.previousMinutes)],
          ['Reading days', analytics.currentDays.toString(), range === 'all-time' ? 'Tracked activity' : shortDelta(analytics.currentDays, analytics.previousDays)],
        ].map(([label, value, delta]) => <div key={label} className="inkbound-panel rounded-2xl p-5"><p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--ink-muted)]">{label}</p><p className="mt-2 font-serif text-3xl font-bold text-[var(--ink-ivory)]">{value}</p><p className="mt-2 text-xs font-semibold text-[var(--ink-gold-bright)]">{delta}</p></div>)}
      </section>

      {importedBooks.length > 0 && <section className="rounded-2xl border border-[var(--ink-gold)]/25 bg-[var(--ink-gold)]/5 px-5 py-4"><p className="text-sm font-semibold text-[var(--ink-ivory)]">Insight data quality</p><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Reading time, pages, days, pace, time-of-day and environment patterns use completed Inkbound sessions only. Finished-book history uses the same canonical valid-finish rule as the rest of Inkbound. Taste signals exclude imported metadata that needs review.</p>{importedReviewCount > 0 && <p className="mt-2 text-xs font-semibold text-[var(--ink-gold-bright)]">{importedReviewCount.toLocaleString()} imported record{importedReviewCount === 1 ? '' : 's'} currently excluded from metadata-based insights until reviewed.</p>}</section>}

      <section className="inkbound-panel rounded-3xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-gold-bright)]">Reading pulse</p><h3 className="mt-2 font-serif text-2xl text-[var(--ink-ivory)]">Activity across the selected period</h3></div><p className="text-xs text-[var(--ink-muted)]">Bars represent reading minutes from completed sessions</p></div>
        <div className="mt-6 flex h-40 items-end gap-2 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">{analytics.buckets.map((value, index) => <div key={index} className="flex h-full flex-1 items-end"><div className="w-full rounded-t-lg bg-[var(--ink-gold)]/70 transition-all" style={{ height: `${Math.max(value > 0 ? 8 : 2, (value / maxBucket) * 100)}%` }} title={`${value} reading minutes`} /></div>)}</div>
      </section>

      <div className="flex flex-wrap gap-2">{(['all', 'habits', 'taste', 'progress'] as InsightCategory[]).map((option) => <button key={option} type="button" onClick={() => setCategory(option)} className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold capitalize ${category === option ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}>{option}</button>)}</div>

      <div className="grid gap-4 lg:grid-cols-2">{visibleInsights.map((insight, index) => { const Icon = insight.icon; const locked = !isPremium && index > 1; return <article key={insight.id} className="inkbound-panel relative min-w-0 overflow-hidden rounded-3xl p-6">{locked && <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--ink-surface)]/80 backdrop-blur-sm"><Lock className="h-6 w-6 text-[var(--ink-gold-bright)]" /></div>}<div className="flex items-start justify-between gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--ink-surface-soft)] text-[var(--ink-gold-bright)]"><Icon className="h-5 w-5" /></span>{isPremium && <button type="button" onClick={() => setDismissedIds((current) => current.includes(insight.id) ? current : [...current, insight.id])} className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]">Hide</button>}</div><p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-gold-bright)]">{insight.eyebrow}</p><h3 className="mt-2 break-words font-serif text-2xl text-[var(--ink-ivory)]">{insight.title}</h3><p className="mt-3 break-words text-sm leading-7 text-[var(--ink-muted)]">{insight.body}</p><div className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--ink-muted)]"><BarChart3 className="h-4 w-4" /> Evidence</div><p className="mt-2 break-words text-sm text-[var(--ink-ivory)]">{insight.evidence}</p></div></article>; })}</div>
      {isPremium && dismissedIds.length > 0 && <button type="button" onClick={() => setDismissedIds([])} className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ink-gold-bright)]">Restore {dismissedIds.length} hidden insight{dismissedIds.length === 1 ? '' : 's'}</button>}
    </div>
  );
};