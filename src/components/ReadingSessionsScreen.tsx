import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clock3,
  Edit3,
  Flame,
  Gauge,
  Headphones,
  MapPin,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
  Target,
  Undo2,
} from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../types';
import { BookCover } from './BookCover';
import { ResponsiveGrid } from '../layout/responsive';
import { SessionEditorModal } from './SessionEditorModal';
import { BulkHistoricalSessionsModal } from './BulkHistoricalSessionsModal';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { getDailyReadingGoalMinutes } from '../features/reading/readingPreferences';
import {
  formatDurationEstimate,
  getCurrentPace,
  getDailyReadingMinutes,
  getReadingStreak,
  getSessionDurationMinutes,
  getSessionListeningMinutes,
  getSessionPagesRead,
  getSevenDayAveragePace,
  localDateKey,
} from '../features/reading/sessionAnalytics';

interface ReadingSessionsScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onOpenTimer: (bookId?: string) => void;
  onSelectBook: (book: UserBookRecord) => void;
  onSaveManualSession: (session: ReadingSession) => void;
  onSaveManualSessions: (sessions: ReadingSession[]) => void;
  onUpdateSession: (session: ReadingSession) => void;
  onDeleteSession: (sessionId: string) => void;
}

const SESSION_DELETE_UNDO_MS = 7000;
const SESSION_BANNER_ASSET = '/assets/streaks/cozy-sessions-background.png';

const formatSessionDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return value;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const ReadingSessionsScreen: React.FC<ReadingSessionsScreenProps> = ({
  books,
  sessions,
  onOpenTimer,
  onSelectBook,
  onSaveManualSession,
  onSaveManualSessions,
  onUpdateSession,
  onDeleteSession,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [bookFilter, setBookFilter] = useState('all');
  const [editingSession, setEditingSession] = useState<ReadingSession | null>(null);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [isBulkManualEntryOpen, setIsBulkManualEntryOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ReadingSession | null>(null);
  const pendingDeleteRef = useRef<ReadingSession | null>(null);
  const deleteTimerRef = useRef<number | null>(null);
  const onDeleteSessionRef = useRef(onDeleteSession);

  useEffect(() => {
    onDeleteSessionRef.current = onDeleteSession;
  }, [onDeleteSession]);

  const clearDeleteTimer = () => {
    if (deleteTimerRef.current === null) return;
    window.clearTimeout(deleteTimerRef.current);
    deleteTimerRef.current = null;
  };

  const commitPendingDelete = () => {
    const session = pendingDeleteRef.current;
    clearDeleteTimer();
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    if (session) onDeleteSessionRef.current(session.id);
  };

  const requestSessionDelete = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;

    // Only the latest single-item deletion is undoable. Commit any earlier pending
    // deletion before opening a fresh Undo window so canonical reconciliation runs once.
    if (pendingDeleteRef.current) commitPendingDelete();

    pendingDeleteRef.current = session;
    setPendingDelete(session);
    deleteTimerRef.current = window.setTimeout(() => {
      const current = pendingDeleteRef.current;
      pendingDeleteRef.current = null;
      deleteTimerRef.current = null;
      setPendingDelete(null);
      if (current) onDeleteSessionRef.current(current.id);
    }, SESSION_DELETE_UNDO_MS);
  };

  const undoSessionDelete = () => {
    clearDeleteTimer();
    pendingDeleteRef.current = null;
    setPendingDelete(null);
  };

  useEffect(() => () => {
    // If the reader leaves this screen during the Undo window, finish the deletion
    // rather than silently losing the requested action or restoring stale snapshots.
    const session = pendingDeleteRef.current;
    clearDeleteTimer();
    pendingDeleteRef.current = null;
    if (session) onDeleteSessionRef.current(session.id);
  }, []);

  useEffect(() => {
    const pending = pendingDeleteRef.current;
    if (!pending || sessions.some((session) => session.id === pending.id)) return;
    clearDeleteTimer();
    pendingDeleteRef.current = null;
    setPendingDelete(null);
  }, [sessions]);

  const visibleSessions = useMemo(
    () => pendingDelete ? sessions.filter((session) => session.id !== pendingDelete.id) : sessions,
    [pendingDelete, sessions],
  );

  const booksById = useMemo(
    () => new Map(books.map((book) => [book.id, book])),
    [books],
  );

  const sessionBooks = useMemo(
    () =>
      Array.from(new Set(visibleSessions.map((session) => session.bookId)))
        .map((bookId) => booksById.get(bookId))
        .filter((book): book is UserBookRecord => Boolean(book))
        .sort((a, b) => a.work.title.localeCompare(b.work.title)),
    [booksById, visibleSessions],
  );

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return visibleSessions.filter((session) => {
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
  }, [bookFilter, booksById, searchQuery, visibleSessions]);

  const completedSessions = visibleSessions.filter((session) => getSessionDurationMinutes(session) > 0);
  const totalMinutes = completedSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
  const totalPages = completedSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
  const totalListening = completedSessions.reduce((sum, session) => sum + getSessionListeningMinutes(session), 0);
  const averageMinutes = completedSessions.length ? Math.round(totalMinutes / completedSessions.length) : 0;
  const today = localDateKey();
  const currentStreak = getReadingStreak(visibleSessions, today);
  const todayMinutes = getDailyReadingMinutes(visibleSessions, today);
  const dailyGoal = getDailyReadingGoalMinutes();
  const goalPercent = Math.min(100, Math.round((todayMinutes / dailyGoal) * 100));

  return (
    <section className="space-y-7 pb-20">
      <header className="relative overflow-hidden rounded-3xl border border-[var(--ink-border-subtle)] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
        <div aria-hidden="true" className="pointer-events-none absolute -inset-3 scale-[1.035] bg-cover bg-center bg-no-repeat blur-[3px]" style={{ backgroundImage: `url("${SESSION_BANNER_ASSET}")` }} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(9,8,18,.88)_0%,rgba(9,8,18,.68)_48%,rgba(9,8,18,.34)_78%,rgba(9,8,18,.22)_100%)]" />
        <div className="relative z-10 flex min-h-[250px] flex-col justify-between gap-5 p-5 sm:p-7 lg:flex-row lg:items-end">
          <div className="max-w-2xl rounded-[1.5rem] border border-white/10 bg-black/25 p-5 backdrop-blur-[3px]">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#e0c77c]">Reading journal</p>
            <h2 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Reading Sessions</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">Keep a record of the time, pages, places, and thoughts that shape your reading life.</p>
          </div>

          <div className="flex w-full flex-col gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 backdrop-blur-[3px] sm:w-auto sm:flex-row sm:flex-wrap">
            <button type="button" onClick={() => setIsManualEntryOpen(true)} className="quiet-shelf-secondary-action w-full justify-center border-white/10 bg-black/20 text-white sm:w-auto">
              <Plus className="h-4 w-4" /> Add Past Session
            </button>
            <button type="button" onClick={() => setIsBulkManualEntryOpen(true)} className="quiet-shelf-secondary-action w-full justify-center border-white/10 bg-black/20 text-white sm:w-auto">
              <NotebookPen className="h-4 w-4" /> Add Multiple
            </button>
            <button type="button" onClick={() => onOpenTimer()} className="quiet-shelf-primary-action w-full justify-center sm:w-auto">
              <Clock3 className="h-4 w-4" /> Start a Session
            </button>
          </div>
        </div>
      </header>

      <ResponsiveGrid minItemWidth={220} maxColumns={4} gap={12}>
        {[
          { label: 'Reading streak', value: `${currentStreak} day${currentStreak === 1 ? '' : 's'}`, icon: Flame },
          { label: 'Today’s goal', value: `${todayMinutes} / ${dailyGoal} min`, icon: Target },
          { label: 'Time Read', value: `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`, icon: Clock3 },
          { label: 'Pages Read', value: totalPages.toLocaleString(), icon: BookOpen },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="inkbound-panel flex items-center gap-4 p-4">
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--ink-border)] bg-[rgba(197,160,89,0.08)] text-[var(--ink-gold-bright)]"><Icon className="h-5 w-5" /></span>
            <div className="min-w-0"><p className="break-words text-xl font-semibold text-[var(--ink-text-primary)]">{value}</p><p className="text-xs text-[var(--ink-text-muted)]">{label}</p></div>
          </div>
        ))}
      </ResponsiveGrid>

      <div className="inkbound-panel p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ink-text-primary)]">Daily reading goal</p>
            <p className="mt-1 text-xs text-[var(--ink-text-muted)]">
              {todayMinutes >= dailyGoal ? `Goal reached — ${todayMinutes} minutes read today.` : `${Math.max(0, dailyGoal - todayMinutes)} minutes to go today.`}
            </p>
          </div>
          <span className="shrink-0 text-sm font-bold text-[var(--ink-gold)]">{goalPercent}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--ink-surface)]" role="progressbar" aria-label="Daily reading goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goalPercent}>
          <div className="h-full rounded-full bg-[var(--ink-gold)] transition-[width]" style={{ width: `${goalPercent}%` }} />
        </div>
      </div>

      <ResponsiveGrid minItemWidth={220} maxColumns={4} gap={12}>
        {[
          { label: 'Listening Time', value: `${Math.floor(totalListening / 60)}h ${totalListening % 60}m`, icon: Headphones },
          { label: 'Average Session', value: `${averageMinutes} min`, icon: Sparkles },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="inkbound-panel flex items-center gap-4 p-4">
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--ink-border)] bg-[rgba(197,160,89,0.08)] text-[var(--ink-gold-bright)]"><Icon className="h-5 w-5" /></span>
            <div className="min-w-0"><p className="break-words text-xl font-semibold text-[var(--ink-text-primary)]">{value}</p><p className="text-xs text-[var(--ink-text-muted)]">{label}</p></div>
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
            const edition = book ? getActiveEdition(book) : undefined;
            const isAudio = edition?.format === 'audiobook';
            const safeDurationMinutes = getSessionDurationMinutes(session);
            const safePagesRead = getSessionPagesRead(session);
            const safeMinutesListened = getSessionListeningMinutes(session);
            const currentPace = book && !isAudio ? getCurrentPace(session, book) : null;
            const sevenDayPace = book && !isAudio ? getSevenDayAveragePace(visibleSessions, book, session.date) : null;
            const currentEstimate = formatDurationEstimate(currentPace?.estimatedRemainingSeconds);
            const averageEstimate = formatDurationEstimate(sevenDayPace?.estimatedRemainingSeconds);

            return (
              <article key={session.id} className="inkbound-panel min-w-0 p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  {book && <button type="button" onClick={() => onSelectBook(book)} className="shrink-0 text-left"><BookCover work={book.work} edition={edition} size="sm" showFormatBadge={false} /></button>}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inkbound-badge">{isAudio ? 'Listening Session' : 'Reading Session'}</span>
                      {session.mood && <span className="break-words text-xs text-[var(--ink-gold)]">{session.mood}</span>}
                    </div>
                    <button type="button" onClick={() => book && onSelectBook(book)} className="mt-2 min-h-11 max-w-full break-words py-1 text-left font-serif text-xl text-[var(--ink-text-primary)] hover:text-[var(--ink-gold-bright)]">{book?.work.title ?? 'Reading Session'}</button>
                    <p className="mt-1 break-words text-xs text-[var(--ink-text-muted)]">{book?.work.author}</p>

                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--ink-text-secondary)]">
                      <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-[var(--ink-gold)]" />{formatSessionDate(session.date)}</span>
                      <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 shrink-0 text-[var(--ink-gold)]" />{safeDurationMinutes} minutes</span>
                      {session.location && <span className="inline-flex min-w-0 items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--ink-gold)]" /><span className="break-words">{session.location}</span></span>}
                      {safePagesRead > 0 ? <span>{safePagesRead} pages</span> : null}
                      {safeMinutesListened > 0 ? <span>{safeMinutesListened} minutes listened</span> : null}
                    </div>

                    {currentPace?.pagesPerHour ? (
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3">
                          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]"><Gauge className="h-3.5 w-3.5 text-[var(--ink-gold)]" /> Current pace</p>
                          <p className="mt-1 text-sm font-semibold text-[var(--ink-text-primary)]">{Math.round(currentPace.pagesPerHour)} pages/hour</p>
                          {currentEstimate && <p className="mt-1 text-xs text-[var(--ink-text-muted)]">About {currentEstimate} of reading remaining at this pace.</p>}
                        </div>
                        <div className="rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">7-day average</p>
                          {sevenDayPace?.pagesPerHour ? (
                            <><p className="mt-1 text-sm font-semibold text-[var(--ink-text-primary)]">{Math.round(sevenDayPace.pagesPerHour)} pages/hour</p>{averageEstimate && <p className="mt-1 text-xs text-[var(--ink-text-muted)]">About {averageEstimate} remaining at your recent average.</p>}</>
                          ) : (
                            <p className="mt-1 text-xs text-[var(--ink-text-muted)]">Needs at least 2 sessions and 20 tracked minutes in the last 7 days.</p>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {session.notes && <blockquote className="mt-4 break-words border-l-2 border-[var(--ink-gold)] pl-4 font-serif text-sm italic leading-6 text-[var(--ink-text-secondary)]">“{session.notes}”</blockquote>}
                  </div>

                  <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:flex-col">
                    {book && <button type="button" onClick={() => onOpenTimer(book.id)} className="quiet-shelf-primary-action flex-1 justify-center sm:flex-none">Continue</button>}
                    <button type="button" onClick={() => setEditingSession(session)} className="quiet-shelf-secondary-action flex-1 justify-center sm:flex-none"><Edit3 className="h-3.5 w-3.5" /> Edit</button>
                    {book && <button type="button" onClick={() => onSelectBook(book)} className="quiet-shelf-secondary-action flex-1 justify-center sm:flex-none">Details <ChevronRight className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {isManualEntryOpen && <SessionEditorModal books={books} onClose={() => setIsManualEntryOpen(false)} onSave={onSaveManualSession} />}
      {isBulkManualEntryOpen && <BulkHistoricalSessionsModal books={books} onClose={() => setIsBulkManualEntryOpen(false)} onSave={onSaveManualSessions} />}
      {editingSession && <SessionEditorModal books={books} session={editingSession} onClose={() => setEditingSession(null)} onSave={onUpdateSession} onDelete={requestSessionDelete} />}

      {pendingDelete && (
        <div className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[220] mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-4 py-3 shadow-2xl sm:bottom-6" role="status" aria-live="polite">
          <span className="min-w-0 text-sm font-semibold text-[var(--ink-ivory)]">Reading session deleted.</span>
          <button type="button" onClick={undoSessionDelete} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[var(--ink-gold-bright)]">
            <Undo2 className="h-4 w-4" /> Undo
          </button>
        </div>
      )}
    </section>
  );
};