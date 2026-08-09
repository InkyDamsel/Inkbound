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
import type { ReadingSession, UserBookRecord } from '../types';

interface ReadingActivityOverviewProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  onSelectBook: (book: UserBookRecord) => void;
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
}) => {
  // Reading activity is intentionally tracker-only. Imported reading dates never populate this calendar.
  const trackerSessions = useMemo(
    () => sessions.filter((session) => Boolean(normalizeDateKey(session.date))),
    [sessions],
  );

  const latestActivityDate = useMemo(() => {
    const values = trackerSessions
      .map((session) => normalizeDateKey(session.date))
      .filter((value): value is string => Boolean(value))
      .sort();
    return values.at(-1) ?? toLocalDateKey(new Date());
  }, [trackerSessions]);

  const [visibleMonth, setVisibleMonth] = useState(() => monthKey(parseDateKey(latestActivityDate)));
  const [selectedDate, setSelectedDate] = useState(() => latestActivityDate);

  const activityByDate = useMemo(() => {
    const map = new Map<string, DayActivity>();
    trackerSessions.forEach((session) => {
      const date = normalizeDateKey(session.date);
      if (!date) return;
      const existing = map.get(date) ?? { date, sessions: [], minutes: 0, pages: 0 };
      existing.sessions.push(session);
      existing.minutes += session.durationMinutes ?? 0;
      existing.pages += session.pagesRead ?? Math.max(0, (session.endPage ?? 0) - (session.startPage ?? 0));
      map.set(date, existing);
    });
    return map;
  }, [trackerSessions]);

  const activeDates = useMemo(
    () => [...activityByDate.keys()].sort(),
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
    const cells: Array<string | null> = Array.from({ length: firstDay.getDay() }, () => null);
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

  return (
    <section className="space-y-5" aria-labelledby="reading-activity-title">
      <header className="inkbound-panel rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inkbound-kicker">Your reading rhythm</p>
            <h2 id="reading-activity-title" className="mt-2 font-serif text-3xl text-[var(--ink-ivory)]">Streak & Calendar</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
              This calendar only reflects reading sessions recorded with Inkbound. Imported reading dates never affect your streaks or tracker history.
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Flame} label="Current streak" value={`${currentStreak} ${currentStreak === 1 ? 'day' : 'days'}`} detail={currentStreak > 0 ? 'Your Inkbound reading rhythm is active.' : 'Save an Inkbound session to begin.'} />
        <MetricCard icon={Trophy} label="Longest streak" value={`${longestStreak} ${longestStreak === 1 ? 'day' : 'days'}`} detail="Your tracker-only personal best." />
        <MetricCard icon={CalendarDays} label="Reading days" value={totalReadingDays.toLocaleString()} detail="Days with saved Inkbound sessions." />
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
                  aria-label={`${new Date(`${date}T12:00:00`).toLocaleDateString()}: ${activity?.sessions.length ?? 0} Inkbound reading sessions`}
                >
                  <span className={`text-xs font-semibold ${isToday ? 'text-[var(--ink-gold)]' : 'text-[var(--ink-ivory)]'}`}>{Number(date.slice(-2))}</span>
                  {activity && (
                    <span className="absolute inset-x-1 bottom-1 flex items-center justify-between text-[8px] text-[var(--ink-ivory)]/75">
                      <span>{activity.minutes}m</span>
                      <BookOpen className="h-2.5 w-2.5" />
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
            {new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>

          {!selectedActivity ? (
            <div className="mt-5 rounded-2xl border border-dashed border-[var(--ink-border)] p-6 text-center">
              <CalendarDays className="mx-auto h-7 w-7 text-[var(--ink-mauve)]" />
              <p className="mt-3 text-sm text-[var(--ink-muted)]">No Inkbound reading session was recorded on this day.</p>
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
