import React from 'react';
import { UserBookRecord, ReadingSession } from '../types';
import { BookCover } from './BookCover';
import {
  Play,
  Clock,
  Award,
  BookOpen,
  Headphones,
  Flame,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  Plus,
  Sparkles,
  CheckCircle2,
  Bookmark
} from 'lucide-react';

interface HomeDashboardProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
  onStartSessionForBook: (book: UserBookRecord) => void;
  onUpdateStatus: (bookId: string, status: any) => void;
  onNavigateToTab: (tab: any) => void;
  onOpenAddBook: () => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  books,
  sessions,
  onSelectBook,
  onStartSessionForBook,
  onUpdateStatus,
  onNavigateToTab,
  onOpenAddBook,
}) => {
  // Currently Reading Books
  const currentlyReading = books.filter((b) => b.status === 'currently-reading');

  // Up Next (TBR books prioritized)
  const upNext = books
    .filter((b) => b.status === 'tbr')
    .sort((a, b) => {
      const priorityOrder = { top: 1, high: 2, medium: 3, low: 4 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .slice(0, 4);

  // Stats summary for 2026
  const finishedBooksCount = books.filter((b) => b.status === 'finished').length;
  const annualGoal = 25;
  const goalPercent = Math.min(100, Math.round((finishedBooksCount / annualGoal) * 100));

  const totalPagesRead = books.reduce((acc, b) => {
    const pageCount = b.editions[0]?.pageCount || 300;
    if (b.status === 'finished') return acc + pageCount;
    if (b.status === 'currently-reading') return acc + b.progressPages;
    return acc;
  }, 0);

  const totalListeningMins = books.reduce((acc, b) => {
    if (b.status === 'finished' && b.editions[0]?.format === 'audiobook') {
      return acc + (b.editions[0].audiobookDurationMins || 600);
    }
    if (b.status === 'currently-reading' && b.editions[0]?.format === 'audiobook') {
      return acc + b.progressMinutes;
    }
    return acc;
  }, 0);

  const listeningHours = (totalListeningMins / 60).toFixed(1);

  return (
    <div className="space-y-8 pb-12">
      {/* Welcome Banner / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-[#281333] via-[#1d0e26] to-[#140a1a] text-[#f4efe6] p-6 sm:p-8 rounded-2xl shadow-2xl border border-[#c5a059]/30 relative overflow-hidden">
        <div className="space-y-2 z-10 max-w-xl">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#c5a059]/15 text-[#e5c158] text-xs font-semibold uppercase tracking-wider border border-[#c5a059]/30">
            <Sparkles className="w-3.5 h-3.5 text-[#e5c158]" />
            <span>Sanctuary of Stories</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-serif font-bold tracking-tight text-[#f4efe6]">
            Welcome Back to Your Reading Journal
          </h1>
          <p className="text-sm text-stone-300 font-sans leading-relaxed">
            You are currently immersed in <span className="font-bold text-[#e5c158]">{currentlyReading.length} books</span>. Your annual journey is {goalPercent}% complete.
          </p>
        </div>

        {/* Quick Session Start Button */}
        {currentlyReading.length > 0 && (
          <div className="z-10 shrink-0">
            <button
              onClick={() => onStartSessionForBook(currentlyReading[0])}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] hover:from-[#d4af37] hover:to-[#e5c158] text-[#120817] font-bold text-sm shadow-xl shadow-[#c5a059]/15 transition transform hover:scale-[1.02]"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Resume &quot;{currentlyReading[0].work.title}&quot;</span>
            </button>
          </div>
        )}

        {/* Decorative background embellishment */}
        <div className="absolute right-[-20px] bottom-[-30px] opacity-10 pointer-events-none text-[#c5a059]">
          <BookOpen className="w-64 h-64" />
        </div>
      </div>

      {/* Grid Section: Currently Reading & Reading Goal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Currently Reading (2 Columns on Large Screens) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#c5a059]" />
              <h2 className="text-xl font-serif font-bold text-[#f4efe6]">
                Currently Reading
              </h2>
              <span className="text-xs bg-[#c5a059]/20 text-[#e5c158] border border-[#c5a059]/30 px-2.5 py-0.5 rounded-full font-bold">
                {currentlyReading.length}
              </span>
            </div>
            {currentlyReading.length > 0 && (
              <button
                onClick={() => onNavigateToTab('library')}
                className="text-xs font-semibold text-[#c5a059] hover:text-[#e5c158] hover:underline flex items-center gap-1"
              >
                View Library <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {currentlyReading.length === 0 ? (
            <div className="bg-[#1c0f24] border border-dashed border-[#3d2647] rounded-2xl p-8 text-center space-y-3 shadow-xl">
              <BookOpen className="w-10 h-10 text-[#c5a059]/60 mx-auto" />
              <h3 className="font-serif font-bold text-lg text-[#f4efe6]">
                No Active Reading Sessions
              </h3>
              <p className="text-xs text-stone-400 max-w-sm mx-auto">
                Pick a book from your TBR list or add a new title to start tracking your reading journey.
              </p>
              <button
                onClick={() => onNavigateToTab('tbr')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] text-xs font-bold shadow-md hover:opacity-90 transition"
              >
                Explore TBR Queue
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentlyReading.map((book) => {
                const activeEdition = book.editions.find((e) => e.id === book.activeEditionId) || book.editions[0];
                const isAudio = activeEdition?.format === 'audiobook';

                return (
                  <div
                    key={book.id}
                    className="book-card-glow bg-[#1c0f24] rounded-xl p-4 flex flex-col justify-between"
                  >
                    <div className="flex gap-4">
                      {/* Book Cover */}
                      <div onClick={() => onSelectBook(book)} className="cursor-pointer">
                        <BookCover
                          work={book.work}
                          edition={activeEdition}
                          size="md"
                          progressPercentage={book.progressPercentage}
                        />
                      </div>

                      {/* Info & Progress details */}
                      <div className="flex-1 space-y-2 min-w-0">
                        <div onClick={() => onSelectBook(book)} className="cursor-pointer">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#e5c158] bg-[#c5a059]/15 px-2 py-0.5 rounded border border-[#c5a059]/30">
                            {activeEdition?.format || 'hardcover'}
                          </span>
                          <h3 className="font-serif font-bold text-base text-[#f4efe6] truncate mt-1 hover:text-[#c5a059] transition">
                            {book.work.title}
                          </h3>
                          <p className="text-xs text-stone-400 truncate">{book.work.author}</p>
                        </div>

                        {/* Progress readout */}
                        <div className="space-y-1 pt-1">
                          <div className="flex items-center justify-between text-xs text-stone-300">
                            <span>
                              {isAudio
                                ? `${Math.floor(book.progressMinutes / 60)}h ${book.progressMinutes % 60}m`
                                : `Page ${book.progressPages} of ${activeEdition?.pageCount || 300}`}
                            </span>
                            <span className="font-bold text-[#e5c158]">
                              {book.progressPercentage}%
                            </span>
                          </div>
                          <div className="w-full bg-[#2d1838] rounded-full h-2 overflow-hidden border border-[#3d2448]">
                            <div
                              className="bg-gradient-to-r from-[#c5a059] to-[#e5c158] h-full transition-all"
                              style={{ width: `${book.progressPercentage}%` }}
                            />
                          </div>
                        </div>

                        {book.lastSessionDate && (
                          <p className="text-[10px] text-stone-400">
                            Last read: {book.lastSessionDate}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="mt-4 pt-3 border-t border-[#3d2448] flex items-center gap-2">
                      <button
                        onClick={() => onStartSessionForBook(book)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] text-xs font-bold shadow-md hover:opacity-95 transition"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Start Session</span>
                      </button>

                      <button
                        onClick={() => onSelectBook(book)}
                        className="py-2 px-3 rounded-lg border border-[#c5a059]/30 bg-[#271533] text-xs font-medium text-[#f4efe6] hover:bg-[#321c40] transition"
                      >
                        Details
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Reading Goal & Annual Summary Widget */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-[#e5c158]" />
              <h2 className="text-xl font-serif font-bold text-[#f4efe6]">
                2026 Reading Goal
              </h2>
            </div>
          </div>

          <div className="bg-[#1c0f24] border border-[#c5a059]/25 rounded-2xl p-5 shadow-2xl space-y-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#c5a059]/5 rounded-full blur-2xl pointer-events-none" />
            
            {/* Goal Progress Ring / Bar */}
            <div className="space-y-2">
              <div className="flex items-end justify-between">
                <div>
                  <span className="text-3xl font-serif font-bold text-[#e5c158]">
                    {finishedBooksCount}
                  </span>
                  <span className="text-sm font-medium text-stone-400"> / {annualGoal} books</span>
                </div>
                <span className="text-xs font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                  {goalPercent}% Complete
                </span>
              </div>

              <div className="w-full bg-[#2d1838] rounded-full h-3 overflow-hidden border border-[#3d2448]">
                <div
                  className="bg-gradient-to-r from-[#c5a059] via-[#e5c158] to-[#d4af37] h-full transition-all duration-500"
                  style={{ width: `${goalPercent}%` }}
                />
              </div>
            </div>

            {/* Micro Stats Grid */}
            <div className="grid grid-cols-3 gap-2 pt-2 text-center border-t border-[#3d2448]">
              <div className="p-2.5 bg-[#25132f] border border-[#c5a059]/15 rounded-xl">
                <BookOpen className="w-4 h-4 text-[#c5a059] mx-auto mb-1" />
                <p className="text-xs font-bold text-[#f4efe6]">{totalPagesRead.toLocaleString()}</p>
                <p className="text-[10px] text-stone-400">Pages Read</p>
              </div>

              <div className="p-2.5 bg-[#25132f] border border-[#c5a059]/15 rounded-xl">
                <Headphones className="w-4 h-4 text-[#e5c158] mx-auto mb-1" />
                <p className="text-xs font-bold text-[#f4efe6]">{listeningHours}h</p>
                <p className="text-[10px] text-stone-400">Listened</p>
              </div>

              <div className="p-2.5 bg-[#25132f] border border-[#c5a059]/15 rounded-xl">
                <Flame className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                <p className="text-xs font-bold text-[#f4efe6]">14 Days</p>
                <p className="text-[10px] text-stone-400">Streak 🔥</p>
              </div>
            </div>

            {/* Quick Inspiration Quote */}
            <div className="p-3 bg-gradient-to-br from-[#25142e] to-[#170a1d] rounded-xl border border-[#c5a059]/20 text-xs text-stone-300 italic font-serif">
              &quot;A reader lives a thousand lives before he dies... The man who never reads lives only one.&quot;
            </div>
          </div>
        </div>

      </div>

      {/* Up Next (TBR Spotlight) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-[#c5a059]" />
            <h2 className="text-xl font-serif font-bold text-[#f4efe6]">
              Up Next on Your TBR
            </h2>
          </div>
          <button
            onClick={() => onNavigateToTab('tbr')}
            className="text-xs font-semibold text-[#c5a059] hover:text-[#e5c158] hover:underline flex items-center gap-1"
          >
            Explore Full TBR Queue ({books.filter((b) => b.status === 'tbr').length}) <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {upNext.map((book) => {
            const activeEdition = book.editions[0];
            return (
              <div
                key={book.id}
                className="book-card-glow bg-[#1c0f24] rounded-xl p-4 flex flex-col justify-between space-y-3"
              >
                <div className="flex gap-3">
                  <div onClick={() => onSelectBook(book)} className="cursor-pointer shrink-0">
                    <BookCover work={book.work} edition={activeEdition} size="sm" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <span className="text-[9px] uppercase font-bold text-amber-300 bg-amber-950/80 border border-amber-500/30 px-1.5 py-0.5 rounded">
                      {book.priority} Priority
                    </span>
                    <h3
                      onClick={() => onSelectBook(book)}
                      className="font-serif font-bold text-sm text-[#f4efe6] line-clamp-2 hover:text-[#c5a059] cursor-pointer"
                    >
                      {book.work.title}
                    </h3>
                    <p className="text-xs text-stone-400 truncate">{book.work.author}</p>
                    {book.work.seriesName && (
                      <p className="text-[10px] text-[#e5c158] font-medium">
                        {book.work.seriesName} #{book.work.seriesOrder}
                      </p>
                    )}
                  </div>
                </div>

                {/* Up Next Actions */}
                <div className="pt-2 border-t border-[#3d2448] flex items-center justify-between text-xs">
                  <button
                    onClick={() => onUpdateStatus(book.id, 'currently-reading')}
                    className="flex-1 py-1.5 px-2 rounded-lg bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold hover:opacity-95 text-center transition shadow-xs"
                  >
                    Start Reading
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Activity Timeline */}
      <div className="bg-[#1c0f24] border border-[#c5a059]/20 rounded-2xl p-6 shadow-xl space-y-4">
        <h2 className="text-xl font-serif font-bold text-[#f4efe6]">
          Recent Journal Activity
        </h2>

        <div className="space-y-4">
          {sessions.slice(0, 4).map((session) => {
            const book = books.find((b) => b.id === session.bookId);
            return (
              <div key={session.id} className="flex items-start gap-3 pb-3 border-b border-[#3d2448] last:border-0 last:pb-0">
                <div className="w-8 h-8 rounded-full bg-[#c5a059]/15 text-[#e5c158] border border-[#c5a059]/30 flex items-center justify-center shrink-0 mt-0.5">
                  <Clock className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[#f4efe6]">
                    Completed a <span className="font-bold text-[#e5c158]">{session.durationMinutes} min</span> session for{' '}
                    <span className="font-serif font-bold text-[#c5a059]">
                      {book?.work.title || 'a book'}
                    </span>
                  </p>
                  {session.notes && (
                    <p className="text-xs text-stone-300 italic mt-0.5 font-serif">&quot;{session.notes}&quot;</p>
                  )}
                  <div className="flex items-center gap-3 text-[10px] text-stone-400 mt-1">
                    <span>{session.date}</span>
                    {session.location && <span>• Location: {session.location}</span>}
                    {session.pagesRead && <span>• {session.pagesRead} pages</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
