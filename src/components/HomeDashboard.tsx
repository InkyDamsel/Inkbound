import React, { useMemo } from 'react';
import {
  ArrowRight,
  BookHeart,
  BookOpen,
  CalendarDays,
  Clock3,
  Library,
  Play,
  Quote,
  Sparkles,
  Target,
} from 'lucide-react';
import { ReadingSession, ReadingStatus, UserBookRecord } from '../types';
import { getBookReadingState } from '../features/reading/bookReadingState';
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

const annualGoal = 50;
const AWAKE_LUMIS_ASSET = '/assets/lumis/lumis-awake.svg';
const SLEEPING_LUMIS_ASSET = '/assets/lumis/lumis-sleeping.svg';
const RECENT_READING_WINDOW_MS = 6 * 60 * 60 * 1000;

const getSessionTimestamp = (session: ReadingSession): number => {
  const time = session.endTime || session.startTime || '12:00';
  const timestamp = new Date(`${session.date}T${time}`).getTime();
  return Number.isNaN(timestamp) ? new Date(session.date).getTime() : timestamp;
};

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  books,
  sessions,
  onSelectBook,
  onStartSessionForBook,
  onUpdateStatus,
  onNavigateToTab,
  onOpenAddBook,
}) => {
  const now = new Date();
  const greeting = getGreeting(now.getHours());
  const month = now.getMonth();
  const year = now.getFullYear();

  const currentlyReading = books.filter((book) => book.status === 'currently-reading');
  const currentBook = currentlyReading[0] ?? null;
  const finishedBooks = books.filter((book) => book.status === 'finished');
  const recentlyFinished = [...finishedBooks]
    .filter((book) => Boolean(book.dateFinished))
    .sort((a, b) => new Date(b.dateFinished ?? 0).getTime() - new Date(a.dateFinished ?? 0).getTime())
    .slice(0, 5);

  const monthSessions = sessions.filter((session) => {
    const date = new Date(session.date);
    return date.getMonth() === month && date.getFullYear() === year;
  });
  const monthFinished = finishedBooks.filter((book) => {
    if (!book.dateFinished) return false;
    const date = new Date(book.dateFinished);
    return date.getMonth() === month && date.getFullYear() === year;
  });
  const monthMinutes = monthSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const monthPages = monthSessions.reduce((sum, session) => sum + (session.pagesRead ?? 0), 0);
  const goalPercent = Math.min(100, Math.round((finishedBooks.length / annualGoal) * 100));

  const recentMemory = useMemo(() => {
    const withQuotes = books
      .filter((book) => Boolean(book.favoriteQuotes?.length))
      .sort((a, b) => new Date(b.lastSessionDate ?? b.dateAdded).getTime() - new Date(a.lastSessionDate ?? a.dateAdded).getTime())[0];
    if (withQuotes?.favoriteQuotes?.[0]) {
      return { type: 'quote' as const, book: withQuotes, text: withQuotes.favoriteQuotes[0].quote };
    }
    const withReview = books
      .filter((book) => Boolean(book.review?.trim()))
      .sort((a, b) => new Date(b.dateFinished ?? b.dateAdded).getTime() - new Date(a.dateFinished ?? a.dateAdded).getTime())[0];
    if (withReview?.review) return { type: 'review' as const, book: withReview, text: withReview.review };
    return null;
  }, [books]);

  const collections = useMemo(() => {
    const counts = new Map<string, number>();
    books.forEach((book) => book.collections.forEach((collection) => counts.set(collection, (counts.get(collection) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [books]);

  const recentSession = useMemo(() => [...sessions].sort((a, b) => getSessionTimestamp(b) - getSessionTimestamp(a))[0], [sessions]);
  const isAwakePose = Boolean(recentSession && Date.now() - getSessionTimestamp(recentSession) <= RECENT_READING_WINDOW_MS);
  const lumisPortrait = isAwakePose
    ? { src: AWAKE_LUMIS_ASSET, alt: 'Lumis, an alert purple library dragon resting on a book beside a candle and tea', title: 'Lumis is curled up by your newest book', detail: 'Eager for your next adventure.' }
    : { src: SLEEPING_LUMIS_ASSET, alt: 'Lumis, a sleeping purple library dragon resting on a book beside a candle and tea', title: 'Lumis is resting after a day of stories', detail: "Dreaming of tomorrow's adventures." };

  return (
    <div className="space-y-8 pb-24 md:pb-12">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inkbound-kicker">Your reading life</p>
          <h1 className="inkbound-page-title">{greeting}</h1>
          <p className="inkbound-page-copy mt-3 max-w-2xl">Welcome back. Your books, memories, and quiet reading moments are all here.</p>
        </div>
        <button type="button" onClick={onOpenAddBook} className="quiet-shelf-primary-action"><BookOpen className="h-4 w-4" /> Add a book</button>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <ContinueReadingCard book={currentBook} onSelectBook={onSelectBook} onStartSessionForBook={onStartSessionForBook} onNavigateToLibrary={() => onNavigateToTab('library')} />
        <button type="button" onClick={() => onNavigateToTab('my-dragon')} className="inkbound-panel group overflow-hidden rounded-3xl text-left transition hover:border-[var(--ink-border-strong)]" aria-label="Open My Dragon">
          <div className="p-5 pb-4 sm:p-6 sm:pb-4"><div className="flex items-center justify-between gap-3"><div><p className="inkbound-kicker">Your companion</p><h2 className="mt-1 font-serif text-2xl text-[var(--ink-ivory)]">Lumis</h2></div><Sparkles className="h-5 w-5 text-[var(--ink-mauve)] transition group-hover:scale-110" /></div></div>
          <div className="mx-5 overflow-hidden rounded-2xl border border-[var(--ink-border-subtle)] bg-[#171117] sm:mx-6"><img src={lumisPortrait.src} alt={lumisPortrait.alt} className="aspect-[16/9] w-full object-cover" /><div className="border-t border-white/10 bg-[#171117] px-5 py-4 text-center"><p className="font-serif text-lg leading-6 text-[#f2e9df]">{lumisPortrait.title}</p><p className="mt-1 text-xs leading-5 text-[#b9a9b5]">{lumisPortrait.detail}</p></div></div>
          <p className="px-5 py-4 text-xs leading-6 text-[var(--ink-muted)] sm:px-6">Lumis stays quiet, notices your reading life, and never interrupts it.</p>
        </button>
      </div>

      <section><SectionHeading icon={<CalendarDays className="h-5 w-5" />} eyebrow="This month" title="Your reading at a glance" /><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard value={monthFinished.length.toString()} label="books finished" /><MetricCard value={formatHours(monthMinutes)} label="hours read" /><MetricCard value={monthPages.toLocaleString()} label="pages read" /><MetricCard value={monthSessions.length.toString()} label="reading sessions" /></div></section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <section className="inkbound-panel rounded-3xl p-5 sm:p-7"><div className="flex items-center justify-between gap-4"><SectionHeading icon={<Quote className="h-5 w-5" />} eyebrow="Recent memory" title="Something worth keeping" /><button type="button" onClick={() => onNavigateToTab('memories')} className="quiet-shelf-secondary-action hidden sm:inline-flex">View memories</button></div>{recentMemory ? <button type="button" onClick={() => onSelectBook(recentMemory.book)} className="mt-5 w-full rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5 text-left transition hover:border-[var(--ink-border-strong)]"><p className="line-clamp-4 font-serif text-xl italic leading-8 text-[var(--ink-ivory)]">“{recentMemory.text}”</p><p className="mt-4 text-xs text-[var(--ink-muted)]">{recentMemory.type === 'quote' ? 'Favorite quote' : 'Your review'} · {recentMemory.book.work.title}</p></button> : <div className="mt-5 rounded-2xl border border-dashed border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-6"><BookHeart className="h-6 w-6 text-[var(--ink-mauve)]" /><p className="mt-3 font-serif text-xl text-[var(--ink-ivory)]">Your first memory is waiting.</p><p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Save a quote or review and it will quietly return here.</p></div>}</section>
        <section className="inkbound-panel rounded-3xl p-5 sm:p-7"><SectionHeading icon={<Target className="h-5 w-5" />} eyebrow="Reading goal" title={`${finishedBooks.length} of ${annualGoal} books`} /><div className="mt-6 flex items-center gap-5"><div className="relative grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(var(--ink-mauve) ${goalPercent * 3.6}deg, var(--ink-surface-soft) 0deg)` }}><div className="grid h-[74px] w-[74px] place-items-center rounded-full bg-[var(--ink-surface-raised)]"><strong className="font-serif text-2xl text-[var(--ink-ivory)]">{goalPercent}%</strong></div></div><div><p className="text-sm leading-6 text-[var(--ink-muted)]">You are building a reading year one story at a time.</p><button type="button" onClick={() => onNavigateToTab('challenges')} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--ink-mauve)]">View reading goals <ArrowRight className="h-3.5 w-3.5" /></button></div></div></section>
      </div>

      <BookRow title="Currently Reading" eyebrow="Continue your journey" books={currentlyReading} emptyText="Start a book and it will appear here." actionLabel="View library" onAction={() => onNavigateToTab('library')} onSelectBook={onSelectBook} onStart={(book) => onStartSessionForBook(book)} />
      <BookRow title="Recently Finished" eyebrow="Stories you have carried" books={recentlyFinished} emptyText="Finished books will collect here." actionLabel="View timeline" onAction={() => onNavigateToTab('timeline')} onSelectBook={onSelectBook} />

      <section className="inkbound-panel rounded-3xl p-5 sm:p-7"><div className="flex items-center justify-between gap-4"><SectionHeading icon={<Library className="h-5 w-5" />} eyebrow="Your shelves" title="Collections" /><button type="button" onClick={() => onNavigateToTab('collections')} className="quiet-shelf-secondary-action">View all</button></div>{collections.length > 0 ? <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{collections.map(([name, count]) => <button key={name} type="button" onClick={() => onNavigateToTab('collections')} className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-left transition hover:border-[var(--ink-border-strong)]"><p className="font-serif text-lg text-[var(--ink-ivory)]">{name}</p><p className="mt-2 text-xs text-[var(--ink-muted)]">{count} {count === 1 ? 'book' : 'books'}</p></button>)}</div> : <div className="mt-5 rounded-2xl border border-dashed border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-6"><p className="font-serif text-xl text-[var(--ink-ivory)]">Curate your first collection.</p><p className="mt-2 text-sm text-[var(--ink-muted)]">Group books by mood, genre, season, or anything meaningful to you.</p></div>}</section>

      {currentlyReading.length === 0 && books.some((book) => book.status === 'tbr') && <section className="inkbound-panel rounded-3xl p-5 sm:p-7"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="inkbound-kicker">A gentle suggestion</p><h2 className="mt-1 font-serif text-2xl text-[var(--ink-ivory)]">Choose something from your TBR</h2><p className="mt-2 text-sm text-[var(--ink-muted)]">Your next story may already be waiting.</p></div><button type="button" onClick={() => { const nextBook = books.find((book) => book.status === 'tbr'); if (nextBook) onUpdateStatus(nextBook.id, 'currently-reading'); }} className="quiet-shelf-primary-action">Start next book</button></div></section>}
    </div>
  );
};

interface ContinueReadingCardProps {
  book: UserBookRecord | null;
  onSelectBook: (book: UserBookRecord) => void;
  onStartSessionForBook: (book: UserBookRecord) => void;
  onNavigateToLibrary: () => void;
}

const ContinueReadingCard: React.FC<ContinueReadingCardProps> = ({ book, onSelectBook, onStartSessionForBook, onNavigateToLibrary }) => {
  const readingState = book ? getBookReadingState(book) : null;
  return (
    <section className="inkbound-panel overflow-hidden rounded-3xl p-5 sm:p-7">
      <p className="inkbound-kicker">Continue reading</p>
      {book && readingState ? (
        <div className="mt-5 flex flex-col gap-6 sm:flex-row">
          <button type="button" onClick={() => onSelectBook(book)} className="shrink-0 text-left">
            <BookCover work={book.work} edition={readingState.activeEdition} size="lg" progressPercentage={readingState.progressPercentage} isFinished={readingState.isFinished} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-3xl leading-tight text-[var(--ink-ivory)] sm:text-4xl">{book.work.title}</h2>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">{book.work.author}</p>
            <p className="mt-4 line-clamp-3 max-w-2xl text-sm leading-7 text-[var(--ink-text-secondary)]">{book.work.personalSummary ?? book.work.summary}</p>
            <div className="mt-6">
              <div className="flex items-center justify-between gap-4 text-xs text-[var(--ink-muted)]">
                <span>{readingState.progressNeedsCorrection ? 'Progress needs correction' : `${readingState.progressPercentage}% complete`}</span>
                <span>{book.lastSessionDate ? `Last read ${book.lastSessionDate}` : 'Ready when you are'}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ink-surface-soft)]"><span className="block h-full rounded-full bg-[linear-gradient(90deg,var(--ink-mauve),var(--ink-lavender,#aa95b8))]" style={{ width: `${readingState.progressPercentage}%` }} /></div>
            </div>
            <div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={() => onStartSessionForBook(book)} className="quiet-shelf-primary-action"><Play className="h-4 w-4" /> Continue reading</button><button type="button" onClick={() => onSelectBook(book)} className="quiet-shelf-secondary-action">View details</button></div>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-8 text-center"><Library className="mx-auto h-9 w-9 text-[var(--ink-mauve)]" /><h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">Choose your next story</h2><p className="mt-2 text-sm text-[var(--ink-muted)]">Start a book from your library and it will be waiting here.</p><button type="button" onClick={onNavigateToLibrary} className="quiet-shelf-primary-action mt-5">Visit library <ArrowRight className="h-4 w-4" /></button></div>
      )}
    </section>
  );
};

interface BookRowProps { title: string; eyebrow: string; books: UserBookRecord[]; emptyText: string; actionLabel: string; onAction: () => void; onSelectBook: (book: UserBookRecord) => void; onStart?: (book: UserBookRecord) => void; }

const BookRow: React.FC<BookRowProps> = ({ title, eyebrow, books, emptyText, actionLabel, onAction, onSelectBook, onStart }) => (
  <section><div className="flex items-end justify-between gap-4"><div><p className="inkbound-kicker">{eyebrow}</p><h2 className="mt-1 font-serif text-2xl text-[var(--ink-ivory)]">{title}</h2></div><button type="button" onClick={onAction} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ink-mauve)]">{actionLabel} <ArrowRight className="h-3.5 w-3.5" /></button></div>{books.length > 0 ? <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{books.slice(0, 5).map((book) => { const readingState = getBookReadingState(book); return <article key={book.id} className="group min-w-0"><button type="button" onClick={() => onSelectBook(book)} className="block w-full text-left"><div className="transition duration-200 group-hover:-translate-y-1"><BookCover work={book.work} edition={readingState.activeEdition} size="lg" progressPercentage={readingState.progressPercentage} isFinished={readingState.isFinished} /></div><h3 className="mt-3 line-clamp-2 font-serif text-base text-[var(--ink-ivory)]">{book.work.title}</h3><p className="mt-1 truncate text-xs text-[var(--ink-muted)]">{book.work.author}</p></button>{onStart && <button type="button" onClick={() => onStart(book)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--ink-mauve)]"><Play className="h-3.5 w-3.5" /> Continue</button>}</article>; })}</div> : <div className="mt-4 rounded-2xl border border-dashed border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-6 text-sm text-[var(--ink-muted)]">{emptyText}</div>}</section>
);

const SectionHeading: React.FC<{ icon: React.ReactNode; eyebrow: string; title: string }> = ({ icon, eyebrow, title }) => <div className="flex items-center gap-3"><span className="text-[var(--ink-mauve)]">{icon}</span><div><p className="inkbound-kicker">{eyebrow}</p><h2 className="mt-1 font-serif text-2xl text-[var(--ink-ivory)]">{title}</h2></div></div>;
const MetricCard: React.FC<{ value: string; label: string }> = ({ value, label }) => <div className="inkbound-panel rounded-2xl p-5"><strong className="block font-serif text-3xl text-[var(--ink-ivory)]">{value}</strong><span className="mt-2 block text-xs text-[var(--ink-muted)]">{label}</span></div>;
function getGreeting(hour: number): string { if (hour < 12) return 'Good morning'; if (hour < 18) return 'Good afternoon'; return 'Good evening'; }
function formatHours(minutes: number): string { if (minutes === 0) return '0'; const hours = minutes / 60; return hours >= 10 ? Math.round(hours).toString() : hours.toFixed(1); }
