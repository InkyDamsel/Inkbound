import React from 'react';
import { Star } from 'lucide-react';
import { UserBookRecord } from '../../types';
import { ResponsiveGrid } from '../../layout/responsive';
import { BookCover } from '../BookCover';

interface LibraryBookGridProps {
  books: UserBookRecord[];
  selectedBookIds: string[];
  onSelectBook: (book: UserBookRecord) => void;
  onToggleSelectBook: (id: string) => void;
}

export function LibraryBookGrid({
  books,
  selectedBookIds,
  onSelectBook,
  onToggleSelectBook,
}: LibraryBookGridProps) {
  return (
    <ResponsiveGrid minItemWidth={150} maxColumns={6} gap={16} alignItems="stretch">
      {books.map((book) => {
        const isSelected = selectedBookIds.includes(book.id);
        const activeEdition =
          book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];

        return (
          <article
            key={book.id}
            onClick={() => onSelectBook(book)}
            className={`group cursor-pointer rounded-2xl border p-3 transition duration-200 ${
              isSelected
                ? 'border-[#c5a059] bg-[#c5a059]/12 shadow-[0_16px_34px_rgba(0,0,0,.4)]'
                : 'border-white/5 bg-[#17101b] hover:-translate-y-1 hover:border-[#c5a059]/35 hover:bg-[#1d1422]'
            }`}
          >
            <div className="flex justify-center">
              <BookCover
                work={book.work}
                edition={activeEdition}
                size="md"
                progressPercentage={book.progressPercentage}
                rating={book.rating}
                isSelected={isSelected}
                onSelectToggle={() => onToggleSelectBook(book.id)}
              />
            </div>

            <div className="mt-4 min-w-0">
              <h3 className="line-clamp-2 font-serif text-base font-bold leading-tight text-[#f4efe6] transition group-hover:text-[#e2bd66]">
                {book.work.title}
              </h3>
              <p className="mt-1 truncate text-xs text-[#ad9fac]">{book.work.author}</p>

              <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
                <span className="rounded-full bg-[#24172a] px-2.5 py-1 capitalize text-[#cfc2cf]">
                  {book.status.replaceAll('-', ' ')}
                </span>
                {book.rating ? (
                  <span className="flex items-center gap-1 font-bold text-[#e2bd66]">
                    <Star className="h-3 w-3 fill-current" />
                    {book.rating.toFixed(1)}
                  </span>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </ResponsiveGrid>
  );
}
