import React from 'react';
import { ArrowRight, BarChart3, Clock, Flame } from 'lucide-react';
import { getActiveEdition } from '../../features/reading/bookReadingState';
import { getAnnualReadingGoal } from '../../features/reading/readingPreferences';
import {
  getReadingStreak,
  getSessionDurationMinutes,
  getSessionListeningMinutes,
  getSessionPagesRead,
} from '../../features/reading/sessionAnalytics';
import { ReadingSession, UserBookRecord } from '../../types';

interface DashboardSidebarProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  annualGoal?: number;
  onViewAllSessions: () => void;
}

const formatSessionDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0).toLocaleDateString();
};

const sessionSortKey = (session: ReadingSession) =>
  `${session.date}T${session.endTime || session.startTime || '00:00'}`;

export function DashboardSidebar({
  books,
  sessions,
  annualGoal,
  onViewAllSessions,
}: DashboardSidebarProps) {
  const tbrBooks = books.filter((book) => book.status === 'tbr');
  const finishedBooksCount = books.filter((book) => book.status === 'finished').length;
  const resolvedAnnualGoal = annualGoal ?? getAnnualReadingGoal();
  const goalPercent = resolvedAnnualGoal > 0
    ? Math.min(100, Math.round((finishedBooksCount / resolvedAnnualGoal) * 100))
    : 0;

  // Reading activity comes from completed sessions rather than inferred book
  // progress. This keeps this legacy sidebar aligned with Inkbound's canonical
  // statistics model if it is reused in a future dashboard layout.
  const completedSessions = sessions.filter((session) => getSessionDurationMinutes(session) > 0);
  const totalPagesRead = completedSessions.reduce((total, session) => {
    const book = books.find((item) => item.id === session.bookId);
    if (getActiveEdition(book)?.format === 'audiobook') return total;
    return total + getSessionPagesRead(session);
  }, 0);
  const listeningMinutes = completedSessions.reduce((total, session) => {
    const book = books.find((item) => item.id === session.bookId);
    if (getActiveEdition(book)?.format !== 'audiobook') return total;
    return total + getSessionListeningMinutes(session);
  }, 0);
  const listeningHours = (listeningMinutes / 60).toFixed(1);
  const currentStreak = getReadingStreak(completedSessions);
  const recentSessions = [...completedSessions]
    .sort((a, b) => sessionSortKey(b).localeCompare(sessionSortKey(a)))
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-4 flex items-center gap-2.5">
          <BarChart3 className="h-5 w-5 text-[#7b5b6b]" />
          <h2 className="font-serif text-2xl text-[#e8ded3]">Reading Goals</h2>
        </div>

        <div className="rounded-2xl border border-[#7b5b6b]/16 bg-[#141116] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
          <div className="flex items-center gap-5">
            <div
              className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full"
              role="progressbar"
              aria-label="Annual reading goal"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={goalPercent}
              style={{
                background: `conic-gradient(#8c687b ${goalPercent * 3.6}deg, #33282f 0deg)`,
              }}
            >
              <div className="grid h-[88px] w-[88px] place-items-center rounded-full bg-[#141116]">
                <span className="font-serif text-3xl text-[#e8ded3]">{goalPercent}%</span>
              </div>
            </div>
            <div className="min-w-0">
              <p className="font-serif text-2xl text-[#e8ded3]">
                {finishedBooksCount} of {resolvedAnnualGoal}
              </p>
              <p className="mt-1 text-xs text-[#948984]">books completed</p>
              <p className="mt-4 text-xs font-medium text-[#c9bbb0]">
                You’re building a beautiful reading year.
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-white/6">
            <Metric label="Pages Read" value={totalPagesRead.toLocaleString()} />
            <Metric label="Listening Time" value={`${listeningHours}h`} />
            <Metric
              label="Current Streak"
              value={`${currentStreak} day${currentStreak === 1 ? '' : 's'}`}
              icon={<Flame className="h-4 w-4 text-[#c9bbb0]" />}
            />
            <Metric label="Books on TBR" value={String(tbrBooks.length)} />
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Clock className="h-5 w-5 text-[#7b5b6b]" />
            <h2 className="font-serif text-2xl text-[#e8ded3]">Recent Activity</h2>
          </div>
          <button
            type="button"
            onClick={onViewAllSessions}
            className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-[#876477] hover:text-[#a17b8d]"
          >
            View all
          </button>
        </div>
        <ActivityList sessions={recentSessions} books={books} />
      </section>
    </div>
  );
}

const Metric: React.FC<{ label: string; value: string; icon?: React.ReactNode }> = ({
  label,
  value,
  icon,
}) => (
  <div className="min-h-[92px] min-w-0 border-b border-r border-white/6 p-4 last:border-r-0">
    <div className="flex items-center gap-2">
      <p className="break-words font-serif text-xl text-[#e8ded3]">{value}</p>
      {icon}
    </div>
    <p className="mt-1 text-[11px] text-[#817672]">{label}</p>
  </div>
);

const ActivityList: React.FC<{
  sessions: ReadingSession[];
  books: UserBookRecord[];
}> = ({ sessions, books }) => (
  <div className="overflow-hidden rounded-2xl border border-[#7b5b6b]/16 bg-[#141116]">
    {sessions.length === 0 ? (
      <div className="p-8 text-center text-sm text-[#817672]">
        Your reading activity will appear here.
      </div>
    ) : (
      sessions.map((session, index) => {
        const book = books.find((item) => item.id === session.bookId);

        return (
          <div
            key={session.id}
            className={`flex gap-3 p-4 ${
              index !== sessions.length - 1 ? 'border-b border-white/6' : ''
            }`}
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#6f4e5f]/25 bg-[#6f4e5f]/10 text-[#8c687b]">
              <Clock className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-5 text-[#cfc4ba]">
                Reading session completed for{' '}
                <span className="break-words font-serif text-sm text-[#e8ded3]">
                  {book?.work.title || 'a book'}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-[#786e6b]">
                {formatSessionDate(session.date)} · {getSessionDurationMinutes(session)} minutes
              </p>
            </div>
            <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-[#817672]" />
          </div>
        );
      })
    )}
  </div>
);
