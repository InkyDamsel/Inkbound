import React from 'react';
import { UserBookRecord, ReadingSession } from '../types';
import { BookCover } from './BookCover';
import { DashboardSidebar } from './dashboard/DashboardSidebar';
import { ResponsiveDashboardLayout, ResponsiveGrid } from '../layout/responsive';
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Clock,
  Play,
  Sparkles,
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

const priorityOrder = { top: 1, high: 2, medium: 3, low: 4 } as const;

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  books,
  sessions,
  onSelectBook,
  onStartSessionForBook,
  onUpdateStatus,
  onNavigateToTab,
}) => {
  const currentlyReading = books.filter((book) => book.status === 'currently-reading').slice(0, 3);
  const tbrBooks = books.filter((book) => book.status === 'tbr');
  const upNext = [...tbrBooks]
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .slice(0, 5);
  const recentSessions = sessions.slice(0, 5);

  return (
    <div className="space-y-7 pb-24 md:pb-12">
      <ResponsiveDashboardLayout
        sidebar={
          <DashboardSidebar
            books={books}
            sessions={recentSessions}
            onViewAllSessions={() => onNavigateToTab('sessions')}
          />
        }
        sidebarWidth={340}
        gap={28}
        contentClassName="space-y-8"
      >
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <BookOpen className="h-5 w-5 text-[#7b5b6b]" />
              <h2 className="font-serif text-2xl text-[#e8ded3]">Currently Reading</h2>
              <span className="rounded-full border border-[#7b5b6b]/20 bg-[#7b5b6b]/10 px-2.5 py-0.5 text-xs font-semibold text-[#c9bbb0]">
                {currentlyReading.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigateToTab('library')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#b6a49b] transition hover:text-[#d8cec2]"
            >
              View library <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {currentlyReading.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#7b5b6b]/20 bg-[#141116] p-10 text-center">
              <BookOpen className="mx-auto h-9 w-9 text-[#7b5b6b]/50" />
              <h3 className="mt-3 font-serif text-xl text-[#e8ded3]">Your shelf is waiting.</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-[#948984]">
                Start a book from your TBR or add something new to begin tracking your reading.
              </p>
            </div>
          ) : (
            <ResponsiveGrid minItemWidth={280} maxColumns={3} gap={16}>
              {currentlyReading.map((book) => {
                const edition =
                  book.editions.find((item) => item.id === book.activeEditionId) || book.editions[0];
                const isAudio = edition?.format === 'audiobook';

                return (
                  <article
                    key={book.id}
                    className="book-card-glow flex min-h-[288px] flex-col rounded-2xl bg-[#141116] p-4"
                  >
                    <div className="flex gap-4">
                      <button
                        type="button"
                        onClick={() => onSelectBook(book)}
                        className="shrink-0 text-left"
                      >
                        <BookCover
                          work={book.work}
                          edition={edition}
                          size="lg"
                          progressPercentage={book.progressPercentage}
                        />
                      </button>

                      <div className="min-w-0 flex-1">
                        <span className="inline-flex rounded-full border border-[#7b5b6b]/20 bg-[#7b5b6b]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#c9bbb0]">
                          {edition?.format || 'book'}
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectBook(book)}
                          className="mt-2 block w-full text-left"
                        >
                          <h3 className="line-clamp-2 font-serif text-lg leading-5 text-[#e8ded3] transition hover:text-[#c9bbb0]">
                            {book.work.title}
                          </h3>
                          <p className="mt-1 truncate text-xs text-[#948984]">{book.work.author}</p>
                        </button>

                        <div className="mt-5 space-y-2">
                          <div className="flex items-center justify-between gap-3 text-xs text-[#c1b4ac]">
                            <span className="truncate">
                              {isAudio
                                ? `${Math.floor(book.progressMinutes / 60)}h ${book.progressMinutes % 60}m listened`
                                : `Page ${book.progressPages} of ${edition?.pageCount || 300}`}
                            </span>
                            <strong className="text-[#cdbfb3]">{book.progressPercentage}%</strong>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[#2a2228]">
                            <div
                              className="h-full rounded-full bg-[linear-gradient(90deg,#6f4e5f,#c9bbb0)]"
                              style={{ width: `${book.progressPercentage}%` }}
                            />
                          </div>
                          <p className="text-[11px] text-[#7d736f]">
                            Last read: {book.lastSessionDate || 'Not recorded'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-auto grid grid-cols-[1fr_auto] gap-2 border-t border-white/5 pt-4">
                      <button
                        type="button"
                        onClick={() => onStartSessionForBook(book)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#624657] px-3 py-2.5 text-xs font-semibold text-[#e8ded3] transition hover:bg-[#745265]"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                        {isAudio ? 'Continue Listening' : 'Continue Reading'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onStartSessionForBook(book)}
                        className="rounded-xl border border-[#7b5b6b]/20 px-3 py-2.5 text-xs font-semibold text-[#d8cdd6] transition hover:border-[#7b5b6b]/45 hover:text-[#e8ded3]"
                      >
                        Start Session
                      </button>
                    </div>
                  </article>
                );
              })}
            </ResponsiveGrid>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Bookmark className="h-5 w-5 text-[#7b5b6b]" />
              <h2 className="font-serif text-2xl text-[#e8ded3]">Up Next</h2>
              <span className="text-sm text-[#857a76]">From your TBR</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigateToTab('tbr')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#b6a49b] hover:text-[#d8cec2]"
            >
              View TBR <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            {upNext.map((book) => {
              const edition =
                book.editions.find((item) => item.id === book.activeEditionId) || book.editions[0];

              return (
                <article key={book.id} className="group min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelectBook(book)}
                    className="block w-full text-left"
                  >
                    <div className="transition duration-200 group-hover:-translate-y-1">
                      <BookCover work={book.work} edition={edition} size="xl" />
                    </div>
                    <p className="mt-2 truncate text-xs text-[#c1b4ac]">{book.work.author}</p>
                    <span className="mt-1 inline-flex rounded-full bg-[#7b5b6b]/10 px-2 py-0.5 text-[10px] font-semibold capitalize text-[#b7aaa0]">
                      {book.priority} priority
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateStatus(book.id, 'currently-reading')}
                    className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-white/7 py-1.5 text-[11px] text-[#a99baa] transition hover:border-[#7b5b6b]/35 hover:text-[#e8ded3]"
                  >
                    Start reading
                  </button>
                </article>
              );
            })}

            <button
              type="button"
              onClick={() => onNavigateToTab('tbr')}
              className="flex min-h-[210px] flex-col items-center justify-center rounded-xl border border-dashed border-[#6f4e5f]/55 bg-[#141116] px-4 text-center text-[#8c687b] transition hover:border-[#8c687b] hover:bg-[#1a151a]"
            >
              <Sparkles className="mb-3 h-5 w-5" />
              <span className="font-serif text-lg leading-5">Choose My Next Read</span>
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Clock className="h-5 w-5 text-[#8c687b]" />
              <h2 className="font-serif text-2xl text-[#e8ded3]">Recent Sessions</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigateToTab('sessions')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#9a7889] hover:text-[#c7b9af]"
            >
              View all sessions <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <ResponsiveGrid minItemWidth={220} maxColumns={4} gap={12}>
            {recentSessions.slice(0, 4).map((session) => {
              const book = books.find((item) => item.id === session.bookId);
              const edition =
                book?.editions.find((item) => item.id === book.activeEditionId) ??
                book?.editions[0];

              return (
                <article
                  key={session.id}
                  className="flex min-h-[150px] gap-4 rounded-xl border border-[#7b5b6b]/14 bg-[#141116] p-4 shadow-[0_14px_34px_rgba(0,0,0,0.18)]"
                >
                  {book && (
                    <button
                      type="button"
                      onClick={() => onSelectBook(book)}
                      className="shrink-0"
                    >
                      <BookCover work={book.work} edition={edition} size="sm" />
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-[#847a75]">
                      {session.date} · {session.durationMinutes} min
                    </p>
                    <h3 className="mt-3 line-clamp-2 font-serif text-base leading-5 text-[#e8ded3]">
                      {book?.work.title ?? 'Reading Session'}
                    </h3>
                    <p className="mt-1 truncate text-xs text-[#9b9089]">
                      {book?.work.author ?? 'Inkbound'}
                    </p>
                    <p className="mt-4 truncate text-[11px] text-[#7f7470]">
                      {session.location ?? session.mood ?? 'Reading session'}
                    </p>
                  </div>
                </article>
              );
            })}
          </ResponsiveGrid>
        </section>
      </ResponsiveDashboardLayout>
    </div>
  );
};