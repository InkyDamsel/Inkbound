import React, { useMemo, useState } from 'react';
import { ShareReadingCalendar } from './ShareReadingCalendar';
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
import { isInkboundFinishedBook } from '../features/reading/inkboundActivity';
import {
  getLongestReadingStreak,
  getReadingDates,
  getReadingStreak,
  getSessionDurationMinutes,
  getSessionPagesRead,
  isRecordedReadingActivity,
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

const STREAK_BANNER_ASSET = '/assets/streaks/cozy-streak-background.png';

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

const formatMinutes = (minutes: number) => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
};

export const ReadingActivityOverview: React.FC<ReadingActivityOverviewProps> = ({ books, sessions, onSelectBook }) => {
  const trackerSessions = useMemo(
    () => sessions.filter((session) => Boolean(normalizeDateKey(session.date)) && isRecordedReadingActivity(session)),
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
  const trackedBookIds = useMemo(() => new Set(trackerSessions.map((session) => session.bookId)), [trackerSessions]);
  const currentStreak = getReadingStreak(trackerSessions);
  const longestStreak = getLongestReadingStreak(trackerSessions);
  const totalReadingDays = activeDates.length;
  const visibleMonthReadingDays = activeDates.filter((date) => date.startsWith(visibleMonth)).length;

  const monthlyStats = useMemo(() => {
    const monthSessions = trackerSessions.filter((session) => normalizeDateKey(session.date)?.startsWith(visibleMonth));
    const minutes = monthSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0);
    const pages = monthSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0);
    const bookIds = new Set(monthSessions.map((session) => session.bookId));
    const finishedBooks = books.filter((book) => isInkboundFinishedBook(book, trackedBookIds) && normalizeDateKey(book.dateFinished)?.startsWith(visibleMonth)).length;
    const longestSession = monthSessions.reduce((longest, session) => Math.max(longest, getSessionDurationMinutes(session)), 0);
    return { minutes, pages, booksTouched: bookIds.size, finishedBooks, longestSession };
  }, [books, trackedBookIds, trackerSessions, visibleMonth]);

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
      <header className="relative overflow-hidden rounded-3xl border border-[var(--ink-border-subtle)] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
        <div aria-hidden="true" className="pointer-events-none absolute -inset-3 scale-[1.035] bg-cover bg-center bg-no-repeat blur-[3px]" style={{ backgroundImage: `url("${STREAK_BANNER_ASSET}")` }} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(9,8,18,.88)_0%,rgba(9,8,18,.68)_48%,rgba(9,8,18,.34)_78%,rgba(9,8,18,.22)_100%)]" />
        <div className="relative z-10 flex min-h-[250px] flex-col justify-between gap-5 p-5 sm:p-7 lg:flex-row lg:items-end">
          <div className="max-w-2xl rounded-[1.5rem] border border-white/10 bg-black/25 p-5 backdrop-blur-[3px]">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#e0c77c]">Your reading rhythm</p>
            <h2 id="reading-activity-title" className="mt-2 font-serif text-3xl text-white sm:text-4xl">Streak & Calendar</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">Watch your reading month fill with the books you actually spend time with. Imported dates never affect streaks or tracker history.</p>
          </div>
          <div className="flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 backdrop-blur-[3px] sm:w-auto">
            <button type="button" onClick={() => moveMonth(-1)} className="quiet-shelf-icon-button shrink-0 border border-white/10 bg-black/20 text-white" aria-label="Previous month"><ChevronLeft /></button>
            <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-center sm:min-w-44 sm:flex-none sm:px-4">
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">Activity month</span>
              <strong className="block truncate font-serif text-lg text-white">{monthLabel(visibleMonth)}</strong>
            </div>
            <button type="button" onClick={() => moveMonth(1)} className="quiet-shelf-icon-button shrink-0 border border-white/10 bg-black/20 text-white" aria-label="Next month"><ChevronRight /></button>
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Flame} label="Current streak" value={`${currentStreak} ${currentStreak === 1 ? 'day' : 'days'}`} detail={currentStreak > 0 ? 'Your Inkbound reading rhythm is active.' : 'Save an Inkbound session to begin.'} />
        <MetricCard icon={Trophy} label="Longest streak" value={`${longestStreak} ${longestStreak === 1 ? 'day' : 'days'}`} detail="Your tracker-only personal best." />
        <MetricCard icon={CalendarDays} label="Reading days" value={totalReadingDays.toLocaleString()} detail="Days with completed Inkbound sessions." />
        <MetricCard icon={Sparkles} label="Selected month" value={`${visibleMonthReadingDays} ${visibleMonthReadingDays === 1 ? 'day' : 'days'}`} detail={monthLabel(visibleMonth)} />
      </div>

      <section className="inkbound-panel rounded-3xl p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="inkbound-kicker">Month at a glance</p><h3 className="mt-1 font-serif text-2xl text-[var(--ink-ivory)]">{monthLabel(visibleMonth)}</h3></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[620px]">
            <MiniMetric label="Time read" value={formatMinutes(monthlyStats.minutes)} />
            <MiniMetric label="Pages" value={monthlyStats.pages.toLocaleString()} />
            <MiniMetric label="Books touched" value={monthlyStats.booksTouched.toLocaleString()} />
            <MiniMetric label="Books finished" value={monthlyStats.finishedBooks.toLocaleString()} />
          </div>
        </div>
        {monthlyStats.longestSession > 0 && <p className="mt-4 text-xs text-[var(--ink-muted)]">Longest session this month: <strong className="text-[var(--ink-ivory)]">{formatMinutes(monthlyStats.longestSession)}</strong></p>}
      </section>

      <ShareReadingCalendar month={visibleMonth} books={books} sessions={trackerSessions} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="inkbound-panel rounded-3xl p-3 sm:p-6">
          <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-bold uppercase tracking-wider text-[var(--ink-muted)] sm:text-[11px]">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day} className="py-2">{day}</span>)}</div>
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {calendarDays.map((date, index) => {
              if (!date) return <span key={`empty-${index}`} className="aspect-square" aria-hidden="true" />;
              const activity = activityByDate.get(date);
              const isToday = date === toLocalDateKey(new Date());
              const isSelected = date === selectedDate;
              const dayBooks = activity ? [...new Set(activity.sessions.map((session) => session.bookId))].map((bookId) => booksById.get(bookId)).filter((book): book is UserBookRecord => Boolean(book)) : [];
              const visibleBooks = dayBooks.slice(0, 3);
              const extraBooks = Math.max(0, dayBooks.length - visibleBooks.length);
              const intensity = activity ? Math.min(1, activity.minutes / 120) : 0;
              return (
                <button key={date} type="button" onClick={() => setSelectedDate(date)} className={`relative aspect-square min-w-0 overflow-hidden rounded-xl border p-0.5 text-left transition sm:rounded-2xl sm:p-1 sm:hover:-translate-y-0.5 ${isSelected ? 'border-[var(--ink-gold)] ring-1 ring-[var(--ink-gold)]/40' : isToday ? 'border-[var(--ink-mauve)]' : 'border-[var(--ink-border-subtle)]'}`} style={{ background: activity ? `linear-gradient(145deg, color-mix(in srgb, var(--ink-mauve) ${Math.round(10 + intensity * 12)}%, var(--ink-surface-soft)), var(--ink-surface-soft))` : 'var(--ink-surface-soft)' }} aria-label={`${new Date(`${date}T12:00:00`).toLocaleDateString()}: ${activity?.sessions.length ?? 0} Inkbound reading sessions${dayBooks.length ? ` across ${dayBooks.length} ${dayBooks.length === 1 ? 'book' : 'books'}` : ''}`}>
                  <span className={`relative z-20 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-0.5 text-[10px] font-semibold sm:h-6 sm:min-w-6 sm:px-1 sm:text-xs ${isToday ? 'bg-[var(--ink-gold)] text-black' : 'text-[var(--ink-ivory)]'}`}>{Number(date.slice(-2))}</span>
                  {activity && <span className="absolute inset-x-1 bottom-1 flex items-center justify-between sm:hidden"><span className="h-1.5 w-1.5 rounded-full bg-[var(--ink-gold)]" aria-hidden="true" /><span className="truncate text-[7px] font-bold text-[var(--ink-ivory)]">{formatMinutes(activity.minutes)}</span></span>}
                  {visibleBooks.length > 0 && <span className="absolute inset-x-1.5 bottom-1.5 top-7 hidden items-end justify-center gap-1 overflow-hidden sm:flex">{visibleBooks.map((book) => { const coverUrl = getCoverUrl(book); const edition = getActiveEdition(book); return <span key={book.id} title={book.work.title} className={`relative h-full min-w-0 flex-1 overflow-hidden rounded-md border border-white/15 bg-gradient-to-br shadow-lg ${edition?.coverGradient ?? 'from-[#4b2f50] via-[#2c1c32] to-[#161018]'}`}>{coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span className="flex h-full w-full items-center justify-center px-0.5 text-center font-serif text-[7px] leading-tight text-[var(--ink-ivory)]/85">{book.work.title}</span>}</span>; })}</span>}
                  {activity && <span className="absolute bottom-1.5 left-1.5 z-30 hidden rounded-full bg-black/70 px-1.5 py-0.5 text-[8px] font-bold text-white sm:block">{formatMinutes(activity.minutes)}</span>}
                  {extraBooks > 0 && <span className="absolute bottom-1.5 right-1.5 z-30 hidden rounded-full bg-black/75 px-1.5 py-0.5 text-[8px] font-bold text-white sm:block">+{extraBooks}</span>}
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-[var(--ink-muted)]">On phones, reading days stay clean and show session time instead of squeezing covers into tiny cells. Select a day for the full story.</p>
        </section>

        <aside className="inkbound-panel rounded-3xl p-5">
          <p className="inkbound-kicker">Selected day</p>
          <h3 className="mt-2 break-words font-serif text-2xl text-[var(--ink-ivory)]">{new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          {!selectedActivity ? <div className="mt-5 rounded-2xl border border-dashed border-[var(--ink-border)] p-6 text-center"><CalendarDays className="mx-auto h-7 w-7 text-[var(--ink-mauve)]" /><p className="mt-3 text-sm text-[var(--ink-muted)]">No completed Inkbound reading session was recorded on this day.</p></div> : <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3"><MiniMetric icon={Clock3} label="Reading time" value={formatMinutes(selectedActivity.minutes)} /><MiniMetric icon={BookOpen} label="Pages read" value={selectedActivity.pages.toLocaleString()} /></div>
            <p className="text-xs text-[var(--ink-muted)]">{selectedActivity.sessions.length} {selectedActivity.sessions.length === 1 ? 'session' : 'sessions'} across {selectedSessionBooks.length} {selectedSessionBooks.length === 1 ? 'book' : 'books'}.</p>
            {selectedSessionBooks.length > 0 && <div><h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Books read</h4><div className="mt-2 grid gap-2">{selectedSessionBooks.map((book) => { const coverUrl = getCoverUrl(book); return <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-2.5 text-left hover:border-[var(--ink-mauve)]"><span className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-[var(--ink-surface)]">{coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover" /> : null}</span><span className="min-w-0"><strong className="block truncate text-sm text-[var(--ink-ivory)]">{book.work.title}</strong><span className="block truncate text-xs text-[var(--ink-muted)]">{book.work.author}</span></span></button>; })}</div></div>}
            <div><h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Sessions</h4><div className="mt-2 space-y-2">{selectedActivity.sessions.map((session) => <div key={session.id} className="rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-xs text-[var(--ink-muted)]"><div className="flex items-center justify-between gap-3"><span>{session.startTime || 'Activity'}</span><strong className="text-[var(--ink-ivory)]">{getSessionDurationMinutes(session) > 0 ? formatMinutes(getSessionDurationMinutes(session)) : session.activitySource === 'progress-confirmation' ? 'Progress update' : 'Recorded activity'}</strong></div>{getSessionPagesRead(session) > 0 && <p className="mt-1">{getSessionPagesRead(session).toLocaleString()} pages</p>}{session.notes && <p className="mt-2 line-clamp-2">{session.notes}</p>}</div>)}</div></div>
          </div>}
        </aside>
      </div>
    </section>
  );
};

interface MetricCardProps { icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail: string; }
const MetricCard: React.FC<MetricCardProps> = ({ icon: Icon, label, value, detail }) => <article className="inkbound-panel min-w-0 rounded-2xl p-5"><Icon className="h-5 w-5 text-[var(--ink-mauve)]" /><span className="mt-4 block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">{label}</span><strong className="mt-1 block break-words font-serif text-3xl text-[var(--ink-ivory)]">{value}</strong><p className="mt-1 break-words text-xs text-[var(--ink-muted)]">{detail}</p></article>;

interface MiniMetricProps { label: string; value: string; icon?: React.ComponentType<{ className?: string }>; }
const MiniMetric: React.FC<MiniMetricProps> = ({ label, value, icon: Icon }) => <div className="min-w-0 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3">{Icon && <Icon className="h-4 w-4 text-[var(--ink-mauve)]" />}<strong className="mt-1 block break-words font-serif text-xl text-[var(--ink-ivory)]">{value}</strong><span className="text-[11px] text-[var(--ink-muted)]">{label}</span></div>;
