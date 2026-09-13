import type {
  Format,
  OwnershipStatus,
  Priority,
  ReadingMaterialType,
  ReadingStatus,
  SubscriptionService,
} from '../types';

export interface LibraryOption<T extends string> {
  value: T;
  label: string;
  pluralLabel?: string;
  description?: string;
}

// One canonical reader-assignable reading-status list. Every status picker must
// consume this list instead of defining its own subset. `wishlist` remains a
// compatibility-only ReadingStatus because Wishlist is now an ownership value;
// old imported/synced records are still valid and label correctly.
export const READING_STATUS_OPTIONS: LibraryOption<ReadingStatus>[] = [
  { value: 'currently-reading', label: 'Currently Reading', description: 'Put it into your active reading list.' },
  { value: 'tbr', label: 'To Be Read', description: 'Save it for later.' },
  { value: 'finished', label: 'Read', description: 'Mark it as already read.' },
  { value: 'paused', label: 'Paused', description: 'Keep your place without treating the title as finished.' },
  { value: 'dnf', label: 'Did Not Finish', description: 'Keep the title in your history without marking it read.' },
];

export const COMPATIBILITY_READING_STATUS_OPTIONS: LibraryOption<ReadingStatus>[] = [
  { value: 'wishlist', label: 'Wishlist', description: 'Compatibility value retained for older library records.' },
];

// Backward-compatible export name for code that only needs to recognize legacy
// persisted values. New selectors should use READING_STATUS_OPTIONS.
export const LEGACY_READING_STATUS_OPTIONS = COMPATIBILITY_READING_STATUS_OPTIONS;

export const ALL_READING_STATUS_OPTIONS: LibraryOption<ReadingStatus>[] = [
  ...READING_STATUS_OPTIONS,
  ...COMPATIBILITY_READING_STATUS_OPTIONS,
];

export const MATERIAL_TYPE_OPTIONS: LibraryOption<ReadingMaterialType>[] = [
  { value: 'book', label: 'Book', pluralLabel: 'Books' },
  { value: 'manga', label: 'Manga', pluralLabel: 'Manga' },
  { value: 'comic', label: 'Comic', pluralLabel: 'Comics' },
  { value: 'graphic-novel', label: 'Graphic Novel', pluralLabel: 'Graphic Novels' },
  { value: 'magazine', label: 'Magazine', pluralLabel: 'Magazines' },
  { value: 'light-novel', label: 'Light Novel', pluralLabel: 'Light Novels' },
  { value: 'novella', label: 'Novella', pluralLabel: 'Novellas' },
  { value: 'short-story', label: 'Short Story', pluralLabel: 'Short Stories' },
  { value: 'anthology', label: 'Anthology', pluralLabel: 'Anthologies' },
];

export const FORMAT_OPTIONS: LibraryOption<Format>[] = [
  { value: 'hardcover', label: 'Hardcover' },
  { value: 'paperback', label: 'Paperback' },
  { value: 'ebook', label: 'Ebook / Digital' },
  { value: 'audiobook', label: 'Audiobook' },
];

export const OWNERSHIP_OPTIONS: LibraryOption<OwnershipStatus>[] = [
  { value: 'owned', label: 'Owned' },
  { value: 'borrowed-library', label: 'Library loan' },
  { value: 'borrowed-person', label: 'Borrowed from someone' },
  { value: 'subscription', label: 'Subscription access' },
  { value: 'wishlist', label: 'Wishlist' },
  { value: 'custom', label: 'Custom', description: 'Use a reader-defined ownership category.' },
  { value: 'none', label: 'Not owned' },
];

export const PRIORITY_OPTIONS: LibraryOption<Priority>[] = [
  { value: 'top', label: 'Read Next' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export const SUBSCRIPTION_SERVICE_OPTIONS: LibraryOption<SubscriptionService>[] = [
  { value: 'kindle-unlimited', label: 'Kindle Unlimited' },
  { value: 'audible-plus', label: 'Audible Plus' },
  { value: 'everand', label: 'Everand' },
  { value: 'kobo-plus', label: 'Kobo Plus' },
  { value: 'libby', label: 'Libby' },
  { value: 'hoopla', label: 'Hoopla' },
  { value: 'other', label: 'Other' },
];

const labelFrom = <T extends string>(options: LibraryOption<T>[], value: T, plural = false) => {
  const option = options.find((candidate) => candidate.value === value);
  if (!option) return value;
  return plural ? option.pluralLabel ?? option.label : option.label;
};

export const readingStatusLabel = (value: ReadingStatus) => labelFrom(ALL_READING_STATUS_OPTIONS, value);
export const materialTypeLabel = (value: ReadingMaterialType, plural = false) => labelFrom(MATERIAL_TYPE_OPTIONS, value, plural);
export const formatLabel = (value: Format) => labelFrom(FORMAT_OPTIONS, value);
export const ownershipLabel = (value: OwnershipStatus) => labelFrom(OWNERSHIP_OPTIONS, value);
export const priorityLabel = (value: Priority) => labelFrom(PRIORITY_OPTIONS, value);
export const subscriptionServiceLabel = (value: SubscriptionService) => labelFrom(SUBSCRIPTION_SERVICE_OPTIONS, value);
