export type ImportFieldKey = 'title' | 'author' | 'isbn' | 'format' | 'status' | 'rating' | 'dateRead' | 'dateAdded' | 'review';

export const IMPORT_FIELD_OPTIONS: Array<{ key: ImportFieldKey; label: string; required?: boolean }> = [
  { key: 'title', label: 'Title', required: true },
  { key: 'author', label: 'Author' },
  { key: 'isbn', label: 'ISBN' },
  { key: 'format', label: 'Format' },
  { key: 'status', label: 'Reading Status' },
  { key: 'rating', label: 'Rating' },
  { key: 'dateRead', label: 'Finished Date' },
  { key: 'dateAdded', label: 'Date Added' },
  { key: 'review', label: 'Review / Notes' },
];

export type ImportColumnMapping = Partial<Record<ImportFieldKey, string>>;

const aliases: Record<ImportFieldKey, string[]> = {
  title: ['title', 'book title', 'book', 'book name', 'name'],
  author: ['author', 'author name', 'authors', 'writer', 'book author'],
  isbn: ['isbn13', 'isbn 13', 'isbn_13', 'isbn-13', 'isbn', 'isbn10', 'isbn 10', 'isbn_10', 'isbn-10'],
  format: ['binding', 'format', 'media type', 'media_type', 'book format', 'book_format', 'edition format'],
  status: ['exclusive shelf', 'status', 'reading status', 'read status', 'read_status', 'shelf', 'bookshelf'],
  rating: ['my rating', 'rating', 'star rating', 'star_rating', 'stars', 'score'],
  dateRead: ['date read', 'dateread', 'date finished', 'finished date', 'date_finished', 'finished_at', 'completed date', 'date completed'],
  dateAdded: ['date added', 'dateadded', 'created_at', 'added_at', 'added date', 'imported date'],
  review: ['my review', 'review', 'notes', 'note', 'comments', 'comment', 'thoughts'],
};

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
}

export function detectImportColumnMapping(headers: string[]): ImportColumnMapping {
  const result: ImportColumnMapping = {};
  for (const option of IMPORT_FIELD_OPTIONS) {
    const match = headers.find((header) => aliases[option.key].some((alias) => normalized(header) === normalized(alias)));
    if (match) result[option.key] = match;
  }
  return result;
}

export function mappedValue(record: Record<string, unknown>, mapping: ImportColumnMapping, key: ImportFieldKey): string {
  const header = mapping[key];
  if (!header) return '';
  const value = record[header];
  return value === undefined || value === null ? '' : String(value).trim();
}
