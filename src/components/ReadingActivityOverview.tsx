import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flame,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { getActiveEdition } from '../features/reading/bookReadingState';
import {
  getLongestReadingStreak,
  getReadingDates,
  getReadingStreak,
  getSessionDurationMinutes,
  getSessionPagesRead,
} from '../features/reading/sessionAnalytics';
import type { ReadingSession, UserBookRecord } from '../types';

interface ReadingActivityOverviewProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
  onUpdateBook?: (book: UserBookRecord) => void;
}

interface DayActivity {
  date: string;
  sessions: ReadingSession[];
  minutes: number;
  pages: number;
}

const toLocalDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeDateKey = (value?: string): string | null => {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (!Number.isFinite(parsed.getTime()) || parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return `${yearText}-${monthText}-${dayText}`;
};

const parseDateKey = (value: string): Date => {
  const normalized = normalizeDateKey(value) ?? toLocalDateKey(new Date());
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const monthKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const monthLabel = (key: string): string => {
  const [year, month] = key.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return 'This Month';
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

const getCoverUrl = (book: UserBookRecord): string | undefined => {
  const value = getActiveEdition(book)?.coverUrl?.trim();
  if (!value) return undefined;
  return value.startsWith('http://') ? `https://${value.slice('http://'.length)}` : value;
};

export const ReadingActivityOverview: React.FC<ReadingActivityOverviewProps> = ({ books, sessions, onSelectBook }) => {
  // A reading day is defined by shared analytics: valid local date + positive completed duration.
  const trackerSessions = useMemo(
    () => sessions.filter((session) => Boolean(normalizeDateKey(session.date)) && getSessionDurationMinutes(session) > 0),
    [sessions],
  );

  const activeDates = useMemo(() => getReadingDates(trackerSessions), [trackerSessions]);
  const latestActivityDate = activeDates.at(-1) ?? toLocalDateKey(new Date());

  const [visibleMonth, setVisibleMonth] = useState(() => monthKey(parseDateKey(latestActivityDate)));
  const [selectedDate, setSelectedDate] = useState(() => latestActivityDate);

  const activityByDate = useMemo(() => {
    const map = new Map<string, DayActivity>();
    trackerSessions.forEach((session) => {
      const date = normalizeDateKey(session.date);
      if (!date) return;
      const existing = map.get(date) ?? { date, sessions: [], minutes: 0, pages: 0 };
      existing.sessions.push(session);
      existing.minutes += getSessionDurationMinutes(session);
      existing.pages += getSessionPagesRead(session);
      map.set(date, existing);
    });
    return map;
  }, [trackerSessions]);

  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books]);

  const currentStreak = getReadingStreak(trackerSessions);
  const longestStreak = getLongestReadingStreak(trackerSessions);
  const totalReadingDays = activeDates.length;
  const visibleMonthReadingDays = activeDates.filter((date) => date.startsWith(visibleMonth)).length;

  const calendarDays = useMemo(() => {
    const [year, month] = visibleMonth.split('-').map(Number);
    const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
    const safeMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? month : new Date().getMonth() + 1;
    const firstDay = new Date(safeYear, safeMonth - 1, 1);
    const daysInMonth = new Date(safeYear, safeMonth, 0).getDate();
    const cells: Array<string | null> = Array.from({ length: firstDay.getDay() }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(`${safeYear}-${String(safeMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [visibleMonth]);

  const selectedActivity = activityByDate.get(selectedDate);
  const selectedSessionBooks = useMemo(() => {
    if (!selectedActivity) return [];
    const ids = new Set(selectedActivity.sessions.map((session) => session.bookId));
    return books.filter((book) => ids.has(book.id));
  }, [books, selectedActivity]);

  const moveMonth = (amount: number) => {
    const [year, month] = visibleMonth.split('-').map(Number);
    const next = new Date(year, month - 1 + amount, 1);
    setVisibleMonth(monthKey(next));
    setSelectedDate(toLocalDateKey(next));
  };

  return (
    <section className="space-y-5" aria-labelledby="reading-activity-title">
      <header className="inkbound-panel rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inkbound-kicker">Your reading rhythm</p>
            <h2 id="reading-activity-title" className="mt-2 font-serif text-3xl text-[var(--ink-ivory)]">Streak & Calendar</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">This calendar only reflects reading sessions recorded with Inkbound. Imported reading dates never affect your streaks or tracker history.</p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button type="button" onClick={() => moveMonth(-1)} className="quiet-shelf-icon-button shrink-0" aria-label="Previous month"><ChevronLeft /></button>
            <div className="min-w-0 flex-1 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-3 py-2 text-center sm:min-w-44 sm:flex-none sm:px-4">
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Activity month</span>
              <strong className="block truncate font-serif text-lg text-[var(--ink-ivory)]">{monthLabel(visibleMonth)}</strong>
            </div>
            <button type="button" onClick={() => moveMonth(1)} className="quiet-shelf-icon-button shrink-0" aria-label="Next month"><ChevronRight /></button>
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Flame} label="Current streak" value={`${currentStreak} ${currentStreak === 1 ? 'day' : 'days'}`} detail={currentStreak > 0 ? 'Your Inkbound reading rhythm is active.' : 'Save an Inkbound session to begin.'} />
        <MetricCard icon={Trophy} label="Longest streak" value={`${longestStreak} ${longestStreak === 1 ? 'day' : 'days'}`} detail="Your tracker-only personal best." />
        <MetricCard icon={CalendarDays} label="Reading days" value={totalReadingDays.toLocaleString()} detail="Days with completed Inkbound sessions." />
        <MetricCard icon={Sparkles} label="Selected month" value={`${visibleMonthReadingDays} ${visibleMonthReadingDays === 1 ? 'day' : 'days'}`} detail={monthLabel(visibleMonth)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="inkbound-panel rounded-3xl p-4 sm:p-6">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day} className="py-2">{day}</span>)}</div>
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {calendarDays.map((date, index) => {
              if (!date) return <span key={`empty-${index}`} className="aspect-square" aria-hidden="true" />;
              const activity = activityByDate.get(date);
              const isToday = date === toLocalDateKey(new Date());
              const isSelected = date === selectedDate;
              const dayBooks = activity
                ? [...new Set(activity.sessions.map((session) => session.bookId))].map((bookId) => booksById.get(bookId)).filter((book): book is UserBookRecord => Boolean(book))
                : [];
              const visibleBooks = dayBooks.slice(0, 3);
              const extraBooks = Math.max(0, dayBooks.length - visibleBooks.length);
              return (
                <button key={date} type="button" onClick={() => setSelectedDate(date)} className={`relative aspect-square overflow-hidden rounded-xl border bg-[var(--ink-surface-soft)] p-1 text-left transition hover:-translate-y-0.5 hover:border-[var(--ink-mauve)] ${isSelected ? 'border-[var(--ink-gold)] ring-1 ring-[var(--ink-gold)]/40' : 'border-[var(--ink-border-subtle)]'}`} aria-label={`${new Date(`${date}T12:00:00`).toLocaleDateString()}: ${activity?.sessions.length ?? 0} Inkbound reading sessions${dayBooks.length ? ` across ${dayBooks.length} ${dayBooks.length === 1 ? 'book' : 'books'}` : ''}`}>
                  <span className={`relative z-20 text-xs font-semibold drop-shadow ${isToday ? 'text-[var(--ink-gold)]' : 'text-[var(--ink-ivory)]'}`}>{Number(date.slice(-2))}</span>
                  {visibleBooks.length > 0 && (
                    <span className="absolute inset-x-1 bottom-1 top-6 flex items-end justify-center gap-0.5 overflow-hidden">
                      {visibleBooks.map((book) => {
                        const coverUrl = getCoverUrl(book);
                        const edition = getActiveEdition(book);
                        return (
                          <span key={book.id} title={book.work.title} className={`relative h-full min-w-0 flex-1 overflow-hidden rounded-[4px] border border-white/15 bg-gradient-to-br ${edition?.coverGradient ?? 'from-[#4b2f50] via-[#2c1c32] to-[#161018]'}`}>
                            {coverUrl ? (
                              <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center px-0.5 text-center font-serif text-[7px] leading-tight text-[var(--ink-ivory)]/85">{book.work.title}</span>
                            )}
                          </span>
                        );
                      })}
                    </span>
                  )}
                  {extraBooks > 0 && <span className="absolute bottom-1 right-1 z-30 rounded-full bg-black/75 px-1.5 py-0.5 text-[8px] font-bold text-white">+{extraBooks}</span>}
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-[var(--ink-muted)]">Days with completed reading sessions show the books you actually read. Select a day for time, pages, and full book details.</p>
        </section>

        <aside className="inkbound-panel rounded-3xl p-5">
          <p className="inkbound-kicker">Selected day</p>
          <h3 className="mt-2 break-words font-serif text-2xl text-[var(--ink-ivory)]">{new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          {!selectedActivity ? (
            <div className="mt-5 rounded-2xl border border-dashed border-[var(--ink-border)] p-6 text-center"><CalendarDays className="mx-auto h-7 w-7 text-[var(--ink-mauve)]" /><p className="mt-3 text-sm text-[var(--ink-muted)]">No completed Inkbound reading session was recorded on this day.</p></div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0 rounded-xl bg-[var(--ink-surface-soft)] p-3"><Clock3 className="h-4 w-4 text-[var(--ink-mauve)]" /><strong className="mt-2 block break-words font-serif text-xl text-[var(--ink-ivory)]">{selectedActivity.minutes}m</strong><span className="text-xs text-[var(--ink-muted)]">Reading time</span></div>
                <div className="min-w-0 rounded-xl bg-[var(--ink-surface-soft)] p-3"><BookOpen className="h-4 w-4 text-[var(--ink-mauve)]" /><strong className="mt-2 block break-words font-serif text-xl text-[var(--ink-ivory)]">{selectedActivity.pages}</strong><span className="text-xs text-[var(--ink-muted)]">Pages read</span></div>
              </div>
              {selectedSessionBooks.length > 0 && <div><h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Books read</h4><div className="mt-2 grid gap-2">{selectedSessionBooks.map((book) => <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="min-h-11 min-w-0 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-left hover:border-[var(--ink-mauve)]"><strong className="block truncate text-sm text-[var(--ink-ivory)]">{book.work.title}</strong><span className="block truncate text-xs text-[var(--ink-muted)]">{book.work.author}</span></button>)}</div></div>}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
};

interface MetricCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ icon: Icon, label, value, detail }) => (
  <article className="inkbound-panel min-w-0 rounded-2xl p-5">
    <Icon className="h-5 w-5 text-[var(--ink-mauve)]" />
    <span className="mt-4 block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">{label}</span>
    <strong className="mt-1 block break-words font-serif text-3xl text-[var(--ink-ivory)]">{value}</strong>
    <p className="mt-1 break-words text-xs text-[var(--ink-muted)]">{detail}</p>
  </article>
);
