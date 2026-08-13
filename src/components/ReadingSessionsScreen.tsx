import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clock3,
  Edit3,
  Headphones,
  MapPin,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { BookCover } from './BookCover';
import { ResponsiveGrid } from '../layout/responsive';
import { SessionEditorModal } from './SessionEditorModal';

interface ReadingSessionsScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onOpenTimer: (bookId?: string) => void;
  onSelectBook: (book: UserBookRecord) => void;
  onSaveManualSession: (session: ReadingSession) => void;
  onUpdateSession: (session: ReadingSession) => void;
  onDeleteSession: (sessionId: string) => void;
}

export const ReadingSessionsScreen: React.FC<ReadingSessionsScreenProps> = ({
  books,
  sessions,
  onOpenTimer,
  onSelectBook,
  onSaveManualSession,
  onUpdateSession,
  onDeleteSession,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [bookFilter, setBookFilter] = useState('all');
  const [editingSession, setEditingSession] = useState<ReadingSession | null>(null);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);

  const booksById = useMemo(
    () => new Map(books.map((book) => [book.id, book])),
    [books],
  );

  const sessionBooks = useMemo(
    () =>
      Array.from(new Set(sessions.map((session) => session.bookId)))
        .map((bookId) => booksById.get(bookId))
        .filter((book): book is UserBookRecord => Boolean(book))
        .sort((a, b) => a.work.title.localeCompare(b.work.title)),
    [booksById, sessions],
  );

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return sessions.filter((session) => {
      const book = booksById.get(session.bookId);
      if (bookFilter !== 'all' && session.bookId !== bookFilter) return false;
      if (!query) return true;
      return (
        book?.work.title.toLowerCase().includes(query) ||
        book?.work.author.toLowerCase().includes(query) ||
        session.notes?.toLowerCase().includes(query) ||
        session.location?.toLowerCase().includes(query) ||
        session.mood?.toLowerCase().includes(query)
      );
    });
  }, [bookFilter, booksById, searchQuery, sessions]);

  const totalMinutes = sessions.reduce((sum, session) => sum + Math.max(0, session.durationMinutes), 0);
  const totalPages = sessions.reduce((sum, session) => sum + Math.max(0, session.pagesRead ?? 0), 0);
  const totalListening = sessions.reduce((sum, session) => sum + Math.max(0, session.minutesListened ?? 0), 0);
  const averageMinutes = sessions.length ? Math.round(totalMinutes / sessions.length) : 0;

  return (
    <section className="space-y-7 pb-20">
      <header className="inkbound-panel relative overflow-hidden p-6 sm:p-8">
        <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <p className="inkbound-kicker">Reading journal</p>
            <h2 className="inkbound-page-title">Reading Sessions</h2>
            <p className="inkbound-page-copy mt-3">Keep a record of the time, pages, places, and thoughts that shape your reading life.</p>
          </div>

          <div className="flex flex-wrap gap-2 self-start xl:self-auto">
            <button type="button" onClick={() => setIsManualEntryOpen(true)} className="quiet-shelf-secondary-action">
              <Plus className="h-4 w-4" /> Add Manually
            </button>
            <button type="button" onClick={() => onOpenTimer()} className="quiet-shelf-primary-action">
              <Clock3 className="h-4 w-4" /> Start a Session
            </button>
          </div>
        </div>
        <BookOpen className="pointer-events-none absolute -bottom-10 right-5 h-44 w-44 text-[var(--ink-gold)] opacity-[0.045]" />
      </header>

      <ResponsiveGrid minItemWidth={220} maxColumns={4} gap={12}>
        {[
          { label: 'Time Read', value: `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`, icon: Clock3 },
          { label: 'Pages Read', value: totalPages.toLocaleString(), icon: BookOpen },
          { label: 'Listening Time', value: `${Math.floor(totalListening / 60)}h ${totalListening % 60}m`, icon: Headphones },
          { label: 'Average Session', value: `${averageMinutes} min`, icon: Sparkles },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="inkbound-panel flex items-center gap-4 p-4">
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--ink-border)] bg-[rgba(197,160,89,0.08)] text-[var(--ink-gold-bright)]"><Icon className="h-5 w-5" /></span>
            <div><p className="text-xl font-semibold text-[var(--ink-text-primary)]">{value}</p><p className="text-xs text-[var(--ink-text-muted)]">{label}</p></div>
          </div>
        ))}
      </ResponsiveGrid>

      <div className="inkbound-panel grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[var(--ink-mauve)]" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search notes, books, moods, or places..."
            className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] py-3 pl-11 pr-4 text-sm text-[var(--ink-text-primary)] outline-none placeholder:text-[var(--ink-text-muted)] focus:border-[var(--ink-mauve)] focus:ring-2 focus:ring-[var(--ink-mauve)]/25"
          />
        </label>
        <select
          value={bookFilter}
          onChange={(event) => setBookFilter(event.target.value)}
          className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] px-4 text-sm text-[var(--ink-text-primary)] outline-none focus:border-[var(--ink-mauve)] focus:ring-2 focus:ring-[var(--ink-mauve)]/25"
        >
          <option value="all">All Books</option>
          {sessionBooks.map((book) => <option key={book.id} value={book.id}>{book.work.title}</option>)}
        </select>
      </div>

      {filteredSessions.length === 0 ? (
        <div className="inkbound-panel px-6 py-14 text-center">
          <NotebookPen className="mx-auto h-10 w-10 text-[var(--ink-gold)] opacity-70" />
          <h3 className="mt-4 font-serif text-2xl text-[var(--ink-text-primary)]">No sessions found</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--ink-text-muted)]">Start a reading session, add one manually, or adjust the filters to return to your journal history.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSessions.map((session) => {
            const book = booksById.get(session.bookId);
            const edition = book?.editions.find((item) => item.id === book.activeEditionId) ?? book?.editions[0];
            const isAudio = edition?.format === 'audiobook';
            const safePagesRead = Math.max(0, session.pagesRead ?? 0);
            const safeMinutesListened = Math.max(0, session.minutesListened ?? 0);

            return (
              <article key={session.id} className="inkbound-panel p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  {book && <button type="button" onClick={() => onSelectBook(book)} className="shrink-0 text-left"><BookCover work={book.work} edition={edition} size="sm" showFormatBadge={false} /></button>}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inkbound-badge">{isAudio ? 'Listening Session' : 'Reading Session'}</span>
                      {session.mood && <span className="text-xs text-[var(--ink-gold)]">{session.mood}</span>}
                    </div>
                    <button type="button" onClick={() => book && onSelectBook(book)} className="mt-2 text-left font-serif text-xl text-[var(--ink-text-primary)] hover:text-[var(--ink-gold-bright)]">{book?.work.title ?? 'Reading Session'}</button>
                    <p className="mt-1 text-xs text-[var(--ink-text-muted)]">{book?.work.author}</p>

                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--ink-text-secondary)]">
                      <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-[var(--ink-gold)]" />{session.date}</span>
                      <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-[var(--ink-gold)]" />{Math.max(0, session.durationMinutes)} minutes</span>
                      {session.location && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-[var(--ink-gold)]" />{session.location}</span>}
                      {safePagesRead > 0 ? <span>{safePagesRead} pages</span> : null}
                      {safeMinutesListened > 0 ? <span>{safeMinutesListened} minutes listened</span> : null}
                    </div>

                    {session.notes && <blockquote className="mt-4 border-l-2 border-[var(--ink-gold)] pl-4 font-serif text-sm italic leading-6 text-[var(--ink-text-secondary)]">“{session.notes}”</blockquote>}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
                    {book && <button type="button" onClick={() => onOpenTimer(book.id)} className="quiet-shelf-primary-action">Continue</button>}
                    <button type="button" onClick={() => setEditingSession(session)} className="quiet-shelf-secondary-action"><Edit3 className="h-3.5 w-3.5" /> Edit</button>
                    {book && <button type="button" onClick={() => onSelectBook(book)} className="quiet-shelf-secondary-action">Details <ChevronRight className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {isManualEntryOpen && <SessionEditorModal books={books} onClose={() => setIsManualEntryOpen(false)} onSave={onSaveManualSession} />}
      {editingSession && <SessionEditorModal books={books} session={editingSession} onClose={() => setEditingSession(null)} onSave={onUpdateSession} onDelete={onDeleteSession} />}
    </section>
  );
};
