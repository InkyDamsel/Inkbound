export type ImportFieldKey = 'title' | 'author' | 'isbn' | 'format' | 'status' | 'rating' | 'spiceLevel' | 'dateStarted' | 'dateRead' | 'dateAdded' | 'pageCount' | 'coverUrl' | 'review' | 'tags' | 'shelves' | 'collections' | 'seriesName' | 'seriesOrder' | 'seriesLabel' | 'seriesSource';

export const IMPORT_FIELD_OPTIONS: Array<{ key: ImportFieldKey; label: string; required?: boolean }> = [
  { key: 'title', label: 'Title', required: true },
  { key: 'author', label: 'Author' },
  { key: 'isbn', label: 'ISBN' },
  { key: 'format', label: 'Format' },
  { key: 'status', label: 'Reading Status' },
  { key: 'rating', label: 'Rating' },
  { key: 'spiceLevel', label: 'Spice Level' },
  { key: 'dateStarted', label: 'Started Date' },
  { key: 'dateRead', label: 'Finished Date' },
  { key: 'dateAdded', label: 'Date Added' },
  { key: 'pageCount', label: 'Page Count' },
  { key: 'coverUrl', label: 'Cover URL' },
  { key: 'review', label: 'Review / Notes' },
  { key: 'tags', label: 'Tags' },
  { key: 'shelves', label: 'Shelves / Lists / Folders' },
  { key: 'collections', label: 'Collections' },
  { key: 'seriesName', label: 'Series' },
  { key: 'seriesOrder', label: 'Series Number / Position' },
  { key: 'seriesLabel', label: 'Series Label' },
  { key: 'seriesSource', label: 'Series Source' },
];

export type ImportColumnMapping = Partial<Record<ImportFieldKey, string>>;

const aliases: Record<ImportFieldKey, string[]> = {
  title: ['title', 'book title', 'book', 'book name', 'name'],
  author: ['author', 'author name', 'authors', 'writer', 'book author'],
  isbn: ['isbn13', 'isbn 13', 'isbn_13', 'isbn-13', 'isbn', 'isbn10', 'isbn 10', 'isbn_10', 'isbn-10'],
  format: ['binding', 'format', 'media type', 'media_type', 'book format', 'book_format', 'edition format'],
  status: ['exclusive shelf', 'status', 'reading status', 'read status', 'read_status', 'shelf', 'bookshelf'],
  rating: ['my rating', 'rating', 'star rating', 'star_rating', 'stars', 'score'],
  spiceLevel: ['spice level', 'spice', 'heat level', 'heat', 'pepper rating', 'peppers'],
  dateStarted: ['date started', 'datestarted', 'started date', 'start date', 'date_started', 'started_at', 'reading started', 'date started reading'],
  dateRead: ['date read', 'dateread', 'date finished', 'finished date', 'date_finished', 'finished_at', 'completed date', 'date completed'],
  dateAdded: ['date added', 'dateadded', 'created_at', 'added_at', 'added date', 'imported date'],
  pageCount: ['page count', 'pagecount', 'pages', 'number of pages', 'num pages', 'num_pages', 'total pages', 'total_pages'],
  coverUrl: ['cover url', 'cover_url', 'cover image', 'cover image url', 'image url', 'image_url', 'book cover url', 'thumbnail url'],
  review: ['my review', 'review', 'notes', 'note', 'comments', 'comment', 'thoughts'],
  tags: ['tags', 'tag', 'labels', 'label', 'keywords'],
  shelves: ['bookshelves', 'book shelves', 'shelves', 'shelf names', 'lists', 'list names', 'folders', 'folder names', 'categories'],
  collections: ['collections', 'collection', 'book collections', 'custom collections'],
  seriesName: ['series', 'series name', 'series_name', 'series title', 'series_title'],
  seriesOrder: ['series number', 'series_number', 'series order', 'series_order', 'series position', 'series_position', 'volume number', 'book number'],
  seriesLabel: ['series label', 'series_label', 'volume label', 'position label'],
  seriesSource: ['series source', 'series_source', 'series provenance', 'series origin'],
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
