import React from 'react';
import { Play } from 'lucide-react';
import { Priority, UserBookRecord } from '../../types';
import { ResponsiveGrid } from '../../layout/responsive';
import { BookCover } from '../BookCover';

interface TBRBookGridProps {
  books: UserBookRecord[];
  onSelectBook: (book: UserBookRecord) => void;
  onStartReading: (bookId: string) => void;
  onUpdatePriority: (bookId: string, priority: Priority) => void;
}

const priorityLabels: Record<Priority, string> = {
  top: 'Read Next',
  high: 'High Priority',
  medium: 'Someday Soon',
  low: 'Back Shelf',
};

export function TBRBookGrid({
  books,
  onSelectBook,
  onStartReading,
  onUpdatePriority,
}: TBRBookGridProps) {
  return (
    <ResponsiveGrid minItemWidth={280} maxColumns={4} gap={20} alignItems="stretch">
      {books.map((book) => {
        const edition =
          book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];

        return (
          <article
            key={book.id}
            className="inkbound-panel flex min-h-[300px] gap-4 p-4 transition hover:-translate-y-0.5 hover:border-[var(--ink-border-strong)]"
          >
            <button
              type="button"
              onClick={() => onSelectBook(book)}
              className="shrink-0 text-left"
            >
              <BookCover work={book.work} edition={edition} size="md" />
            </button>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-2">
                <span className="inkbound-badge">{priorityLabels[book.priority]}</span>
                <select
                  aria-label={`Priority for ${book.work.title}`}
                  value={book.priority}
                  onChange={(event) =>
                    onUpdatePriority(book.id, event.target.value as Priority)
                  }
                  className="inkbound-select min-h-8 w-auto px-2 py-1 text-[11px]"
                >
                  <option value="top">Read Next</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => onSelectBook(book)}
                className="mt-3 text-left"
              >
                <h2 className="line-clamp-2 font-serif text-xl leading-tight text-[var(--ink-ivory)] hover:text-[var(--ink-gold-bright)]">
                  {book.work.title}
                </h2>
                <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">
                  {book.work.author}
                </p>
              </button>

              <div className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-bg)] p-3">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[var(--ink-gold)]">
                  Why I added this
                </p>
                <p className="mt-1 line-clamp-3 font-serif text-sm italic leading-relaxed text-[var(--ink-text-secondary)]">
                  {book.whyIAddedThis || 'No reason saved yet. Open the book to add one.'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onStartReading(book.id)}
                className="mt-auto flex min-h-9 items-center justify-center gap-2 pt-4 text-xs font-bold text-[var(--ink-gold-bright)]"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Start Reading
              </button>
            </div>
          </article>
        );
      })}
    </ResponsiveGrid>
  );
}
