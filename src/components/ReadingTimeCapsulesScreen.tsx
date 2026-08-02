import React, { useMemo, useState } from 'react';
import { CalendarClock, LockKeyhole, MailOpen, Plus, Trash2 } from 'lucide-react';
import { UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';

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

export const ReadingTimeCapsulesScreen: React.FC<ReadingTimeCapsulesScreenProps> = ({
  books,
  onSelectBook,
}) => {
  const [capsules, setCapsules] = usePersistentState<TimeCapsule[]>(CAPSULES_KEY, []);
  const [filter, setFilter] = usePersistentState<'all' | CapsuleStatus>(CAPSULE_FILTER_KEY, 'all');
  const [isCreating, setIsCreating] = useState(false);
  const [bookId, setBookId] = useState(books[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [revealAt, setRevealAt] = useState(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().slice(0, 10);
  });

  const visibleCapsules = useMemo(
    () => capsules
      .filter((capsule) => filter === 'all' || getStatus(capsule) === filter)
      .sort((a, b) => new Date(a.revealAt).getTime() - new Date(b.revealAt).getTime()),
    [capsules, filter],
  );

  const createCapsule = () => {
    if (!bookId || !message.trim() || !revealAt) return;
    setCapsules((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        bookId,
        message: message.trim(),
        createdAt: new Date().toISOString(),
        revealAt: new Date(`${revealAt}T09:00:00`).toISOString(),
      },
    ]);
    setMessage('');
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
    <div className="space-y-6 pb-16">
      <section className="inkbound-panel rounded-3xl p-6 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--ink-gold-bright)]">Letters across time</p>
            <h2 className="mt-2 font-serif text-3xl text-[var(--ink-ivory)] md:text-4xl">Reading Time Capsules</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--ink-muted)]">
              Seal a private note about a book and let Inkbound return it to you on a future date.
            </p>
          </div>
          <button type="button" className="quiet-shelf-primary-action justify-center" onClick={() => setIsCreating(true)}>
            <Plus /> New capsule
          </button>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {(['all', 'sealed', 'ready', 'opened'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold capitalize ${filter === option ? 'border-[var(--ink-gold)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}
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
              <article key={capsule.id} className="inkbound-panel rounded-3xl p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-[var(--ink-gold)]">
                      {status === 'sealed' ? <LockKeyhole /> : <MailOpen />}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-gold-bright)]">{status}</p>
                      <button type="button" onClick={() => book && onSelectBook(book)} className="mt-1 text-left font-serif text-xl text-[var(--ink-ivory)] hover:text-[var(--ink-gold-bright)]">
                        {book?.work.title ?? 'Unknown book'}
                      </button>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">Reveals {new Date(capsule.revealAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setCapsules((current) => current.filter((item) => item.id !== capsule.id))} className="quiet-shelf-icon-button" aria-label="Delete time capsule">
                    <Trash2 />
                  </button>
                </div>

                <div className="mt-6 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
                  {canRead ? (
                    <p className="whitespace-pre-wrap font-serif text-lg leading-8 text-[var(--ink-ivory)]">{capsule.message}</p>
                  ) : (
                    <p className="text-sm leading-7 text-[var(--ink-muted)]">This letter remains sealed until its reveal date.</p>
                  )}
                </div>

                {status === 'ready' && (
                  <button type="button" className="quiet-shelf-secondary-action mt-5 justify-center" onClick={() => openCapsule(capsule.id)}>
                    <MailOpen /> Mark as opened
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}

      {isCreating && (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm md:items-center" onClick={() => setIsCreating(false)}>
          <section className="inkbound-panel w-full max-w-xl rounded-3xl p-6" onClick={(event) => event.stopPropagation()}>
            <h3 className="font-serif text-2xl text-[var(--ink-ivory)]">Seal a reading memory</h3>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-[var(--ink-muted)]">Book
                <select value={bookId} onChange={(event) => setBookId(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-[var(--ink-ivory)]">
                  {books.map((book) => <option key={book.id} value={book.id}>{book.work.title}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold text-[var(--ink-muted)]">Reveal date
                <input type="date" value={revealAt} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setRevealAt(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-[var(--ink-ivory)]" />
              </label>
              <label className="block text-sm font-semibold text-[var(--ink-muted)]">Letter to your future self
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={7} placeholder="What do you hope you remember about this book and this season of your life?" className="mt-2 w-full resize-none rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-[var(--ink-ivory)]" />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="quiet-shelf-secondary-action" onClick={() => setIsCreating(false)}>Cancel</button>
              <button type="button" className="quiet-shelf-primary-action" onClick={createCapsule} disabled={!bookId || !message.trim()}>Seal capsule</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
