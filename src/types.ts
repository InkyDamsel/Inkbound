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

export type EditionSource = 'google-books' | 'open-library' | 'hardcover' | 'inkbound-catalog' | 'manual' | 'import';

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
  asin?: string;
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
  // Import metadata is disposable. These flags let the enrichment manager
  // distinguish verified matches from legacy guesses that need review.
  importMetadataVerified?: boolean;
  importMetadataReviewNeeded?: boolean;
  dateAdded: string;
  dateStarted?: string;
  dateFinished?: string;
}
