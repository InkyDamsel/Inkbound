export type UserPlan = 'free' | 'premium';

export interface UserPlanState {
  plan: UserPlan;
  freeBookLimit: number;
}

export type Format = 'hardcover' | 'paperback' | 'ebook' | 'audiobook';

export type ReadingStatus = 'currently-reading' | 'tbr' | 'finished' | 'paused' | 'dnf' | 'wishlist';

export type OwnershipStatus = 'owned' | 'borrowed-library' | 'borrowed-person' | 'subscription' | 'wishlist' | 'none';

export type SubscriptionService = 'kindle-unlimited' | 'audible-plus' | 'everand' | 'kobo-plus' | 'libby' | 'hoopla' | 'other';

export type Priority = 'top' | 'high' | 'medium' | 'low';

export interface BookWork {
  id: string;
  title: string;
  subtitle?: string;
  author: string;
  summary: string;
  publisherSummary?: string;
  personalSummary?: string;
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
  externalSource?: string;
  externalEditionId?: string;
}

export interface FavoriteQuote {
  id: string;
  quote: string;
  pageOrChapter?: string;
  note?: string;
}

export interface UserBookRecord {
  id: string;
  work: BookWork;
  activeEditionId: string;
  editions: Edition[];
  status: ReadingStatus;
  ownership: OwnershipStatus;
  subscriptionService?: SubscriptionService;
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
  importMetadataVerified?: boolean;
  importMetadataReviewNeeded?: boolean;
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
  method: 'CSV File' | 'JSON File' | 'CSV / JSON' | 'CSV/JSON File' | 'Direct Sync' | 'Export File';
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
  dateRead?: string;
  dateAdded: string;
  review?: string;
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