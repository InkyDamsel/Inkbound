import React from 'react';
import { UserBookRecord } from '../../types';
import { BookCover } from '../BookCover';
import { ResponsiveGrid } from '../../layout/responsive';

interface TBRGroupedBookGridProps {
  groups: Record<string, UserBookRecord[]>;
  onSelectBook: (book: UserBookRecord) => void;
}

export function TBRGroupedBookGrid({ groups, onSelectBook }: TBRGroupedBookGridProps) {
  return (
    <div className="space-y-5">
      {Object.entries(groups).map(([groupName, books]) => (
        <section key={groupName} className="inkbound-panel p-5">
          <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">{groupName}</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">{books.length} waiting</p>

          <ResponsiveGrid
            className="mt-5"
            minItemWidth={140}
            maxColumns={6}
            gap={16}
            alignItems="start"
          >
            {books.map((book) => {
              const edition =
                book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];

              return (
                <button
                  key={book.id}
                  type="button"
                  onClick={() => onSelectBook(book)}
                  className="min-w-0 text-left"
                >
                  <BookCover work={book.work} edition={edition} size="md" />
                  <p className="mt-2 line-clamp-2 font-serif text-sm text-[var(--ink-ivory)]">
                    {book.work.title}
                  </p>
                </button>
              );
            })}
          </ResponsiveGrid>
        </section>
      ))}
    </div>
  );
}
