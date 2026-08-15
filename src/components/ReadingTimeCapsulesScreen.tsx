import React, { useMemo, useState } from 'react';
import { CalendarClock, LockKeyhole, MailOpen, Plus, Trash2 } from 'lucide-react';
import { UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { localDateKey } from '../features/reading/sessionAnalytics';

type CapsuleStatus = 'sealed' | 'ready' | 'opened';

interface TimeCapsule {
  id: string;
  bookId: string;
  message: string;
  createdAt: string;
  revealAt: string;
  openedAt?: string;
}

interface ReadingTimeCapsulesScreenProps {
  books: UserBookRecord[];
  onSelectBook: (book: UserBookRecord) => void;
}

const CAPSULES_KEY = 'inkbound_reading_time_capsules';
const CAPSULE_FILTER_KEY = 'inkbound_time_capsule_filter';

function getStatus(capsule: TimeCapsule): CapsuleStatus {
  if (capsule.openedAt) return 'opened';
  return new Date(capsule.revealAt).getTime() <= Date.now() ? 'ready' : 'sealed';
}

function defaultRevealDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return localDateKey(date);
}

export const ReadingTimeCapsulesScreen: React.FC<ReadingTimeCapsulesScreenProps> = ({
  books,
  onSelectBook,
}) => {
  const [capsules, setCapsules] = usePersistentState<TimeCapsule[]>(CAPSULES_KEY, []);
  const [filter, setFilter] = usePersistentState<'all' | CapsuleStatus>(CAPSULE_FILTER_KEY, 'all');
  const [isCreating, setIsCreating] = useState(false);
  const [bookId, setBookId] = useState(books[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [revealAt, setRevealAt] = useState(defaultRevealDate);

  const visibleCapsules = useMemo(
    () => capsules
      .filter((capsule) => filter === 'all' || getStatus(capsule) === filter)
      .sort((a, b) => new Date(a.revealAt).getTime() - new Date(b.revealAt).getTime()),
    [capsules, filter],
  );

  const createCapsule = () => {
    if (!bookId || !message.trim() || !revealAt || revealAt < localDateKey()) return;
    setCapsules((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        bookId,
        message: message.trim(),
        createdAt: new Date().toISOString(),
        // 9 AM local time avoids UTC date shifts while preserving an exact reveal instant.
        revealAt: new Date(`${revealAt}T09:00:00`).toISOString(),
      },
    ]);
    setMessage('');
    setRevealAt(defaultRevealDate());
    setIsCreating(false);
  };

  const openCapsule = (id: string) => {
    setCapsules((current) =>
      current.map((capsule) =>
        capsule.id === id && getStatus(capsule) === 'ready'
          ? { ...capsule, openedAt: new Date().toISOString() }
          : capsule,
      ),
    );
  };

  return (
    <div className="space-y-6 pb-20">
      <section className="inkbound-panel rounded-3xl p-5 sm:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ink-gold-bright)]">Letters across time</p>
            <h2 className="mt-2 font-serif text-3xl text-[var(--ink-ivory)] md:text-4xl">Reading Time Capsules</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-muted)]">
              Seal a private note about a book and reveal it when you return to Inkbound on or after a future date.
            </p>
          </div>
          <button type="button" disabled={books.length === 0} className="quiet-shelf-primary-action justify-center disabled:cursor-not-allowed disabled:opacity-45" onClick={() => setIsCreating(true)}>
            <Plus /> New capsule
          </button>
        </div>
        {books.length === 0 && <p className="mt-4 text-xs text-[var(--ink-muted)]">Add a book before creating a reading time capsule.</p>}
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(['all', 'sealed', 'ready', 'opened'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-semibold capitalize ${filter === option ? 'border-[var(--ink-gold)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}
          >
            {option}
          </button>
        ))}
      </div>

      {visibleCapsules.length === 0 ? (
        <section className="inkbound-panel rounded-3xl p-10 text-center">
          <CalendarClock className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
          <h3 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">No time capsules here yet</h3>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Write something your future reading self will be glad to remember.</p>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleCapsules.map((capsule) => {
            const book = books.find((item) => item.id === capsule.bookId);
            const status = getStatus(capsule);
            const canRead = status !== 'sealed';
            return (
              <article key={capsule.id} className="inkbound-panel min-w-0 rounded-3xl p-5 sm:p-6">
                <div className="flex min-w-0 items-start justify-between gap-3 sm:gap-4">
                  <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                    <div className="shrink-0 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-[var(--ink-gold)]">
                      {status === 'sealed' ? <LockKeyhole /> : <MailOpen />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-gold-bright)]">{status}</p>
                      <button type="button" onClick={() => book && onSelectBook(book)} className="mt-1 min-h-11 max-w-full break-words text-left font-serif text-xl text-[var(--ink-ivory)] hover:text-[var(--ink-gold-bright)]">
                        {book?.work.title ?? 'Unknown book'}
                      </button>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">Reveals {new Date(capsule.revealAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setCapsules((current) => current.filter((item) => item.id !== capsule.id))} className="quiet-shelf-icon-button shrink-0" aria-label="Delete time capsule">
                    <Trash2 />
                  </button>
                </div>

                <div className="mt-6 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
                  {canRead ? (
                    <p className="whitespace-pre-wrap break-words font-serif text-lg leading-8 text-[var(--ink-ivory)]">{capsule.message}</p>
                  ) : (
                    <p className="text-sm leading-7 text-[var(--ink-muted)]">This letter remains sealed until its reveal date.</p>
                  )}
                </div>

                {status === 'ready' && (
                  <button type="button" className="quiet-shelf-secondary-action mt-5 w-full justify-center sm:w-auto" onClick={() => openCapsule(capsule.id)}>
                    <MailOpen /> Mark as opened
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}

      {isCreating && (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setIsCreating(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="time-capsule-title" className="inkbound-panel w-full max-w-xl rounded-t-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-3xl sm:p-6" onClick={(event) => event.stopPropagation()}>
            <h3 id="time-capsule-title" className="font-serif text-2xl text-[var(--ink-ivory)]">Seal a reading memory</h3>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-[var(--ink-muted)]">Book
                <select value={bookId} onChange={(event) => setBookId(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)]">
                  {books.map((book) => <option key={book.id} value={book.id}>{book.work.title}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold text-[var(--ink-muted)]">Reveal date
                <input type="date" value={revealAt} min={localDateKey()} onChange={(event) => setRevealAt(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)]" />
              </label>
              <label className="block text-sm font-semibold text-[var(--ink-muted)]">Letter to your future self
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={7} placeholder="What do you hope you remember about this book and this season of your life?" className="mt-2 w-full resize-none rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-[var(--ink-ivory)]" />
              </label>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" className="quiet-shelf-secondary-action justify-center" onClick={() => setIsCreating(false)}>Cancel</button>
              <button type="button" className="quiet-shelf-primary-action justify-center" onClick={createCapsule} disabled={!bookId || !message.trim() || !revealAt || revealAt < localDateKey()}>Seal capsule</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};