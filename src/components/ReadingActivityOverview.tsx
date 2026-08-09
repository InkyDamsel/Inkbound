import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flame,
  Sparkles,
  Trash2,
  Trophy,
} from 'lucide-react';
import type { ReadingSession, UserBookRecord } from '../types';

interface ReadingActivityOverviewProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
  onUpdateBook: (book: UserBookRecord) => void;
}

interface DayActivity {
  date: string;
  sessions: ReadingSession[];
  finishedBooks: UserBookRecord[];
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
  if (
    !Number.isFinite(parsed.getTime())
    || parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) return null;
  return `${yearText}-${monthText}-${dayText}`;
};

const parseDateKey = (value: string): Date => {
  const normalized = normalizeDateKey(value) ?? toLocalDateKey(new Date());
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const addDays = (value: string, amount: number): string => {
  const date = parseDateKey(value);
  date.setDate(date.getDate() + amount);
  return toLocalDateKey(date);
};

const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const monthLabel = (key: string): string => {
  const [year, month] = key.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return 'This Month';
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
};

const calculateLongestStreak = (activeDates: string[]): number => {
  if (activeDates.length === 0) return 0;
  let longest = 1;
  let current = 1;

  for (let index = 1; index < activeDates.length; index += 1) {
    if (activeDates[index] === addDays(activeDates[index - 1], 1)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }

  return longest;
};

const calculateCurrentStreak = (activeDates: string[]): number => {
  if (activeDates.length === 0) return 0;
  const active = new Set(activeDates);
  const today = toLocalDateKey(new Date());
  const yesterday = addDays(today, -1);
  let cursor = active.has(today) ? today : active.has(yesterday) ? yesterday : '';
  if (!cursor) return 0;

  let streak = 0;
  while (active.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
};

export const ReadingActivityOverview: React.FC<ReadingActivityOverviewProps> = ({
  books,
  sessions,
  onSelectBook,
  onUpdateBook,
}) => {
  const invalidFinishedBooks = useMemo(
    () => books.filter((book) => Boolean(book.dateFinished) && !normalizeDateKey(book.dateFinished)),
    [books],
  );
  const [repairDates, setRepairDates] = useState<Record<string, string>>({});

  const latestActivityDate = useMemo(() => {
    const values = [
      ...sessions.map((session) => normalizeDateKey(session.date)).filter((value): value is string => Boolean(value)),
      ...books.map((book) => normalizeDateKey(book.dateFinished)).filter((value): value is string => Boolean(value)),
    ].sort();
    return values.at(-1) ?? toLocalDateKey(new Date());
  }, [books, sessions]);

  const [visibleMonth, setVisibleMonth] = useState(() => monthKey(parseDateKey(latestActivityDate)));
  const [selectedDate, setSelectedDate] = useState(() => latestActivityDate);

  const activityByDate = useMemo(() => {
    const map = new Map<string, DayActivity>();
    const ensureDay = (date: string): DayActivity => {
      const key = normalizeDateKey(date);
      if (!key) throw new Error('Invalid activity date passed to ensureDay.');
      const existing = map.get(key);
      if (existing) return existing;
      const created: DayActivity = {
        date: key,
        sessions: [],
        finishedBooks: [],
        minutes: 0,
        pages: 0,
      };
      map.set(key, created);
      return created;
    };

    sessions.forEach((session) => {
      const date = normalizeDateKey(session.date);
      if (!date) return;
      const day = ensureDay(date);
      day.sessions.push(session);
      day.minutes += session.durationMinutes ?? 0;
      day.pages += session.pagesRead ?? Math.max(0, (session.endPage ?? 0) - (session.startPage ?? 0));
    });

    books.forEach((book) => {
      const date = normalizeDateKey(book.dateFinished);
      if (!date) return;
      ensureDay(date).finishedBooks.push(book);
    });

    return map;
  }, [books, sessions]);

  const activeDates = useMemo(
    () => [...activityByDate.values()]
      .filter((day) => day.sessions.length > 0)
      .map((day) => day.date)
      .sort(),
    [activityByDate],
  );

  const currentStreak = calculateCurrentStreak(activeDates);
  const longestStreak = calculateLongestStreak(activeDates);
  const totalReadingDays = activeDates.length;
  const thisMonthReadingDays = activeDates.filter((date) => date.startsWith(visibleMonth)).length;

  const calendarDays = useMemo(() => {
    const [year, month] = visibleMonth.split('-').map(Number);
    const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
    const safeMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? month : new Date().getMonth() + 1;
    const firstDay = new Date(safeYear, safeMonth - 1, 1);
    const daysInMonth = new Date(safeYear, safeMonth, 0).getDate();
    const leadingEmptyDays = firstDay.getDay();
    const cells: Array<string | null> = Array.from({ length: leadingEmptyDays }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(`${safeYear}-${String(safeMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
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

  const saveFinishedDate = (book: UserBookRecord) => {
    const nextDate = normalizeDateKey(repairDates[book.id]);
    if (!nextDate) return;
    onUpdateBook({ ...book, dateFinished: nextDate });
    setRepairDates((current) => {
      const next = { ...current };
      delete next[book.id];
      return next;
    });
    setVisibleMonth(monthKey(parseDateKey(nextDate)));
    setSelectedDate(nextDate);
  };

  const removeFinishedDate = (book: UserBookRecord) => {
    onUpdateBook({ ...book, dateFinished: undefined });
    setRepairDates((current) => {
      const next = { ...current };
      delete next[book.id];
      return next;
    });
  };

  return (
    <section className="space-y-5" aria-labelledby="reading-activity-title">
      <header className="inkbound-panel rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inkbound-kicker">Your reading rhythm</p>
            <h2 id="reading-activity-title" className="mt-2 font-serif text-3xl text-[var(--ink-ivory)]">Streak & Calendar</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
              Every saved reading session adds a day to your reading history. Missing a day never erases the memories already recorded.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => moveMonth(-1)} className="quiet-shelf-icon-button" aria-label="Previous month"><ChevronLeft /></button>
            <div className="min-w-44 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 py-2 text-center">
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Activity month</span>
              <strong className="font-serif text-lg text-[var(--ink-ivory)]">{monthLabel(visibleMonth)}</strong>
            </div>
            <button type="button" onClick={() => moveMonth(1)} className="quiet-shelf-icon-button" aria-label="Next month"><ChevronRight /></button>
          </div>
        </div>
      </header>

      {invalidFinishedBooks.length > 0 && (
        <section className="rounded-3xl border border-amber-500/35 bg-amber-950/15 p-5 sm:p-6" aria-label="Dates needing attention">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-xl text-[var(--ink-ivory)]">{invalidFinishedBooks.length === 1 ? '1 completion date needs attention' : `${invalidFinishedBooks.length} completion dates need attention`}</h3>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Inkbound will not place an invalid date on your calendar. Add or edit the correct date, or remove the bad date entirely.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {invalidFinishedBooks.map((book) => {
              const repairValue = repairDates[book.id] ?? '';
              return (
                <article key={book.id} className="rounded-2xl border border-amber-500/20 bg-[var(--ink-surface-soft)] p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <button type="button" onClick={() => onSelectBook(book)} className="min-w-0 text-left">
                      <strong className="block truncate text-sm text-[var(--ink-ivory)]">{book.work.title}</strong>
                      <span className="text-xs text-[var(--ink-muted)]">{book.work.author}</span>
                      <span className="mt-1 block text-[11px] text-amber-300">Saved date could not be read.</span>
                    </button>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="date"
                        value={repairValue}
                        onChange={(event) => setRepairDates((current) => ({ ...current, [book.id]: event.target.value }))}
                        className="min-h-10 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] px-3 text-sm text-[var(--ink-ivory)] outline-none focus:border-[var(--ink-mauve)]"
                        aria-label={`Completion date for ${book.work.title}`}
                      />
                      <button type="button" onClick={() => saveFinishedDate(book)} disabled={!normalizeDateKey(repairValue)} className="quiet-shelf-primary-action min-h-10 justify-center px-4 disabled:opacity-40">
                        Save Date
                      </button>
                      <button type="button" onClick={() => removeFinishedDate(book)} className="quiet-shelf-secondary-action min-h-10 justify-center px-4 text-rose-300">
                        <Trash2 className="h-4 w-4" /> Remove Date
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Flame} label="Current streak" value={`${currentStreak} ${currentStreak === 1 ? 'day' : 'days'}`} detail={currentStreak > 0 ? 'Your reading rhythm is active.' : 'Save a session to begin.'} />
        <MetricCard icon={Trophy} label="Longest streak" value={`${longestStreak} ${longestStreak === 1 ? 'day' : 'days'}`} detail="Your personal best." />
        <MetricCard icon={CalendarDays} label="Reading days" value={totalReadingDays.toLocaleString()} detail="All recorded session days." />
        <MetricCard icon={Sparkles} label="This month" value={`${thisMonthReadingDays} ${thisMonthReadingDays === 1 ? 'day' : 'days'}`} detail={monthLabel(visibleMonth)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="inkbound-panel rounded-3xl p-4 sm:p-6">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day} className="py-2">{day}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {calendarDays.map((date, index) => {
              if (!date) return <span key={`empty-${index}`} className="aspect-square" aria-hidden="true" />;
              const activity = activityByDate.get(date);
              const isToday = date === toLocalDateKey(new Date());
              const isSelected = date === selectedDate;
              const intensity = activity?.minutes
                ? activity.minutes >= 90 ? 'bg-[var(--ink-mauve)]/55' : activity.minutes >= 45 ? 'bg-[var(--ink-mauve)]/35' : 'bg-[var(--ink-mauve)]/20'
                : 'bg-[var(--ink-surface-soft)]';
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setSelectedDate(date)}
                  className={`relative aspect-square rounded-xl border p-1 text-left transition hover:-translate-y-0.5 hover:border-[var(--ink-mauve)] ${intensity} ${isSelected ? 'border-[var(--ink-gold)] ring-1 ring-[var(--ink-gold)]/40' : 'border-[var(--ink-border-subtle)]'}`}
                  aria-label={`${parseDateKey(date).toLocaleDateString()}: ${activity?.sessions.length ?? 0} reading sessions`}
                >
                  <span className={`text-xs font-semibold ${isToday ? 'text-[var(--ink-gold)]' : 'text-[var(--ink-ivory)]'}`}>{Number(date.slice(-2))}</span>
                  {activity && (
                    <span className="absolute inset-x-1 bottom-1 flex items-center justify-between text-[8px] text-[var(--ink-ivory)]/75">
                      <span>{activity.minutes}m</span>
                      {activity.finishedBooks.length > 0 && <BookOpen className="h-2.5 w-2.5" />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[var(--ink-muted)]">
            <span>Less</span>
            <span className="h-4 w-4 rounded bg-[var(--ink-surface-soft)]" />
            <span className="h-4 w-4 rounded bg-[var(--ink-mauve)]/20" />
            <span className="h-4 w-4 rounded bg-[var(--ink-mauve)]/35" />
            <span className="h-4 w-4 rounded bg-[var(--ink-mauve)]/55" />
            <span>More reading</span>
          </div>
        </section>

        <aside className="inkbound-panel rounded-3xl p-5">
          <p className="inkbound-kicker">Selected day</p>
          <h3 className="mt-2 font-serif text-2xl text-[var(--ink-ivory)]">
            {parseDateKey(selectedDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>

          {!selectedActivity ? (
            <div className="mt-5 rounded-2xl border border-dashed border-[var(--ink-border)] p-6 text-center">
              <CalendarDays className="mx-auto h-7 w-7 text-[var(--ink-mauve)]" />
              <p className="mt-3 text-sm text-[var(--ink-muted)]">No reading activity was recorded on this day.</p>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[var(--ink-surface-soft)] p-3">
                  <Clock3 className="h-4 w-4 text-[var(--ink-mauve)]" />
                  <strong className="mt-2 block font-serif text-xl text-[var(--ink-ivory)]">{selectedActivity.minutes}m</strong>
                  <span className="text-xs text-[var(--ink-muted)]">Reading time</span>
                </div>
                <div className="rounded-xl bg-[var(--ink-surface-soft)] p-3">
                  <BookOpen className="h-4 w-4 text-[var(--ink-mauve)]" />
                  <strong className="mt-2 block font-serif text-xl text-[var(--ink-ivory)]">{selectedActivity.pages}</strong>
                  <span className="text-xs text-[var(--ink-muted)]">Pages read</span>
                </div>
              </div>

              {selectedSessionBooks.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Books read</h4>
                  <div className="mt-2 grid gap-2">
                    {selectedSessionBooks.map((book) => (
                      <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-left hover:border-[var(--ink-mauve)]">
                        <strong className="block truncate text-sm text-[var(--ink-ivory)]">{book.work.title}</strong>
                        <span className="text-xs text-[var(--ink-muted)]">{book.work.author}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedActivity.finishedBooks.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Finished this day</h4>
                  <div className="mt-2 grid gap-2">
                    {selectedActivity.finishedBooks.map((book) => (
                      <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="rounded-xl border border-[var(--ink-gold)]/30 bg-[var(--ink-gold)]/10 p-3 text-left">
                        <strong className="block truncate text-sm text-[var(--ink-ivory)]">{book.work.title}</strong>
                        <span className="text-xs text-[var(--ink-muted)]">Completed</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
  <article className="inkbound-panel rounded-2xl p-5">
    <Icon className="h-5 w-5 text-[var(--ink-mauve)]" />
    <span className="mt-4 block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">{label}</span>
    <strong className="mt-1 block font-serif text-3xl text-[var(--ink-ivory)]">{value}</strong>
    <p className="mt-1 text-xs text-[var(--ink-muted)]">{detail}</p>
  </article>
);
