export type UserPlan = 'free' | 'premium';

export interface UserPlanState {
  plan: UserPlan;
  freeBookLimit: number;
}

export type Format = 'hardcover' | 'paperback' | 'ebook' | 'audiobook' | 'unknown';

export type ReadingMaterialType =
  | 'book'
  | 'manga'
  | 'comic'
  | 'graphic-novel'
  | 'magazine'
  | 'light-novel'
  | 'novella'
  | 'short-story'
  | 'anthology';

// `custom` is an internal compatibility value for reader-defined categories.
// The only built-in statuses offered to readers are Currently Reading, TBR, and Read.
// Legacy paused/dnf/wishlist values remain valid so existing libraries are never rewritten.
export type ReadingStatus = 'currently-reading' | 'tbr' | 'finished' | 'custom' | 'paused' | 'dnf' | 'wishlist';

export type OwnershipStatus = 'owned' | 'borrowed-library' | 'borrowed-person' | 'subscription' | 'wishlist' | 'custom' | 'none';

export type SubscriptionService = 'kindle-unlimited' | 'audible-plus' | 'everand' | 'kobo-plus' | 'libby' | 'hoopla' | 'other';

export type Priority = 'top' | 'high' | 'medium' | 'low';

export type EditionSource = 'google-books' | 'open-library' | 'hardcover' | 'inkbound-catalog' | 'crossref' | 'library-of-congress' | 'internet-archive' | 'manual' | 'import';

export interface BookWork {
  id: string;
  title: string;
  subtitle?: string;
  author: string;
  summary: string;
  publisherSummary?: string;
  personalSummary?: string;
  materialType?: ReadingMaterialType;
  seriesName?: string;
  seriesOrder?: number;
  genres: string[];
  tropes?: string[];
  contentWarnings?: string[];
  publicationYear: number;
  originalLanguage?: string;
  externalWorkId?: string;
}

export interface Edition {
  id: string;
  format: Format;
  isbn?: string;
  isbn10?: string;
  isbn13?: string;
  asin?: string;
  lccn?: string;
  pageCount?: number;
  audiobookDurationMins?: number;
  narrator?: string;
  publisher?: string;
  publicationDate?: string;
  coverGradient: string;
  coverIcon?: string;
  coverUrl?: string;
  language?: string;
  editionName?: string;
  binding?: string;
  specialFeatures?: string[];
  externalSource?: EditionSource;
  externalEditionId?: string;
}

export interface FavoriteQuote {
  id: string;
  quote: string;
  pageOrChapter?: string;
  note?: string;
}

export interface LibraryLoan {
  borrowedDate?: string;
  dueDate?: string;
}

export interface UserBookRecord {
  id: string;
  work: BookWork;
  activeEditionId: string;
  editions: Edition[];
  status: ReadingStatus;
  ownership: OwnershipStatus;
  // Kept under the existing field name for backward compatibility with synced data.
  // It now identifies a reader-defined library category independently of ownership.
  customOwnershipCategoryId?: string;
  subscriptionService?: SubscriptionService;
  libraryLoan?: LibraryLoan;
  finishByDate?: string;
  progressPages: number;
  progressMinutes: number;
  progressPercentage: number;
  rating?: number;
  review?: string;
  personalNotes?: string;
  favoriteQuotes?: FavoriteQuote[];
  privateTags: string[];
  priority: Priority;
  moods: string[];
  collections: string[];
  whyIAddedThis?: string;
  sourceOfImport?: string;
  // Import metadata is disposable. These flags let the enrichment manager
  // distinguish verified matches from legacy guesses that need review.
  importMetadataVerified?: boolean;
  importMetadataReviewNeeded?: boolean;
  // True only when the source export explicitly supplied a finished/read date.
  // False means the book was imported as finished without a trustworthy historical date.
  importFinishedDateProvided?: boolean;
  dateAdded: string;
  dateStarted?: string;
  dateFinished?: string;
  lastSessionDate?: string;
  rereadCount?: number;
}

export interface ReadingSession {
  id: string;
  bookId: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  startPage?: number;
  endPage?: number;
  pagesRead?: number;
  startTimestampSec?: number;
  endTimestampSec?: number;
  minutesListened?: number;
  listeningSpeed?: number;
  notes?: string;
  mood?: string;
  location?: string;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  color: string;
  iconName?: string;
}

export interface ImportSourceInfo {
  id: string;
  name: string;
  description: string;
  badge: string;
  method: 'CSV File' | 'JSON File' | 'CSV / JSON' | 'CSV/JSON File' | 'CSV / XLSX / JSON' | 'Direct Sync' | 'Export File';
  supported: boolean;
}

export interface ImportRecordItem {
  id: string;
  title: string;
  author: string;
  isbn?: string;
  format: Format;
  status: ReadingStatus;
  rating?: number;
  dateStarted?: string;
  dateRead?: string;
  dateAdded: string;
  pageCount?: number;
  coverUrl?: string;
  review?: string;
  tags?: string[];
  sourceShelves?: string[];
  sourceCollections?: string[];
  importShelvesAsCollections?: boolean;
  seriesName?: string;
  seriesOrder?: number;
  seriesLabel?: string;
  seriesSource?: string;
  matchedBookId?: string;
  matchTitle?: string;
  matchAuthor?: string;
  confidence: number;
  duplicateAction: 'skip' | 'merge' | 'keep_both' | 'replace';
  coverGradient: string;
  // Verification is determined before the selected records are written into the
  // library. Carrying it with the import record keeps Import Center and Import
  // History on the same accounting source instead of recomputing different totals.
  importMetadataVerified?: boolean;
}