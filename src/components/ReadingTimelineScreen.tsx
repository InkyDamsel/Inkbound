import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock3,
  MessageSquareText,
  NotebookPen,
  Plus,
  Quote,
  Search,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';

interface ReadingTimelineScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
}

type TimelineFilter = 'all' | 'books' | 'sessions' | 'reviews' | 'quotes' | 'memories';
type TimelineEventType = Exclude<TimelineFilter, 'all'>;

interface ManualMemory {
  id: string;
  date: string;
  title: string;
  body: string;
  bookId?: string;
}

interface TimelineEvent {
  id: string;
  date: string;
  type: TimelineEventType;
  title: string;
  description: string;
  bookId?: string;
  meta?: string;
}

const FILTER_KEY = 'inkbound_timeline_filter';
const SEARCH_KEY = 'inkbound_timeline_search';
const COLLAPSED_KEY = 'inkbound_timeline_collapsed_months';
const MEMORIES_KEY = 'inkbound_timeline_memories';

const filterOptions: Array<{ id: TimelineFilter; label: string }> = [
  { id: 'all', label: 'Everything' },
  { id: 'books', label: 'Books' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'quotes', label: 'Quotes' },
  { id: 'memories', label: 'Memories' },
];

const eventIcon = {
  books: BookOpen,
  sessions: Clock3,
  reviews: MessageSquareText,
  quotes: Quote,
  memories: Sparkles,
} satisfies Record<TimelineEventType, React.ComponentType<{ className?: string }>>;

const normalizeDate = (value?: string) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const monthKeyFor = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export const ReadingTimelineScreen: React.FC<ReadingTimelineScreenProps> = ({
  books,
  sessions,
  onSelectBook,
}) => {
  const [filter, setFilter] = usePersistentState<TimelineFilter>(FILTER_KEY, 'all');
  const [search, setSearch] = usePersistentState(SEARCH_KEY, '');
  const [collapsedMonths, setCollapsedMonths] = usePersistentState<string[]>(COLLAPSED_KEY, []);
  const [memories, setMemories] = usePersistentState<ManualMemory[]>(MEMORIES_KEY, []);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [memoryTitle, setMemoryTitle] = useState('');
  const [memoryBody, setMemoryBody] = useState('');
  const [memoryBookId, setMemoryBookId] = useState('');

  const events = useMemo<TimelineEvent[]>(() => {
    const nextEvents: TimelineEvent[] = [];

    books.forEach((book) => {
      const added = normalizeDate(book.dateAdded);
      if (added) {
        nextEvents.push({
          id: `added-${book.id}`,
          date: added.toISOString(),
          type: 'books',
          title: `Added ${book.work.title}`,
          description: `${book.work.author} joined your Inkbound library.`,
          bookId: book.id,
          meta: 'Book added',
        });
      }

      const started = normalizeDate(book.dateStarted);
      if (started) {
        nextEvents.push({
          id: `started-${book.id}`,
          date: started.toISOString(),
          type: 'books',
          title: `Started ${book.work.title}`,
          description: `Your reading journey with ${book.work.author} began.`,
          bookId: book.id,
          meta: 'Started reading',
        });
      }

      const finished = normalizeDate(book.dateFinished);
      if (finished) {
        nextEvents.push({
          id: `finished-${book.id}`,
          date: finished.toISOString(),
          type: 'books',
          title: `Finished ${book.work.title}`,
          description: book.rating ? `You rated it ${book.rating} out of 5 stars.` : 'Another reading journey completed.',
          bookId: book.id,
          meta: book.rating ? `${book.rating.toFixed(1)} stars` : 'Finished book',
        });
      }

      if (book.review?.trim()) {
        const reviewDate = finished ?? normalizeDate(book.lastSessionDate) ?? added;
        if (reviewDate) {
          nextEvents.push({
            id: `review-${book.id}`,
            date: reviewDate.toISOString(),
            type: 'reviews',
            title: `Reviewed ${book.work.title}`,
            description: book.review.trim(),
            bookId: book.id,
            meta: book.rating ? `${book.rating.toFixed(1)} stars` : 'Personal review',
          });
        }
      }

      book.favoriteQuotes?.forEach((quote, index) => {
        const quoteDate = finished ?? normalizeDate(book.lastSessionDate) ?? added;
        if (!quoteDate) return;
        nextEvents.push({
          id: `quote-${book.id}-${quote.id || index}`,
          date: new Date(quoteDate.getTime() + index * 1000).toISOString(),
          type: 'quotes',
          title: `Saved a quote from ${book.work.title}`,
          description: `“${quote.quote}”`,
          bookId: book.id,
          meta: quote.pageOrChapter || 'Favorite quote',
        });
      });
    });

    sessions.forEach((session) => {
      const date = normalizeDate(session.date) ?? normalizeDate(session.endTime) ?? normalizeDate(session.startTime);
      if (!date) return;
      const book = books.find((item) => item.id === session.bookId);
      const progress = session.pagesRead
        ? `${session.pagesRead} pages`
        : session.minutesListened
          ? `${session.minutesListened} listening minutes`
          : `${session.durationMinutes} minutes`;
      nextEvents.push({
        id: `session-${session.id}`,
        date: date.toISOString(),
        type: 'sessions',
        title: book ? `Read ${book.work.title}` : 'Reading session',
        description: session.notes?.trim() || `${session.durationMinutes} minutes of reading time.`,
        bookId: book?.id,
        meta: progress,
      });
    });

    memories.forEach((memory) => {
      const date = normalizeDate(memory.date);
      if (!date) return;
      nextEvents.push({
        id: `memory-${memory.id}`,
        date: date.toISOString(),
        type: 'memories',
        title: memory.title,
        description: memory.body,
        bookId: memory.bookId,
        meta: 'Reading memory',
      });
    });

    return nextEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [books, memories, sessions]);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      if (filter !== 'all' && event.type !== filter) return false;
      if (!query) return true;
      const book = event.bookId ? books.find((item) => item.id === event.bookId) : undefined;
      return [event.title, event.description, event.meta, book?.work.author, book?.work.title]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [books, events, filter, search]);

  const groupedEvents = useMemo(() => {
    const groups = new Map<string, TimelineEvent[]>();
    filteredEvents.forEach((event) => {
      const date = new Date(event.date);
      const key = monthKeyFor(date);
      groups.set(key, [...(groups.get(key) ?? []), event]);
    });
    return [...groups.entries()];
  }, [filteredEvents]);

  const toggleMonth = (key: string) => {
    setCollapsedMonths((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  const saveMemory = () => {
    const title = memoryTitle.trim();
    const body = memoryBody.trim();
    if (!title || !body) return;
    setMemories((current) => [
      {
        id: `${Date.now()}`,
        date: new Date().toISOString(),
        title,
        body,
        bookId: memoryBookId || undefined,
      },
      ...current,
    ]);
    setMemoryTitle('');
    setMemoryBody('');
    setMemoryBookId('');
    setIsMemoryOpen(false);
  };

  return (
    <div className="space-y-7 pb-24">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inkbound-kicker">Your Reading Life</p>
          <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Reading Timeline</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
            A living journal generated from your books and sessions, with space for the memories only you can tell.
          </p>
        </div>
        <button type="button" onClick={() => setIsMemoryOpen(true)} className="quiet-shelf-primary-action px-5">
          <Plus className="h-4 w-4" /> Add Memory
        </button>
      </header>

      <section className="inkbound-panel rounded-3xl p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {filterOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={`min-h-10 shrink-0 rounded-full border px-4 text-xs font-bold ${
                  filter === option.id
                    ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-soft)] text-[var(--ink-ivory)]'
                    : 'border-[var(--ink-border)] text-[var(--ink-muted)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="relative block w-full lg:max-w-sm">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search books, authors, notes, quotes..."
              className="min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] pl-11 pr-4 text-sm text-[var(--ink-ivory)] outline-none"
            />
          </label>
        </div>
      </section>

      <div className="space-y-6">
        {groupedEvents.map(([key, monthEvents]) => {
          const date = new Date(monthEvents[0].date);
          const label = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
          const collapsed = collapsedMonths.includes(key);
          return (
            <section key={key} className="inkbound-panel overflow-hidden rounded-3xl">
              <button
                type="button"
                onClick={() => toggleMonth(key)}
                className="flex min-h-16 w-full items-center justify-between border-b border-[var(--ink-border-subtle)] px-5 text-left sm:px-7"
              >
                <span>
                  <strong className="font-serif text-xl text-[var(--ink-ivory)]">{label}</strong>
                  <small className="ml-3 text-[var(--ink-muted)]">{monthEvents.length} moments</small>
                </span>
                {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </button>

              {!collapsed && (
                <div className="divide-y divide-[var(--ink-border-subtle)]">
                  {monthEvents.map((event) => {
                    const Icon = eventIcon[event.type];
                    const book = event.bookId ? books.find((item) => item.id === event.bookId) : undefined;
                    return (
                      <article key={event.id} className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:p-7">
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--ink-surface-soft)] text-[var(--ink-gold)]">
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-serif text-lg font-bold text-[var(--ink-ivory)]">{event.title}</h2>
                            {event.meta && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)]">{event.meta}</span>}
                          </div>
                          <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--ink-muted)]">{event.description}</p>
                          {book && (
                            <button type="button" onClick={() => onSelectBook(book)} className="mt-3 text-xs font-bold text-[var(--ink-gold-bright)] hover:underline">
                              Open {book.work.title}
                            </button>
                          )}
                        </div>
                        <time className="text-xs text-[var(--ink-muted)] sm:text-right">
                          {new Date(event.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </time>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {groupedEvents.length === 0 && (
        <div className="rounded-3xl border border-dashed border-[var(--ink-border)] p-10 text-center">
          <CalendarDays className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">No moments match this view</h2>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Try another filter or add a reading memory.</p>
        </div>
      )}

      {isMemoryOpen && (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4">
          <section className="inkbound-panel w-full max-w-xl rounded-t-3xl p-5 sm:rounded-3xl sm:p-7" role="dialog" aria-modal="true" aria-label="Add reading memory">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="inkbound-kicker">Time Capsule</p>
                <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Add a Reading Memory</h2>
              </div>
              <button type="button" onClick={() => setIsMemoryOpen(false)} className="quiet-shelf-icon-button" aria-label="Close"><X /></button>
            </div>
            <div className="mt-6 grid gap-4">
              <label className="text-sm font-semibold text-[var(--ink-ivory)]">Book (optional)
                <select value={memoryBookId} onChange={(event) => setMemoryBookId(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]">
                  <option value="">No specific book</option>
                  {books.map((book) => <option key={book.id} value={book.id}>{book.work.title}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold text-[var(--ink-ivory)]">Title
                <input value={memoryTitle} onChange={(event) => setMemoryTitle(event.target.value)} placeholder="Vacation reading, a difficult week, a perfect ending..." className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]" />
              </label>
              <label className="text-sm font-semibold text-[var(--ink-ivory)]">What do you want to remember?
                <textarea rows={5} value={memoryBody} onChange={(event) => setMemoryBody(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-[var(--ink-ivory)]" />
              </label>
            </div>
            <button type="button" onClick={saveMemory} disabled={!memoryTitle.trim() || !memoryBody.trim()} className="quiet-shelf-primary-action mt-6 min-h-12 w-full justify-center disabled:opacity-50">
              <NotebookPen className="h-4 w-4" /> Save Memory
            </button>
          </section>
        </div>
      )}
    </div>
  );
};
