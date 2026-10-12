import type { UserBookRecord } from '../../types';

// Date-only imports remain valid historical dates. New additions store a
// separate precise timestamp so cloud reconciliation cannot reorder them.
const validMillis = (value: string | undefined): number | null => {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
};

export const recentBookSortMillis = (book: UserBookRecord): number => {
  const calendarMillis = validMillis(book.dateAdded) ?? 0;
  const explicit = validMillis(book.dateAddedAt);
  if (explicit !== null) return explicit;

  // Existing builds generated new book IDs with a millisecond timestamp but
  // only saved the calendar date. Recover their original addition order without
  // rewriting or fabricating any stored book metadata.
  const match = /^book-(\d{13})-[a-z0-9]+$/i.exec(book.id);
  if (match) {
    const fromId = Number(match[1]);
    const date = new Date(fromId);
    const localDay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (Number.isFinite(fromId) && localDay === book.dateAdded) return fromId;
  }
  return calendarMillis;
};

export const compareRecentlyAddedBooks = (a: UserBookRecord, b: UserBookRecord): number =>
  recentBookSortMillis(b) - recentBookSortMillis(a)
;
