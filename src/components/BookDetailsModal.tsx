import React, { useEffect, useMemo } from 'react';
import { BookDetailsModal as BookDetailsModalCore } from './BookDetailsModalCore';
import { CatalogContributionLauncher } from './catalog/CatalogContributionLauncher';
import type { Edition, UserBookRecord } from '../types';

function normalizeStoredIsbn(value?: string): string | undefined {
  if (!value) return value;
  const trimmed = value.trim();
  const spreadsheetWrapped = trimmed.match(/^=\s*["']([^"']+)["']$/);
  const candidate = spreadsheetWrapped?.[1] ?? trimmed;
  const normalized = candidate.replace(/[^0-9X]/gi, '').toUpperCase();
  return normalized || undefined;
}

function normalizeEditionIdentifiers(edition: Edition): Edition {
  const isbn = normalizeStoredIsbn(edition.isbn);
  const isbn10 = normalizeStoredIsbn(edition.isbn10);
  const isbn13 = normalizeStoredIsbn(edition.isbn13);
  return {
    ...edition,
    isbn,
    isbn10,
    isbn13,
  };
}

function normalizeBookIdentifiers(book: UserBookRecord): UserBookRecord {
  return {
    ...book,
    editions: book.editions.map(normalizeEditionIdentifiers),
  };
}

export const BookDetailsModal: React.FC<React.ComponentProps<typeof BookDetailsModalCore>> = (props) => {
  const normalizedBook = useMemo(
    () => props.book ? normalizeBookIdentifiers(props.book) : null,
    [props.book],
  );

  useEffect(() => {
    if (!props.book || !normalizedBook) return;
    const before = props.book.editions.map((edition) => [edition.isbn, edition.isbn10, edition.isbn13]);
    const after = normalizedBook.editions.map((edition) => [edition.isbn, edition.isbn10, edition.isbn13]);
    if (JSON.stringify(before) !== JSON.stringify(after)) props.onUpdateBook(normalizedBook);
  }, [normalizedBook, props.book, props.onUpdateBook]);

  return (
    <>
      <BookDetailsModalCore {...props} book={normalizedBook} />
      {normalizedBook && <CatalogContributionLauncher book={normalizedBook} onUpdateBook={props.onUpdateBook} />}
    </>
  );
};
