import React, { useState } from 'react';
import { UserBookRecord, ReadingSession, Format, OwnershipStatus } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { StatisticsSummaryGrid } from './statistics/StatisticsSummaryGrid';
import {
  BarChart3,
  BookOpen,
  Award,
  Flame,
  PieChart,
  TrendingUp,
  Clock,
  Star,
  Layers,
  Sparkles,
  Lock,
  Filter,
  Calendar,
  CheckCircle2,
  Bookmark,
  Zap,
  UserCheck,
  ZapOff,
  Compass,
  Repeat
} from 'lucide-react';

interface StatisticsScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
}

export const StatisticsScreen: React.FC<StatisticsScreenProps> = ({ books, sessions }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();

  // Premium Filter States
  const [timeframe, setTimeframe] = useState<'week' | 'month' | 'quarter' | 'year' | 'custom'>('year');
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [genreFilter, setGenreFilter] = useState<string>('all');

  // Filtered books set based on Premium controls
  const filteredBooks = books.filter((b) => {
    if (formatFilter !== 'all' && !b.editions.some((e) => e.format === formatFilter)) return false;
    if (genreFilter !== 'all' && !b.work.genres.includes(genreFilter)) return false;
    return true;
  });

  const finishedBooks = filteredBooks.filter((b) => b.status === 'finished');
  const currentlyReading = filteredBooks.filter((b) => b.status === 'currently-reading');
  const tbrBooks = filteredBooks.filter((b) => b.status === 'tbr');
  const pausedDnfBooks = filteredBooks.filter((b) => b.status === 'paused' || b.status === 'dnf');

  // Basic Metrics
  const totalPagesRead = sessions.reduce((acc, s) => acc + (s.pagesRead || 0), 0) || 12450;
  const totalAudioMinutes = sessions.reduce((acc, s) => acc + (s.minutesListened || 0), 0) || 2910;
  const currentStreak = 14; // days
  const longestStreak = 28; // days
  const annualGoal = 30;
  const annualGoalPercent = Math.min(100, Math.round((finishedBooks.length / annualGoal) * 100));

  // Format counts
  const formatCounts = filteredBooks.reduce((acc, b) => {
    const fmt = b.editions[0]?.format || 'hardcover';
    acc[fmt] = (acc[fmt] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Genre counts
  const genreCounts = filteredBooks.reduce((acc, b) => {
    b.work.genres.forEach((g) => {
      acc[g] = (acc[g] || 0) + 1;
    });
    return acc;
  }, {} as Record<string, number>);

  const sortedGenres = (Object.entries(genreCounts) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Author counts
  const authorCounts = filteredBooks.reduce((acc, b) => {
    acc[b.work.author] = (acc[b.work.author] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topAuthors = (Object.entries(authorCounts) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Monthly completed mockup data
  const monthlyData = [
    { month: 'Jan', count: 3 },
    { month: 'Feb', count: 4 },
    { month: 'Mar', count: 2 },
    { month: 'Apr', count: 5 },
    { month: 'May', count: 3 },
    { month: 'Jun', count: 4 },
    { month: 'Jul', count: 6 },
  ];
  const maxMonthCount = Math.max(...monthlyData.map((d) => d.count));

  return (
    <div className="space-y-6 pb-20">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#e5c158] bg-[#c5a059]/15 border border-[#c5a059]/30 px-2.5 py-1 rounded">
              Analytics Engine
            </span>
            {userPlan === 'premium' ? (
              <span className="text-xs font-bold text-[#e5c158] bg-[#c5a059]/20 border border-[#c5a059]/40 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-[#e5c158]" /> Premium Full Access
              </span>
            ) : (
              <span className="text-xs font-bold text-stone-300 bg-[#25132f] border border-[#3d2448] px-2.5 py-0.5 rounded-full">
                Free Overview
              </span>
            )}
          </div>
          <h1 className="text-3xl font-serif font-bold text-[#f4efe6] mt-1">
            Reading Statistics & Reports
          </h1>
          <p className="text-sm text-stone-400">
            Track reading speed, duration, habits, streaks, and format preferences
          </p>
        </div>

        {userPlan === 'free' && (
          <button
            onClick={() => openUpgradeModal('Detailed reports and habit analytics require The Quiet Shelf Premium.')}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] hover:opacity-95 font-bold text-xs shadow-md transition flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-[#120817]" /> Unlock Premium Reports
          </button>
        )}
      </div>

      {/* BASIC FREE STATISTICS (Unlocked for all users) */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#e5c158] flex items-center gap-1.5">
          <BookOpen className="w-4 h-4 text-[#c5a059]" /> Basic Reading Overview
        </h2>

        <StatisticsSummaryGrid
          completedBooks={finishedBooks.length}
          totalPagesRead={totalPagesRead}
          totalAudioMinutes={totalAudioMinutes}
          currentStreak={currentStreak}
        />

        {/* Goal Progress & Simple Monthly Count */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Annual Goal */}
          <div className="bg-[#1c0f24] border border-[#c5a059]/20 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-400 uppercase">2026 Goal Progress</span>
              <span className="text-xs font-bold text-[#e5c158]">{finishedBooks.length} / {annualGoal} books</span>
            </div>
            <div>
              <p className="text-3xl font-serif font-bold text-[#f4efe6]">
                {annualGoalPercent}%
              </p>
              <p className="text-xs text-stone-400 mt-1">On pace to meet annual reading target.</p>
            </div>
            <div className="w-full bg-[#120817] rounded-full h-2.5 overflow-hidden border border-[#3d2448]">
              <div
                className="bg-gradient-to-r from-[#c5a059] to-[#d4af37] h-full rounded-full transition-all duration-500"
                style={{ width: `${annualGoalPercent}%` }}
              />
            </div>
          </div>

          {/* Simple Monthly Completion Chart */}
          <div className="md:col-span-2 bg-[#1c0f24] border border-[#c5a059]/20 rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-400 uppercase">Monthly Finished Books Count</span>
              <span className="text-xs font-bold text-[#e5c158]">Simple Monthly Tracker</span>
            </div>

            <div className="h-28 flex items-end justify-between gap-2 pt-2 border-b border-[#3d2448]">
              {monthlyData.map((d) => {
                const heightPercent = Math.round((d.count / maxMonthCount) * 100);
                return (
                  <div key={d.month} className="flex-1 flex flex-col items-center gap-1 group">
                    <span className="text-[10px] font-bold text-[#e5c158]">
                      {d.count}
                    </span>
                    <div
                      className="w-full bg-gradient-to-t from-[#c5a059] to-[#e5c158] rounded-t transition-all duration-500"
                      style={{ height: `${heightPercent}%` }}
                    />
                    <span className="text-[10px] text-stone-400 font-semibold">{d.month}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* PREMIUM DETAILED REPORTS SECTION */}
      <div className="pt-6 border-t border-[#e8dfd1] dark:border-[#332435] space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#c5a059]" />
            <h2 className="text-xl font-serif font-bold text-[#2e102d] dark:text-[#f3ede2]">
              Detailed Premium Reading Reports
            </h2>
          </div>

          {/* Premium Filter Toolbar */}
          {userPlan === 'premium' ? (
            <div className="flex flex-wrap items-center gap-2 bg-[#f8f4ed] dark:bg-[#201723] p-1.5 rounded-xl border border-[#e8dfd1] dark:border-[#342436] text-xs">
              <Filter className="w-3.5 h-3.5 text-[#c5a059] ml-1" />
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as any)}
                className="bg-transparent font-semibold focus:outline-none text-[#2e102d] dark:text-stone-200"
              >
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="quarter">This Quarter</option>
                <option value="year">Full Year 2026</option>
                <option value="custom">Custom Date Range</option>
              </select>

              <select
                value={formatFilter}
                onChange={(e) => setFormatFilter(e.target.value)}
                className="bg-transparent font-semibold focus:outline-none text-[#2e102d] dark:text-stone-200 border-l border-[#e8dfd1] dark:border-[#342436] pl-2"
              >
                <option value="all">All Formats</option>
                <option value="hardcover">Hardcover</option>
                <option value="paperback">Paperback</option>
                <option value="ebook">Ebook</option>
                <option value="audiobook">Audiobook</option>
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-stone-500 bg-stone-200/60 dark:bg-stone-800 px-3 py-1 rounded-full">
              <Lock className="w-3.5 h-3.5 text-amber-500" />
              <span>Advanced Filters & Deep Breakdowns Locked</span>
            </div>
          )}
        </div>

        {/* LOCKED FEATURE PREVIEW CARDS FOR FREE USERS */}
        {userPlan === 'free' && (
          <div className="relative rounded-3xl border-2 border-dashed border-[#c5a059]/40 bg-gradient-to-b from-[#c5a059]/5 to-transparent p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-[#c5a059]/30 pb-6">
              <div className="space-y-1 text-center sm:text-left">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#c5a059] bg-[#c5a059]/20 px-3 py-1 rounded-full">
                  <Sparkles className="w-3.5 h-3.5" /> Premium Reading Insights Preview
                </span>
                <h3 className="text-2xl font-serif font-bold text-[#2e102d] dark:text-[#f3ede2]">
                  Understand Your Reading Habits
                </h3>
                <p className="text-xs text-stone-600 dark:text-stone-300 max-w-xl">
                  See when you read most often, which formats you finish fastest, how your TBR changes, and whether you are on pace to meet your yearly goal.
                </p>
              </div>

              <button
                onClick={() => openUpgradeModal('Understand Your Reading Habits with Premium Reports.')}
                className="px-6 py-3 rounded-xl bg-[#c5a059] hover:bg-[#b08b46] text-[#1c121e] font-bold text-xs shadow-lg transition flex items-center gap-2 shrink-0"
              >
                <Sparkles className="w-4 h-4" /> Upgrade to Premium
              </button>
            </div>

            {/* Blurred / Sample Chart Previews */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
              
              {/* Sample Card 1: Session Analytics */}
              <div className="p-5 bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl relative overflow-hidden space-y-3 opacity-90">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#2e102d] dark:text-[#f3ede2]">Session Speed & Pace</span>
                  <span className="text-[10px] font-bold uppercase bg-[#c5a059] text-black px-2 py-0.5 rounded">Premium</span>
                </div>
                <div className="space-y-2 text-xs text-stone-500">
                  <div className="flex justify-between"><span>Avg Session Duration:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">42 mins</span></div>
                  <div className="flex justify-between"><span>Avg Reading Speed:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">38 pgs/hr</span></div>
                  <div className="flex justify-between"><span>Peak Reading Time:</span> <span className="font-bold text-emerald-600">Evenings (9-11 PM)</span></div>
                  <div className="flex justify-between"><span>Longest Session:</span> <span className="font-bold text-amber-600">145 mins</span></div>
                </div>
              </div>

              {/* Sample Card 2: TBR Growth vs Reduction */}
              <div className="p-5 bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl relative overflow-hidden space-y-3 opacity-90">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#2e102d] dark:text-[#f3ede2]">TBR Velocity & Time-to-Finish</span>
                  <span className="text-[10px] font-bold uppercase bg-[#c5a059] text-black px-2 py-0.5 rounded">Premium</span>
                </div>
                <div className="space-y-2 text-xs text-stone-500">
                  <div className="flex justify-between"><span>Avg Time in TBR Queue:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">18 days</span></div>
                  <div className="flex justify-between"><span>Avg Days to Finish Book:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">5.4 days</span></div>
                  <div className="flex justify-between"><span>TBR Growth Rate:</span> <span className="font-bold text-amber-600">+2 bks/month</span></div>
                  <div className="flex justify-between"><span>Series Completion Rate:</span> <span className="font-bold text-emerald-600">72%</span></div>
                </div>
              </div>

              {/* Sample Card 3: Ratings by Genre & Author */}
              <div className="p-5 bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl relative overflow-hidden space-y-3 opacity-90">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#2e102d] dark:text-[#f3ede2]">Highest-Rated Genres</span>
                  <span className="text-[10px] font-bold uppercase bg-[#c5a059] text-black px-2 py-0.5 rounded">Premium</span>
                </div>
                <div className="space-y-2 text-xs text-stone-500">
                  <div className="flex justify-between"><span>Gothic Romance:</span> <span className="font-bold text-[#c5a059]">4.8 ★</span></div>
                  <div className="flex justify-between"><span>Sci-Fi Opera:</span> <span className="font-bold text-[#c5a059]">4.6 ★</span></div>
                  <div className="flex justify-between"><span>Historical Fiction:</span> <span className="font-bold text-[#c5a059]">4.4 ★</span></div>
                  <div className="flex justify-between"><span>Favorite Author:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">Evelyn Thorne</span></div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* FULL PREMIUM DETAILED REPORTS (Rendered for Premium users) */}
        {userPlan === 'premium' && (
          <div className="space-y-6">
            
            {/* Row 1: Session & Habit Analysis Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Reading Pace & Session Analysis */}
              <div className="bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl p-5 shadow-xs space-y-3">
                <h3 className="text-sm font-bold text-[#2e102d] dark:text-[#f3ede2] flex items-center gap-1.5 font-serif">
                  <Clock className="w-4 h-4 text-[#c5a059]" /> Reading Session & Pace Analysis
                </h3>
                <div className="space-y-2 text-xs divide-y divide-[#e8dfd1]/60 dark:divide-[#2e1e30]">
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Average Session Duration:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">42 minutes</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Average Pages per Session:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">26.5 pages</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Average Listening Mins/Session:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">35 minutes</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Estimated Reading Speed:</span> <span className="font-bold text-emerald-600">38 pages / hour</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Longest Session Record:</span> <span className="font-bold text-amber-600">145 mins (Jul 12)</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Most Active Days:</span> <span className="font-bold text-[#c5a059]">Saturdays & Sundays</span></div>
                </div>
              </div>

              {/* TBR Velocity & Transition Times */}
              <div className="bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl p-5 shadow-xs space-y-3">
                <h3 className="text-sm font-bold text-[#2e102d] dark:text-[#f3ede2] flex items-center gap-1.5 font-serif">
                  <Bookmark className="w-4 h-4 text-[#c5a059]" /> TBR Growth & Finish Velocity
                </h3>
                <div className="space-y-2 text-xs divide-y divide-[#e8dfd1]/60 dark:divide-[#2e1e30]">
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">TBR Added vs Finished Ratio:</span> <span className="font-bold text-emerald-600">12 added / 14 finished</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Avg Time from Added to Start:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">16.4 days</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Avg Time Required to Finish:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">5.2 days</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Books Started vs Finished:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">16 started / 14 finished</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Paused / DNF Count:</span> <span className="font-bold text-[#849383]">2 books (12%)</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Reread Count:</span> <span className="font-bold text-[#c5a059]">3 rereads</span></div>
                </div>
              </div>

              {/* Streak & Projection Report */}
              <div className="bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl p-5 shadow-xs space-y-3">
                <h3 className="text-sm font-bold text-[#2e102d] dark:text-[#f3ede2] flex items-center gap-1.5 font-serif">
                  <Flame className="w-4 h-4 text-amber-500" /> Streaks & Goal Projections
                </h3>
                <div className="space-y-2 text-xs divide-y divide-[#e8dfd1]/60 dark:divide-[#2e1e30]">
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Current Reading Streak:</span> <span className="font-bold text-amber-500 font-mono">14 days</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Longest Streak Ever:</span> <span className="font-bold text-[#2e102d] dark:text-[#f3ede2]">28 days</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Reading Consistency Score:</span> <span className="font-bold text-emerald-600">92% of days active</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Projected Year-End Total:</span> <span className="font-bold text-[#c5a059]">46 books</span></div>
                  <div className="pt-1 flex justify-between"><span className="text-stone-500">Series Completion Progress:</span> <span className="font-bold text-emerald-600">4 of 6 series completed</span></div>
                </div>
              </div>

            </div>

            {/* Row 2: Genre, Format, & Author Breakdowns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Top Genres Breakdown */}
              <div className="bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl p-6 shadow-xs space-y-4">
                <h3 className="text-lg font-serif font-bold text-[#2e102d] dark:text-[#f3ede2]">
                  Top Genres & Rating Averages
                </h3>
                <div className="space-y-3">
                  {sortedGenres.map(([genre, count]) => {
                    const percent = Math.round((count / books.length) * 100);
                    return (
                      <div key={genre} className="space-y-1">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-[#2e102d] dark:text-stone-200">{genre}</span>
                          <span className="text-[#849383]">{count} books ({percent}%) • 4.6 ★</span>
                        </div>
                        <div className="w-full bg-stone-200 dark:bg-[#342436] rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-[#c5a059] h-full rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Format & Ownership Breakdown */}
              <div className="bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl p-6 shadow-xs space-y-4">
                <h3 className="text-lg font-serif font-bold text-[#2e102d] dark:text-[#f3ede2]">
                  Format & Ownership Breakdown
                </h3>
                
                <div className="grid grid-cols-2 gap-3 text-center text-xs">
                  <div className="p-3 bg-[#f3ede2] dark:bg-[#181119] rounded-xl border border-stone-200 dark:border-stone-800">
                    <span className="text-stone-400 block mb-1 font-bold">Hardcover / Physical</span>
                    <span className="text-lg font-serif font-bold text-[#361539] dark:text-[#c5a059]">
                      {(formatCounts['hardcover'] || 0) + (formatCounts['paperback'] || 0)} copies
                    </span>
                  </div>

                  <div className="p-3 bg-[#f3ede2] dark:bg-[#181119] rounded-xl border border-stone-200 dark:border-stone-800">
                    <span className="text-stone-400 block mb-1 font-bold font-serif">Audiobooks</span>
                    <span className="text-lg font-serif font-bold text-[#361539] dark:text-[#c5a059]">
                      {formatCounts['audiobook'] || 0} audio
                    </span>
                  </div>

                  <div className="p-3 bg-[#f3ede2] dark:bg-[#181119] rounded-xl border border-stone-200 dark:border-stone-800">
                    <span className="text-stone-400 block mb-1 font-bold">Ebooks</span>
                    <span className="text-lg font-serif font-bold text-[#361539] dark:text-[#c5a059]">
                      {formatCounts['ebook'] || 0} digital
                    </span>
                  </div>

                  <div className="p-3 bg-[#f3ede2] dark:bg-[#181119] rounded-xl border border-stone-200 dark:border-stone-800">
                    <span className="text-stone-400 block mb-1 font-bold">Owned vs Borrowed</span>
                    <span className="text-lg font-serif font-bold text-emerald-600">
                      {books.filter((b) => b.ownership === 'owned').length} : {books.filter((b) => b.ownership !== 'owned').length}
                    </span>
                  </div>
                </div>
              </div>

            </div>

          </div>
        )}

      </div>
    </div>
  );
};