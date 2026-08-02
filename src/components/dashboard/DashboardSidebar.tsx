import React from 'react';
import { ArrowRight, BarChart3, Clock, Flame } from 'lucide-react';
import { ReadingSession, UserBookRecord } from '../../types';

interface DashboardSidebarProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  annualGoal?: number;
  onViewAllSessions: () => void;
}

export function DashboardSidebar({
  books,
  sessions,
  annualGoal = 50,
  onViewAllSessions,
}: DashboardSidebarProps) {
  const tbrBooks = books.filter((book) => book.status === 'tbr');
  const finishedBooksCount = books.filter((book) => book.status === 'finished').length;
  const goalPercent = Math.min(100, Math.round((finishedBooksCount / annualGoal) * 100));

  const totalPagesRead = books.reduce((total, book) => {
    const activeEdition =
      book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

    if (activeEdition?.format === 'audiobook') return total;
    if (book.status === 'finished') return total + (activeEdition?.pageCount ?? 300);
    if (book.status === 'currently-reading') return total + book.progressPages;
    return total;
  }, 0);

  const listeningMinutes = books.reduce((total, book) => {
    const activeEdition =
      book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

    if (activeEdition?.format !== 'audiobook') return total;
    if (book.status === 'finished') return total + (activeEdition.audiobookDurationMins ?? 0);
    if (book.status === 'currently-reading') return total + book.progressMinutes;
    return total;
  }, 0);

  const listeningHours = (listeningMinutes / 60).toFixed(1);
  const recentSessions = sessions.slice(0, 5);

  return (
    <aside className="space-y-5">
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="h-5 w-5 text-[#7b5b6b]" />
            <h2 className="font-serif text-2xl text-[#e8ded3]">Reading Goals</h2>
          </div>
          <button
            type="button"
            className="text-xs font-semibold text-[#876477] hover:text-[#a17b8d]"
          >
            Edit Goal
          </button>
        </div>

        <div className="rounded-2xl border border-[#7b5b6b]/16 bg-[#141116] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
          <div className="flex items-center gap-5">
            <div
              className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full"
              style={{
                background: `conic-gradient(#8c687b ${goalPercent * 3.6}deg, #33282f 0deg)`,
              }}
            >
              <div className="grid h-[88px] w-[88px] place-items-center rounded-full bg-[#141116]">
                <span className="font-serif text-3xl text-[#e8ded3]">{goalPercent}%</span>
              </div>
            </div>
            <div>
              <p className="font-serif text-2xl text-[#e8ded3]">
                {finishedBooksCount} of {annualGoal}
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
              value="14 days"
              icon={<Flame className="h-4 w-4 text-[#c9bbb0]" />}
            />
            <Metric label="Books on TBR" value={String(tbrBooks.length)} />
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Clock className="h-5 w-5 text-[#7b5b6b]" />
            <h2 className="font-serif text-2xl text-[#e8ded3]">Recent Activity</h2>
          </div>
          <button
            type="button"
            onClick={onViewAllSessions}
            className="text-xs font-semibold text-[#876477] hover:text-[#a17b8d]"
          >
            View all
          </button>
        </div>
        <ActivityList sessions={recentSessions} books={books} />
      </section>
    </aside>
  );
}

const Metric: React.FC<{ label: string; value: string; icon?: React.ReactNode }> = ({
  label,
  value,
  icon,
}) => (
  <div className="min-h-[92px] border-b border-r border-white/6 p-4 last:border-r-0">
    <div className="flex items-center gap-2">
      <p className="font-serif text-xl text-[#e8ded3]">{value}</p>
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
                <span className="font-serif text-sm text-[#e8ded3]">
                  {book?.work.title || 'a book'}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-[#786e6b]">
                {session.date} · {session.durationMinutes} minutes
              </p>
            </div>
            <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-[#817672]" />
          </div>
        );
      })
    )}
  </div>
);
