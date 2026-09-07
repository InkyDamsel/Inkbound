import { getActiveEdition } from '../reading/bookReadingState';
import { resolveEffectiveSeriesMetadata } from '../series/seriesLibrary';
import type { SeriesOverrides } from '../series/seriesOverrides';
import { readCustomOwnershipCategories } from '../ownership/customOwnershipCategories';
import type { ReadingSession, UserBookRecord } from '../../types';

const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export interface InkboundExportPreferences {
  annualGoal: string;
  dailyGoalMins: string;
  theme: 'dark' | 'light';
}

export function buildInkboundBackup(
  books: UserBookRecord[],
  sessions: ReadingSession[],
  seriesOverrides: SeriesOverrides,
  preferences: InkboundExportPreferences,
) {
  const customOwnershipCategories = readCustomOwnershipCategories();
  return {
    schemaVersion: 3,
    app: 'Inkbound',
    exportDate: new Date().toISOString(),
    preferences,
    books,
    sessions,
    ownershipOrganization: {
      customCategories: customOwnershipCategories,
    },
    seriesOrganization: {
      overrides: seriesOverrides,
      effectiveByBook: Object.fromEntries(books.map((book) => {
        const series = resolveEffectiveSeriesMetadata(book, seriesOverrides);
        return [book.id, series
          ? { name: series.name, number: series.position, label: series.label, source: series.source }
          : { name: '', number: null, label: '', source: 'none' as const }];
      })),
    },
  };
}

export function buildLibraryCsv(books: UserBookRecord[], seriesOverrides: SeriesOverrides): string {
  const customOwnershipCategories = readCustomOwnershipCategories();
  const ownershipNameById = new Map(customOwnershipCategories.map((category) => [category.id, category.name]));
  const headers = [
    'Title', 'Subtitle', 'Author', 'Reading Material Type', 'Series', 'Series Number', 'Series Label', 'Series Source',
    'Status', 'Ownership', 'Custom Ownership Category', 'Subscription Service', 'Borrowed Date', 'Library Due Date', 'Finish By Date', 'Rating', 'Format', 'ISBN', 'Page Count',
    'Pages Read', 'Minutes Listened', 'Progress Percent', 'Date Added', 'Date Started', 'Date Finished', 'Tags', 'Collections',
  ];

  const rows = books.map((book) => {
    const activeEdition = getActiveEdition(book);
    const series = resolveEffectiveSeriesMetadata(book, seriesOverrides);
    return [
      book.work.title,
      book.work.subtitle,
      book.work.author,
      book.work.materialType ?? 'book',
      series?.name ?? '',
      series?.position ?? null,
      series?.label ?? '',
      series?.source ?? 'none',
      book.status,
      book.ownership,
      book.ownership === 'custom' ? ownershipNameById.get(book.customOwnershipCategoryId ?? '') ?? '' : '',
      book.subscriptionService,
      book.libraryLoan?.borrowedDate,
      book.libraryLoan?.dueDate,
      book.finishByDate,
      book.rating,
      activeEdition?.format,
      activeEdition?.isbn13 ?? activeEdition?.isbn10 ?? activeEdition?.isbn,
      activeEdition?.pageCount,
      book.progressPages,
      book.progressMinutes,
      book.progressPercentage,
      book.dateAdded,
      book.dateStarted,
      book.dateFinished,
      book.privateTags.join(' | '),
      book.collections.join(' | '),
    ].map(csvCell);
  });

  return `\uFEFF${[headers.map(csvCell).join(','), ...rows.map((row) => row.join(','))].join('\n')}`;
}
