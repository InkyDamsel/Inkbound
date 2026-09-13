import React, { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, BookOpen, CheckCircle2, Clock, Filter, Flame, Lock, Sparkles } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { ResponsiveGrid } from '../layout/responsive';
import {
  getReadingStreak,
  getSessionDurationMinutes,
  getSessionListeningMinutes,
  localDateKey,
} from '../features/reading/sessionAnalytics';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { getEffectivePagesReadForPeriod } from '../features/reading/readingPageTotals';
import { getAnnualReadingGoal } from '../features/reading/readingPreferences';
import { hasTrustworthyFinishedHistory, isImportedBook } from '../features/reading/inkboundActivity';
import { StatisticsGoalOverview } from './statistics/StatisticsGoalOverview';
import { StatisticsSummaryGrid } from './statistics/StatisticsSummaryGrid';

interface StatisticsScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

const timeframeStart = (timeframe: string, today = new Date()) => {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (timeframe === 'week') start.setDate(start.getDate() - 6);
  else if (timeframe === 'month') start.setDate(1);
  else if (timeframe === 'quarter') start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
  else start.setMonth(0, 1);
  return localDateKey(start);
};

export const StatisticsScreen: React.FC<StatisticsScreenProps> = ({ books, sessions }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const [timeframe, setTimeframe] = useState('year');
  const [formatFilter, setFormatFilter] = useState('all');

  const filteredBooks = useMemo(
    () => books.filter((book) => formatFilter === 'all' || getActiveEdition(book)?.format === formatFilter),
    [books, formatFilter],
  );
  const filteredBookIds = useMemo(() => new Set(filteredBooks.map((book) => book.id)), [filteredBooks]);
  const reportStart = timeframeStart(timeframe);
  const reportEnd = localDateKey();

  const filteredSessions = useMemo(() => sessions.filter((session) => (
    filteredBookIds.has(session.bookId)
    && session.date >= reportStart
    && session.date <= reportEnd
    && getSessionDurationMinutes(session) > 0
  )), [filteredBookIds, reportEnd, reportStart, sessions]);

  const finishedBooks = filteredBooks.filter(hasTrustworthyFinishedHistory);
  const reportFinishedBooks = finishedBooks.filter((book) => (
    Boolean(book.dateFinished)
    && book.dateFinished! >= reportStart
    && book.dateFinished! <= reportEnd
  ));
  const tbrBooks = filteredBooks.filter((book) => book.status === 'tbr');
  const pausedBooks = filteredBooks.filter(
    (book) => book.status === 'paused' || book.status === 'dnf',
  );

  const totalPagesRead = getEffectivePagesReadForPeriod(filteredBooks, filteredSessions, reportStart, reportEnd);
  const totalAudioMinutes = filteredSessions.reduce((total, session) => total + getSessionListeningMinutes(session), 0);
  const totalReadingMinutes = filteredSessions.reduce((total, session) => total + getSessionDurationMinutes(session), 0);
  const annualGoal = getAnnualReadingGoal();
  const currentYear = new Date().getFullYear();
  const completedThisYear = finishedBooks.filter((book) => book.dateFinished?.startsWith(`${currentYear}-`));
  const annualGoalPercent = Math.min(
    100,
    Math.round((completedThisYear.length / annualGoal) * 100),
  );
  const currentStreak = getReadingStreak(sessions);

  const trackedBookIdsThisYear = useMemo(() => new Set(
    sessions
      .filter((session) => session.date.startsWith(`${currentYear}-`) && getSessionDurationMinutes(session) > 0)
      .map((session) => session.bookId),
  ), [currentYear, sessions]);

  const importedBooks = filteredBooks.filter(isImportedBook);
  const importedCompletedThisYear = completedThisYear.filter(isImportedBook);
  const fullyTrackedCompletedThisYear = completedThisYear.filter((book) => trackedBookIdsThisYear.has(book.id));
  const importedRecordsNeedingReview = importedBooks.filter((book) => (
    book.importMetadataReviewNeeded === true
    || book.importMetadataVerified === false
    || (book.status === 'finished' && book.importFinishedDateProvided === false)
  ));
  const hasImportedData = importedBooks.length > 0;

  const monthlyData = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, { month: 'short' });
    return Array.from({ length: 12 }, (_, monthIndex) => {
      const month = String(monthIndex + 1).padStart(2, '0');
      const prefix = `${currentYear}-${month}-`;
      return {
        month: formatter.format(new Date(currentYear, monthIndex, 1)),
        count: completedThisYear.filter((book) => book.dateFinished?.startsWith(prefix)).length,
      };
    });
  }, [completedThisYear, currentYear]);

  const formatCounts = filteredBooks.reduce<Record<string, number>>((counts, book) => {
    const format = getActiveEdition(book)?.format ?? 'unknown';
    counts[format] = (counts[format] ?? 0) + 1;
    return counts;
  }, {});

  const topFormats = Object.entries(formatCounts)
    .sort(([, first], [, second]) => second - first)
    .slice(0, 4);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-[#c5a059]/30 bg-[#c5a059]/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-[#e5c158]">
              Analytics Engine
            </span>
            <span className="rounded-full border border-[#3d2448] bg-[#25132f] px-2.5 py-0.5 text-xs font-bold text-stone-300">
              {userPlan === 'premium' ? 'Premium Full Access' : 'Free Overview'}
            </span>
          </div>
          <h1 className="mt-1 font-serif text-3xl font-bold text-[#f4efe6]">
            Reading Statistics & Reports
          </h1>
          <p className="text-sm text-stone-400">
            Track reading progress, sessions, streaks, formats, and yearly goals.
          </p>
        </div>

        {userPlan === 'free' && (
          <button
            type="button"
            onClick={() => openUpgradeModal('Detailed reports and habit analytics require Inkbound Premium.')}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-4 text-xs font-bold text-[#120817] shadow-md transition hover:opacity-95"
          >
            <Sparkles className="h-4 w-4" />
            Unlock Premium Reports
          </button>
        )}
      </div>

      <section className="space-y-4">
        <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-[#e5c158]">
          <BookOpen className="h-4 w-4" /> Basic Reading Overview
        </h2>

        <StatisticsSummaryGrid
          completedBooks={completedThisYear.length}
          totalPagesRead={totalPagesRead}
          totalAudioMinutes={totalAudioMinutes}
          currentStreak={currentStreak}
        />

        <StatisticsGoalOverview
          completedBooks={completedThisYear.length}
          annualGoal={annualGoal}
          annualGoalPercent={annualGoalPercent}
          monthlyData={monthlyData}
        />

        {hasImportedData && (
          <aside className="rounded-2xl border border-[#c5a059]/25 bg-[#c5a059]/[0.06] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              {importedRecordsNeedingReview.length > 0 ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#e5c158]" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              )}
              <div className="min-w-0 flex-1">
                <h3 className="font-serif text-base font-bold text-[#f4efe6]">Imported data coverage</h3>
                <p className="mt-1 text-xs leading-5 text-stone-400">
                  Finished-book counts include only trustworthy historical finish dates from imports. Page totals use tracked activity and, for trustworthy finished print/ebook records with known page counts, the edition page count when exact session pages are missing. Listening time, reading time, and streaks still require tracked Inkbound activity.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-[#3d2448] bg-[#120817]/70 px-3 py-1.5 text-stone-300">
                    {completedThisYear.length} finished this year
                  </span>
                  <span className="rounded-full border border-[#3d2448] bg-[#120817]/70 px-3 py-1.5 text-stone-300">
                    {fullyTrackedCompletedThisYear.length} with tracked Inkbound activity
                  </span>
                  <span className="rounded-full border border-[#3d2448] bg-[#120817]/70 px-3 py-1.5 text-stone-300">
                    {importedCompletedThisYear.length} trusted imported finishes
                  </span>
                  {importedRecordsNeedingReview.length > 0 && (
                    <span className="rounded-full border border-amber-400/25 bg-amber-400/[0.08] px-3 py-1.5 text-amber-200">
                      {importedRecordsNeedingReview.length} imported records may need review
                    </span>
                  )}
                </div>
              </div>
            </div>
          </aside>
        )}
      </section>

      <section className="space-y-5 border-t border-[#332435] pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-serif text-xl font-bold text-[#f4efe6]">
              <BarChart3 className="h-5 w-5 text-[#c5a059]" /> Detailed Reading Reports
            </h2>
            <p className="text-xs text-stone-400">
              Explore reading pace, library movement, and format preferences.
            </p>
          </div>

          {userPlan === 'premium' ? (
            <div className="flex flex-col gap-2 rounded-xl border border-[#3d2448] bg-[#1c0f24] p-2 text-xs sm:flex-row sm:items-center">
              <Filter className="hidden h-4 w-4 text-[#c5a059] sm:block" />
              <select
                value={timeframe}
                onChange={(event) => setTimeframe(event.target.value)}
                className="min-h-11 rounded-lg border border-[#3d2448] bg-[#120817] px-3 text-[#f4efe6]"
              >
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="quarter">This Quarter</option>
                <option value="year">Full Year {currentYear}</option>
              </select>
              <select
                value={formatFilter}
                onChange={(event) => setFormatFilter(event.target.value)}
                className="min-h-11 rounded-lg border border-[#3d2448] bg-[#120817] px-3 text-[#f4efe6]"
              >
                <option value="all">All Formats</option>
                <option value="hardcover">Hardcover</option>
                <option value="paperback">Paperback</option>
                <option value="ebook">Ebook</option>
                <option value="audiobook">Audiobook</option>
              </select>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#25132f] px-3 py-1 text-xs text-stone-400">
              <Lock className="h-3.5 w-3.5 text-[#c5a059]" /> Advanced filters locked
            </span>
          )}
        </div>

        {userPlan === 'free' ? (
          <div className="rounded-3xl border-2 border-dashed border-[#c5a059]/40 bg-[#c5a059]/5 p-6 text-center sm:p-8">
            <Sparkles className="mx-auto h-8 w-8 text-[#c5a059]" />
            <h3 className="mt-3 font-serif text-2xl font-bold text-[#f4efe6]">
              Understand Your Reading Habits
            </h3>
            <p className="mx-auto mt-2 max-w-xl text-sm text-stone-400">
              Premium reports reveal session pace, TBR movement, format trends, and goal projections.
            </p>
            <button
              type="button"
              onClick={() => openUpgradeModal('Unlock detailed Inkbound reading reports.')}
              className="mt-5 min-h-11 rounded-xl bg-[#c5a059] px-6 text-xs font-bold text-[#120817]"
            >
              Upgrade to Premium
            </button>
          </div>
        ) : (
          <ResponsiveGrid minItemWidth={240} maxColumns={3} gap={24}>
            <article className="space-y-3 rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-5">
              <h3 className="flex items-center gap-2 font-serif text-lg font-bold text-[#f4efe6]">
                <Clock className="h-4 w-4 text-[#c5a059]" /> Session Pace
              </h3>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-4"><dt className="text-stone-400">Sessions</dt><dd className="font-bold text-[#f4efe6]">{filteredSessions.length}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-stone-400">Minutes read</dt><dd className="font-bold text-[#f4efe6]">{Math.round(totalReadingMinutes)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-stone-400">Average session</dt><dd className="font-bold text-[#e5c158]">{filteredSessions.length ? Math.round(totalReadingMinutes / filteredSessions.length) : 0} min</dd></div>
              </dl>
              {hasImportedData && (
                <p className="border-t border-[#3d2448] pt-3 text-[11px] leading-4 text-stone-500">
                  Session pace reflects tracked Inkbound sessions only.
                </p>
              )}
            </article>

            <article className="space-y-3 rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-5">
              <h3 className="flex items-center gap-2 font-serif text-lg font-bold text-[#f4efe6]">
                <Flame className="h-4 w-4 text-amber-500" /> Library Movement
              </h3>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-4"><dt className="text-stone-400">Finished in period</dt><dd className="font-bold text-emerald-400">{reportFinishedBooks.length}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-stone-400">Waiting in TBR now</dt><dd className="font-bold text-[#f4efe6]">{tbrBooks.length}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-stone-400">Paused or DNF now</dt><dd className="font-bold text-stone-300">{pausedBooks.length}</dd></div>
              </dl>
            </article>

            <article className="space-y-3 rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-5">
              <h3 className="font-serif text-lg font-bold text-[#f4efe6]">Format Preferences</h3>
              <div className="space-y-2 text-xs">
                {topFormats.length ? (
                  topFormats.map(([format, count]) => (
                    <div key={format} className="flex justify-between gap-4">
                      <span className="capitalize text-stone-400">{format}</span>
                      <span className="font-bold text-[#e5c158]">{count}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-stone-400">No books match the selected filters.</p>
                )}
              </div>
              {hasImportedData && (
                <p className="border-t border-[#3d2448] pt-3 text-[11px] leading-4 text-stone-500">
                  Format totals may include imported edition metadata.
                </p>
              )}
            </article>
          </ResponsiveGrid>
        )}
      </section>
    </div>
  );
};