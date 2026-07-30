import React, { useMemo, useState } from 'react';
import { UserBookRecord, Priority } from '../types';
import { BookCover } from './BookCover';
import {
  ArrowRight,
  Bookmark,
  Check,
  Filter,
  LayoutGrid,
  Layers,
  List,
  Play,
  Shuffle,
  Sparkles,
  X,
} from 'lucide-react';

interface TBRScreenProps {
  books: UserBookRecord[];
  onSelectBook: (book: UserBookRecord) => void;
  onUpdateStatus: (bookId: string, status: any) => void;
  onUpdatePriority: (bookId: string, priority: Priority) => void;
}

type TbrView = 'grid' | 'queue' | 'series' | 'genre';

const priorityOrder: Record<Priority, number> = {
  top: 1,
  high: 2,
  medium: 3,
  low: 4,
};

const priorityLabels: Record<Priority, string> = {
  top: 'Read Next',
  high: 'High Priority',
  medium: 'Someday Soon',
  low: 'Back Shelf',
};

export const TBRScreen: React.FC<TBRScreenProps> = ({
  books,
  onSelectBook,
  onUpdateStatus,
  onUpdatePriority,
}) => {
  const [tbrView, setTbrView] = useState<TbrView>('grid');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerMood, setPickerMood] = useState('all');
  const [pickerGenre, setPickerGenre] = useState('all');
  const [pickerFormat, setPickerFormat] = useState('all');
  const [pickerLength, setPickerLength] = useState('all');
  const [pickerOwnedOnly, setPickerOwnedOnly] = useState(false);
  const [recommendedBook, setRecommendedBook] = useState<UserBookRecord | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);

  const tbrBooks = useMemo(() => books.filter((book) => book.status === 'tbr'), [books]);

  const priorityBooks = useMemo(
    () => [...tbrBooks].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]),
    [tbrBooks],
  );

  const genres = useMemo(
    () => Array.from(new Set(tbrBooks.flatMap((book) => book.work.genres))).sort(),
    [tbrBooks],
  );

  const seriesGroups = useMemo(() => {
    return tbrBooks.reduce<Record<string, UserBookRecord[]>>((groups, book) => {
      const key = book.work.seriesName || 'Standalone Titles';
      groups[key] = [...(groups[key] || []), book];
      return groups;
    }, {});
  }, [tbrBooks]);

  const genreGroups = useMemo(() => {
    return tbrBooks.reduce<Record<string, UserBookRecord[]>>((groups, book) => {
      const key = book.work.genres[0] || 'General Fiction';
      groups[key] = [...(groups[key] || []), book];
      return groups;
    }, {});
  }, [tbrBooks]);

  const topPriorityCount = tbrBooks.filter((book) => book.priority === 'top').length;
  const ownedCount = tbrBooks.filter((book) => book.ownership === 'owned').length;
  const withReasonsCount = tbrBooks.filter((book) => Boolean(book.whyIAddedThis)).length;

  const handleChooseNextRead = () => {
    setIsSpinning(true);
    setRecommendedBook(null);

    const candidates = tbrBooks.filter((book) => {
      if (pickerMood !== 'all' && !book.moods.includes(pickerMood)) return false;
      if (pickerGenre !== 'all' && !book.work.genres.includes(pickerGenre)) return false;
      if (pickerFormat !== 'all' && !book.editions.some((edition) => edition.format === pickerFormat)) return false;
      if (pickerOwnedOnly && book.ownership !== 'owned') return false;

      const pageCount = book.editions[0]?.pageCount || 350;
      if (pickerLength === 'short' && pageCount >= 300) return false;
      if (pickerLength === 'medium' && (pageCount < 300 || pageCount > 500)) return false;
      if (pickerLength === 'long' && pageCount <= 500) return false;
      return true;
    });

    window.setTimeout(() => {
      setIsSpinning(false);
      setRecommendedBook(
        candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null,
      );
    }, 600);
  };

  const openPicker = () => {
    setRecommendedBook(null);
    setIsPickerOpen(true);
  };

  return (
    <div className="space-y-7 pb-20">
      <section className="inkbound-panel overflow-hidden p-6 sm:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <p className="inkbound-kicker">Your future reading</p>
            <h1 className="inkbound-page-title">To Be Read</h1>
            <p className="inkbound-page-copy mt-3">
              Keep the books that caught your attention, remember why they mattered, and shape a queue that feels personal rather than endless.
            </p>
          </div>

          <button type="button" onClick={openPicker} className="quiet-shelf-primary-action min-h-11 self-start px-5 xl:self-auto">
            <Sparkles className="h-4 w-4" />
            Choose My Next Read
          </button>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4">
            <p className="text-2xl font-serif text-[var(--ink-ivory)]">{tbrBooks.length}</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">Books waiting</p>
          </div>
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4">
            <p className="text-2xl font-serif text-[var(--ink-ivory)]">{topPriorityCount}</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">Marked read next</p>
          </div>
          <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4">
            <p className="text-2xl font-serif text-[var(--ink-ivory)]">{withReasonsCount}</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">Saved with a reason</p>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            { id: 'grid' as TbrView, label: 'All Books', icon: LayoutGrid },
            { id: 'queue' as TbrView, label: 'Priority Queue', icon: List },
            { id: 'series' as TbrView, label: 'By Series', icon: Layers },
            { id: 'genre' as TbrView, label: 'By Genre', icon: Filter },
          ].map((item) => {
            const Icon = item.icon;
            const active = tbrView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTbrView(item.id)}
                className={`inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-xs font-bold transition ${
                  active
                    ? 'border-[var(--ink-gold)] bg-[var(--ink-gold)] text-[#171015]'
                    : 'border-[var(--ink-border-subtle)] bg-[var(--ink-surface)] text-[var(--ink-muted)] hover:border-[var(--ink-border-strong)] hover:text-[var(--ink-ivory)]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-[var(--ink-muted)]">{ownedCount} of these books are already owned.</p>
      </div>

      {tbrBooks.length === 0 ? (
        <div className="inkbound-panel p-12 text-center">
          <Bookmark className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">Your TBR is clear</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--ink-muted)]">
            Books you mark as To Be Read will collect here with their priority and the reason you saved them.
          </p>
        </div>
      ) : tbrView === 'grid' ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {priorityBooks.map((book) => {
            const edition = book.editions.find((item) => item.id === book.activeEditionId) || book.editions[0];
            return (
              <article key={book.id} className="inkbound-panel flex gap-4 p-4 transition hover:-translate-y-0.5 hover:border-[var(--ink-border-strong)]">
                <button type="button" onClick={() => onSelectBook(book)} className="shrink-0 text-left">
                  <BookCover work={book.work} edition={edition} size="md" />
                </button>

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <span className="inkbound-badge">{priorityLabels[book.priority]}</span>
                    <select
                      aria-label={`Priority for ${book.work.title}`}
                      value={book.priority}
                      onChange={(event) => onUpdatePriority(book.id, event.target.value as Priority)}
                      className="inkbound-select min-h-8 w-auto px-2 py-1 text-[11px]"
                    >
                      <option value="top">Read Next</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>

                  <button type="button" onClick={() => onSelectBook(book)} className="mt-3 text-left">
                    <h2 className="line-clamp-2 font-serif text-xl leading-tight text-[var(--ink-ivory)] hover:text-[var(--ink-gold-bright)]">
                      {book.work.title}
                    </h2>
                    <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">{book.work.author}</p>
                  </button>

                  <div className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-bg)] p-3">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[var(--ink-gold)]">Why I added this</p>
                    <p className="mt-1 line-clamp-3 font-serif text-sm italic leading-relaxed text-[var(--ink-text-secondary)]">
                      {book.whyIAddedThis || 'No reason saved yet. Open the book to add one.'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onUpdateStatus(book.id, 'currently-reading')}
                    className="mt-auto flex min-h-9 items-center justify-center gap-2 pt-4 text-xs font-bold text-[var(--ink-gold-bright)]"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Start Reading
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : tbrView === 'queue' ? (
        <div className="space-y-5">
          {(['top', 'high', 'medium', 'low'] as Priority[]).map((priority) => {
            const group = priorityBooks.filter((book) => book.priority === priority);
            if (group.length === 0) return null;
            return (
              <section key={priority} className="inkbound-panel p-5">
                <div className="mb-4 flex items-center justify-between border-b border-[var(--ink-border-subtle)] pb-4">
                  <div>
                    <p className="inkbound-kicker">{priorityLabels[priority]}</p>
                    <h2 className="mt-1 font-serif text-2xl text-[var(--ink-ivory)]">{group.length} book{group.length === 1 ? '' : 's'}</h2>
                  </div>
                </div>
                <div className="space-y-3">
                  {group.map((book, index) => (
                    <div key={book.id} className="flex items-center gap-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-3">
                      <span className="w-7 text-center font-serif text-xl text-[var(--ink-gold)]">{index + 1}</span>
                      <button type="button" onClick={() => onSelectBook(book)} className="min-w-0 flex-1 text-left">
                        <p className="truncate font-serif text-lg text-[var(--ink-ivory)]">{book.work.title}</p>
                        <p className="truncate text-xs text-[var(--ink-muted)]">{book.work.author}</p>
                        {book.whyIAddedThis && <p className="mt-1 line-clamp-1 text-xs italic text-[var(--ink-gold)]">“{book.whyIAddedThis}”</p>}
                      </button>
                      <button type="button" onClick={() => onUpdateStatus(book.id, 'currently-reading')} className="quiet-shelf-primary-action min-h-9 px-3 text-xs">
                        Start
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : tbrView === 'series' ? (
        <div className="space-y-5">
          {Object.entries(seriesGroups).map(([seriesName, group]) => (
            <section key={seriesName} className="inkbound-panel p-5">
              <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">{seriesName}</h2>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">{group.length} waiting</p>
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {group.map((book) => (
                  <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="text-left">
                    <BookCover work={book.work} edition={book.editions[0]} size="md" />
                    <p className="mt-2 line-clamp-2 font-serif text-sm text-[var(--ink-ivory)]">{book.work.title}</p>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(genreGroups).map(([genre, group]) => (
            <section key={genre} className="inkbound-panel p-5">
              <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">{genre}</h2>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">{group.length} waiting</p>
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {group.map((book) => (
                  <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="text-left">
                    <BookCover work={book.work} edition={book.editions[0]} size="md" />
                    <p className="mt-2 line-clamp-2 font-serif text-sm text-[var(--ink-ivory)]">{book.work.title}</p>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {isPickerOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="inkbound-panel relative w-full max-w-xl p-6 sm:p-7">
            <button type="button" onClick={() => setIsPickerOpen(false)} className="absolute right-4 top-4 text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]">
              <X className="h-5 w-5" />
            </button>

            <Sparkles className="h-7 w-7 text-[var(--ink-gold-bright)]" />
            <h2 className="mt-3 font-serif text-3xl text-[var(--ink-ivory)]">Choose My Next Read</h2>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">Tell Inkbound what kind of reading experience fits today.</p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-[var(--ink-text-secondary)]">
                Mood
                <select value={pickerMood} onChange={(event) => setPickerMood(event.target.value)} className="inkbound-select mt-2 w-full">
                  <option value="all">Any mood</option>
                  <option value="Cozy">Cozy</option>
                  <option value="Dark">Dark and atmospheric</option>
                  <option value="Fast-paced">Fast-paced</option>
                  <option value="Mind-bending">Mind-bending</option>
                  <option value="Emotional">Emotional</option>
                </select>
              </label>

              <label className="text-xs font-bold text-[var(--ink-text-secondary)]">
                Genre
                <select value={pickerGenre} onChange={(event) => setPickerGenre(event.target.value)} className="inkbound-select mt-2 w-full">
                  <option value="all">Any genre</option>
                  {genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
                </select>
              </label>

              <label className="text-xs font-bold text-[var(--ink-text-secondary)]">
                Format
                <select value={pickerFormat} onChange={(event) => setPickerFormat(event.target.value)} className="inkbound-select mt-2 w-full">
                  <option value="all">Any format</option>
                  <option value="hardcover">Hardcover</option>
                  <option value="paperback">Paperback</option>
                  <option value="ebook">Ebook</option>
                  <option value="audiobook">Audiobook</option>
                </select>
              </label>

              <label className="text-xs font-bold text-[var(--ink-text-secondary)]">
                Length
                <select value={pickerLength} onChange={(event) => setPickerLength(event.target.value)} className="inkbound-select mt-2 w-full">
                  <option value="all">Any length</option>
                  <option value="short">Under 300 pages</option>
                  <option value="medium">300–500 pages</option>
                  <option value="long">Over 500 pages</option>
                </select>
              </label>
            </div>

            <label className="mt-4 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
              <input type="checkbox" checked={pickerOwnedOnly} onChange={(event) => setPickerOwnedOnly(event.target.checked)} />
              Only choose from books I own
            </label>

            <div className="mt-6">
              {isSpinning ? (
                <div className="py-8 text-center">
                  <Shuffle className="mx-auto h-8 w-8 animate-spin text-[var(--ink-gold-bright)]" />
                  <p className="mt-3 font-serif italic text-[var(--ink-muted)]">Looking through your shelves…</p>
                </div>
              ) : recommendedBook ? (
                <div className="rounded-2xl border border-[var(--ink-border-strong)] bg-[var(--ink-surface-raised)] p-4">
                  <div className="flex gap-4">
                    <BookCover work={recommendedBook.work} edition={recommendedBook.editions[0]} size="md" />
                    <div className="min-w-0 flex-1">
                      <span className="inkbound-badge"><Check className="mr-1 h-3 w-3" />Your match</span>
                      <h3 className="mt-3 font-serif text-xl text-[var(--ink-ivory)]">{recommendedBook.work.title}</h3>
                      <p className="text-xs text-[var(--ink-muted)]">{recommendedBook.work.author}</p>
                      {recommendedBook.whyIAddedThis && (
                        <p className="mt-3 line-clamp-3 font-serif text-sm italic text-[var(--ink-gold)]">“{recommendedBook.whyIAddedThis}”</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button type="button" onClick={() => { onUpdateStatus(recommendedBook.id, 'currently-reading'); setIsPickerOpen(false); }} className="quiet-shelf-primary-action flex-1">
                      Start Reading
                    </button>
                    <button type="button" onClick={() => onSelectBook(recommendedBook)} className="quiet-shelf-secondary-action px-4">
                      Details <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={handleChooseNextRead} className="quiet-shelf-primary-action w-full min-h-12">
                  <Shuffle className="h-4 w-4" />
                  Find My Next Book
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};