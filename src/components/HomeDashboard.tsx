import React from 'react';
import { ArrowRight, BookOpen, Clock, Library, Play, Sparkles } from 'lucide-react';
import { ReadingSession, ReadingStatus, UserBookRecord } from '../types';
import { BookCover } from './BookCover';

interface HomeDashboardProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
  onStartSessionForBook: (book: UserBookRecord) => void;
  onUpdateStatus: (bookId: string, status: ReadingStatus) => void;
  onNavigateToTab: (tab: any) => void;
  onOpenAddBook: () => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  books,
  sessions,
  onSelectBook,
  onStartSessionForBook,
  onNavigateToTab,
  onOpenAddBook,
}) => {
  const currentBook = books.find((book) => book.status === 'currently-reading') ?? null;
  const finishedBooks = books.filter((book) => book.status === 'finished');
  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = sessions.filter((session) => session.date.slice(0, 10) === today);
  const todayMinutes = todaySessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const todayPages = todaySessions.reduce((sum, session) => sum + (session.pagesRead ?? 0), 0);
  const recentSessions = [...sessions]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 4);

  return (
    <div className="space-y-7 pb-24 md:pb-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inkbound-kicker">Your reading life</p>
          <h1 className="inkbound-page-title">Welcome back</h1>
          <p className="inkbound-page-copy mt-3">
            Your books, reading sessions, and memories are waiting for you.
          </p>
        </div>
        <button type="button" onClick={onOpenAddBook} className="quiet-shelf-primary-action">
          <BookOpen className="h-4 w-4" /> Add a book
        </button>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <p className="inkbound-kicker">Continue reading</p>
          {currentBook ? (
            <div className="mt-5 flex flex-col gap-5 sm:flex-row">
              <button type="button" onClick={() => onSelectBook(currentBook)} className="shrink-0 text-left">
                <BookCover
                  work={currentBook.work}
                  edition={currentBook.editions.find((item) => item.id === currentBook.activeEditionId) ?? currentBook.editions[0]}
                  size="lg"
                  progressPercentage={currentBook.progressPercentage}
                />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="font-serif text-3xl text-[var(--ink-ivory)]">{currentBook.work.title}</h2>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">{currentBook.work.author}</p>
                <div className="mt-6 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]">
                  <span className="block h-full rounded-full bg-[var(--ink-mauve)]" style={{ width: `${currentBook.progressPercentage}%` }} />
                </div>
                <p className="mt-2 text-xs text-[var(--ink-muted)]">{currentBook.progressPercentage}% complete</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button type="button" onClick={() => onStartSessionForBook(currentBook)} className="quiet-shelf-primary-action">
                    <Play className="h-4 w-4" /> Continue reading
                  </button>
                  <button type="button" onClick={() => onSelectBook(currentBook)} className="quiet-shelf-secondary-action">
                    View details
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-[var(--ink-border-subtle)] p-8 text-center">
              <Library className="mx-auto h-9 w-9 text-[var(--ink-mauve)]" />
              <h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">Choose your next story</h2>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">Start a book from your library to see it here.</p>
              <button type="button" onClick={() => onNavigateToTab('library')} className="quiet-shelf-primary-action mt-5">
                Visit library <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </section>

        <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-[var(--ink-mauve)]" />
            <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Today</h2>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Metric value={todayMinutes.toString()} label="minutes read" />
            <Metric value={todayPages.toString()} label="pages read" />
            <Metric value={finishedBooks.length.toString()} label="books finished" />
            <Metric value={books.length.toString()} label="books collected" />
          </div>
          <p className="mt-5 inline-flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <Sparkles className="h-4 w-4 text-[var(--ink-mauve)]" />
            {todaySessions.length > 0 ? `${todaySessions.length} reading ${todaySessions.length === 1 ? 'session' : 'sessions'} today.` : 'A quiet reading moment can begin whenever you are ready.'}
          </p>
        </section>
      </div>

      <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="inkbound-kicker">Recent activity</p>
            <h2 className="mt-1 font-serif text-2xl text-[var(--ink-ivory)]">Your latest reading moments</h2>
          </div>
          <button type="button" onClick={() => onNavigateToTab('sessions')} className="quiet-shelf-secondary-action">View all</button>
        </div>
        <div className="mt-5 space-y-3">
          {recentSessions.length === 0 ? (
            <p className="rounded-2xl bg-[var(--ink-surface-soft)] p-5 text-sm text-[var(--ink-muted)]">Your reading sessions will appear here.</p>
          ) : recentSessions.map((session) => {
            const book = books.find((item) => item.id === session.bookId);
            return (
              <div key={session.id} className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
                <div className="min-w-0">
                  <p className="truncate font-serif text-lg text-[var(--ink-ivory)]">{book?.work.title ?? 'Reading session'}</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">{session.date} · {session.durationMinutes} minutes</p>
                </div>
                {book && <button type="button" onClick={() => onSelectBook(book)} className="text-xs font-semibold text-[var(--ink-mauve)]">Open</button>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

const Metric: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
    <strong className="block font-serif text-3xl text-[var(--ink-ivory)]">{value}</strong>
    <span className="mt-1 block text-xs text-[var(--ink-muted)]">{label}</span>
  </div>
);
