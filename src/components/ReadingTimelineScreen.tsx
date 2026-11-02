import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock3,
  MessageSquareText,
  NotebookPen,
  Quote,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X,
  Repeat2,
} from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { hasTrustworthyFinishedHistory, isImportedBook } from '../features/reading/inkboundActivity';
import { getReadingCompletions } from '../features/reading/bookReadingState';
import {
  getSessionDurationMinutes,
  getSessionListeningMinutes,
  getSessionPagesRead,
} from '../features/reading/sessionAnalytics';
import { ACCOUNT_DATA_STORAGE_KEYS } from '../features/sync/storageKeys';

interface ReadingTimelineScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
}

type TimelineFilter = 'all' | 'books' | 'rereads' | 'sessions' | 'reviews' | 'quotes' | 'memories';
type TimelineEventType = Exclude<TimelineFilter, 'all'>;

interface ManualMemory {
  id: string;
  date: string;
  title: string;
  body: string;
  bookId?: string;
}

interface SavedReadingMemory {
  feeling?: string;
  lifeMoment?: string;
  futureSelfLetter?: string;
  favoriteMoment?: string;
  updatedAt?: string;
}

interface DeletedManualMemory {
  memory: ManualMemory;
  index: number;
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
const MEMORIES_KEY = ACCOUNT_DATA_STORAGE_KEYS.timelineMemories;
const UNDO_DELETE_MS = 7000;

const filterOptions: Array<{ id: TimelineFilter; label: string }> = [
  { id: 'all', label: 'Everything' },
  { id: 'books', label: 'Books' },
  { id: 'rereads', label: 'Rereads' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'quotes', label: 'Quotes' },
  { id: 'memories', label: 'Memories' },
];

const eventIcon = {
  books: BookOpen,
  rereads: Repeat2,
  sessions: Clock3,
  reviews: MessageSquareText,
  quotes: Quote,
  memories: Sparkles,
} satisfies Record<TimelineEventType, React.ComponentType<{ className?: string }>>;

const normalizeDate = (value?: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, yearText, monthText, dayText] = dateOnly;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : null;
  }
  const parsed = new Date(trimmed);
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
  // Read the canonical Reading Memories records without copying or mutating them.
  const [readingMemories] = usePersistentState<Record<string, SavedReadingMemory>>(
    ACCOUNT_DATA_STORAGE_KEYS.readingMemories, {},
  );
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [memoryTitle, setMemoryTitle] = useState('');
  const [memoryBody, setMemoryBody] = useState('');
  const [memoryBookId, setMemoryBookId] = useState('');
  const [deletedMemory, setDeletedMemory] = useState<DeletedManualMemory | null>(null);

  useEffect(() => {
    if (!deletedMemory) return undefined;
    const timer = window.setTimeout(() => setDeletedMemory(null), UNDO_DELETE_MS);
    return () => window.clearTimeout(timer);
  }, [deletedMemory]);

  const events = useMemo<TimelineEvent[]>(() => {
    const nextEvents: TimelineEvent[] = [];

    books.forEach((book) => {
      const isImported = isImportedBook(book);
      const added = normalizeDate(book.dateAdded);
      const finished = hasTrustworthyFinishedHistory(book) ? normalizeDate(book.dateFinished) : null;

      // Imported library dates describe the source library, not necessarily actions
      // that happened inside Inkbound. Keep native chronology clean instead of
      // presenting imported metadata as if Inkbound witnessed it.
      if (!isImported && added) {
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

      const started = !isImported ? normalizeDate(book.dateStarted) : null;
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

      if (finished && !isImported) {
        nextEvents.push({
          id: `finished-${book.id}`,
          date: finished.toISOString(),
          type: 'books',
          title: `Finished ${book.work.title}`,
          description: book.rating ? `You rated it ${book.rating} out of 5 stars.` : 'Another reading journey completed.',
          bookId: book.id,
          meta: book.rating ? `${book.rating.toFixed(1)} stars` : 'Finished book',
        });
      } else if (finished && isImported && book.importFinishedDateProvided === true) {
        nextEvents.push({
          id: `imported-finished-${book.id}`,
          date: finished.toISOString(),
          type: 'books',
          title: `Imported history: Finished ${book.work.title}`,
          description: `This valid finish date came from ${book.sourceOfImport || 'your imported library'} and is shown as historical context, not tracked Inkbound activity.`,
          bookId: book.id,
          meta: 'Imported history',
        });
      } else if (finished && isImported) {
        // The record is imported, but the valid persisted finish date was not
        // supplied as imported history. Treat it as a normal finish (for example,
        // when the reader later marks the book Finished inside Inkbound).
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

      const completions = getReadingCompletions(book);
      completions.slice(1).forEach((completion, rereadIndex) => {
        const rereadDate = normalizeDate(completion.date);
        if (!rereadDate) return;
        nextEvents.push({
          id: `reread-${book.id}-${completion.id}`,
          date: rereadDate.toISOString(),
          type: 'rereads',
          title: `Reread ${book.work.title}`,
          description: `Completed read #${rereadIndex + 2} of ${book.work.title}.`,
          bookId: book.id,
          meta: `Read ×${rereadIndex + 2}`,
        });
      });

      // Imported reviews and quotes do not currently carry their own provenance
      // timestamps. Showing them on a finish/session/add date would manufacture a
      // chronology, so they stay on the book record until Inkbound has a real
      // created-at timestamp for those fields.
      if (!isImported && book.review?.trim()) {
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

      if (!isImported) {
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
      }
    });

    sessions.forEach((session) => {
      const durationMinutes = getSessionDurationMinutes(session);
      if (durationMinutes <= 0) return;
      const date = normalizeDate(session.date);
      if (!date) return;
      const book = books.find((item) => item.id === session.bookId);
      const pagesRead = getSessionPagesRead(session);
      const minutesListened = getSessionListeningMinutes(session);
      const progress = pagesRead > 0
        ? `${pagesRead} pages`
        : minutesListened > 0
          ? `${Math.round(minutesListened)} listening minutes`
          : `${durationMinutes} minutes`;
      nextEvents.push({
        id: `session-${session.id}`,
        date: date.toISOString(),
        type: 'sessions',
        title: book ? `Read ${book.work.title}` : 'Reading session',
        description: session.notes?.trim() || `${durationMinutes} minutes of reading time.`,
        bookId: book?.id,
        meta: progress,
      });
    });

    // Reading Memories owns these records. Timeline is only a chronological view.
    // updatedAt describes the last edit, not the original moment of reading.
    Object.entries(readingMemories).forEach(([bookId, memory]) => {
      const date = normalizeDate(memory.updatedAt);
      if (!date) return;
      const book = books.find((item) => item.id === bookId);
      const sections = [
        ['How it felt', memory.feeling],
        ['Life around the book', memory.lifeMoment],
        ['Favorite moment', memory.favoriteMoment],
        ['Letter to future self', memory.futureSelfLetter],
      ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()));
      if (!sections.length) return;
      nextEvents.push({
        id: `reading-memory-${bookId}`,
        date: date.toISOString(),
        type: 'memories',
        title: book ? `Added a reading memory for ${book.work.title}` : 'Added a reading memory',
        description: 'A personal reading reflection was saved in Reading Memories.',
        bookId: book?.id,
        meta: 'Reading memory · last updated',
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
  }, [books, memories, readingMemories, sessions]);

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
        id: crypto.randomUUID(),
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

  const deleteManualMemory = (eventId: string) => {
    const memoryId = eventId.startsWith('memory-') ? eventId.slice('memory-'.length) : eventId;
    const index = memories.findIndex((memory) => memory.id === memoryId);
    if (index < 0) return;
    setDeletedMemory({ memory: memories[index], index });
    setMemories((current) => current.filter((memory) => memory.id !== memoryId));
  };

  const undoDeleteMemory = () => {
    if (!deletedMemory) return;
    setMemories((current) => {
      if (current.some((memory) => memory.id === deletedMemory.memory.id)) return current;
      const next = [...current];
      next.splice(Math.min(deletedMemory.index, next.length), 0, deletedMemory.memory);
      return next;
    });
    setDeletedMemory(null);
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
      </header>

      <section className="inkbound-panel rounded-3xl p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {filterOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={`min-h-11 shrink-0 rounded-full border px-4 text-xs font-bold ${
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
                <span className="min-w-0">
                  <strong className="block truncate font-serif text-xl text-[var(--ink-ivory)] sm:inline">{label}</strong>
                  <small className="mt-1 block text-[var(--ink-muted)] sm:ml-3 sm:inline">{monthEvents.length} moments</small>
                </span>
                {collapsed ? <ChevronRight className="h-5 w-5 shrink-0" /> : <ChevronDown className="h-5 w-5 shrink-0" />}
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
                            <h2 className="break-words font-serif text-lg font-bold text-[var(--ink-ivory)]">{event.title}</h2>
                            {event.meta && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)]">{event.meta}</span>}
                          </div>
                          <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--ink-muted)]">{event.description}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            {book && (
                              <button type="button" onClick={() => onSelectBook(book)} className="min-h-11 py-2 text-xs font-bold text-[var(--ink-gold-bright)] hover:underline">
                                Open {book.work.title}
                              </button>
                            )}
                            {event.type === 'memories' && event.id.startsWith('memory-') && (
                              <button type="button" onClick={() => deleteManualMemory(event.id)} className="inline-flex min-h-11 items-center gap-2 py-2 text-xs font-bold text-[var(--ink-muted)] hover:text-red-300">
                                <Trash2 className="h-4 w-4" /> Delete memory
                              </button>
                            )}
                          </div>
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
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setIsMemoryOpen(false)}>
          <section className="inkbound-panel max-h-[100dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-3xl px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:max-h-[92dvh] sm:rounded-3xl sm:p-7" role="dialog" aria-modal="true" aria-label="Add reading memory" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="inkbound-kicker">Time Capsule</p>
                <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Add a Reading Memory</h2>
              </div>
              <button type="button" onClick={() => setIsMemoryOpen(false)} className="quiet-shelf-icon-button h-11 w-11 shrink-0" aria-label="Close"><X /></button>
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

      {deletedMemory && (
        <div className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[220] mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-4 py-3 shadow-2xl sm:bottom-6" role="status" aria-live="polite">
          <span className="min-w-0 text-sm font-semibold text-[var(--ink-ivory)]">Reading memory deleted.</span>
          <button type="button" onClick={undoDeleteMemory} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[var(--ink-gold-bright)]">
            <Undo2 className="h-4 w-4" /> Undo
          </button>
        </div>
      )}
    </div>
  );
};