import type { FavoriteQuote, UserBookRecord } from '../../types';

export const createSavedQuote = (
  quote: string,
  pageOrChapter = '',
  note = '',
  id = `quote-${Date.now()}`,
): FavoriteQuote => ({
  id,
  quote: quote.trim(),
  ...(pageOrChapter.trim() ? { pageOrChapter: pageOrChapter.trim() } : {}),
  ...(note.trim() ? { note: note.trim() } : {}),
});

export const addSavedQuote = (book: UserBookRecord, quote: FavoriteQuote): UserBookRecord => ({
  ...book,
  favoriteQuotes: [...(book.favoriteQuotes ?? []), quote],
});

export const updateSavedQuote = (
  book: UserBookRecord,
  quoteId: string,
  changes: Partial<Omit<FavoriteQuote, 'id'>>,
): UserBookRecord => ({
  ...book,
  favoriteQuotes: (book.favoriteQuotes ?? []).map((quote) => {
    if (quote.id !== quoteId) return quote;
    const next: FavoriteQuote = {
      ...quote,
      ...changes,
      quote: changes.quote?.trim() ?? quote.quote,
    };
    if (!changes.pageOrChapter?.trim()) delete next.pageOrChapter;
    else next.pageOrChapter = changes.pageOrChapter.trim();
    if (!changes.note?.trim()) delete next.note;
    else next.note = changes.note.trim();
    return next;
  }),
});

export const deleteSavedQuote = (book: UserBookRecord, quoteId: string): UserBookRecord => ({
  ...book,
  favoriteQuotes: (book.favoriteQuotes ?? []).filter((quote) => quote.id !== quoteId),
});

export const setFavoriteSavedQuote = (book: UserBookRecord, quoteId: string): UserBookRecord => ({
  ...book,
  favoriteQuotes: (book.favoriteQuotes ?? []).map((quote) => ({
    ...quote,
    isFavorite: quote.id === quoteId,
  })),
});

export const getPreferredSavedQuote = (
  book?: UserBookRecord,
  selectedQuoteId?: string,
): FavoriteQuote | undefined => {
  const quotes = book?.favoriteQuotes ?? [];
  return quotes.find((quote) => quote.id === selectedQuoteId)
    ?? quotes.find((quote) => quote.isFavorite)
    ?? quotes[0];
};
