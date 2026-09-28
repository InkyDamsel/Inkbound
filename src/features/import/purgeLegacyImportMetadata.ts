import type { UserBookRecord } from '../../types';
import { getRuntimeStorage, writeRuntimeJson, writeRuntimeValue } from '../../platform/runtimeStorage';
import { IMPORT_STORAGE_KEYS, LEGACY_SYNC_STORAGE_KEYS, SYNC_STORAGE_KEYS } from '../sync/storageKeys';

const BOOKS_STORAGE_KEY = SYNC_STORAGE_KEYS.books;
const LEGACY_BOOKS_STORAGE_KEY = LEGACY_SYNC_STORAGE_KEYS.books;
const PURGE_VERSION_KEY = IMPORT_STORAGE_KEYS.legacyMetadataPurge;
const runtimeStorage = () => getRuntimeStorage();
const EXTERNAL_METADATA_SOURCES = new Set(['google-books', 'open-library', 'hardcover']);

function isImportedBook(book: UserBookRecord): boolean {
  return Boolean(
    book.sourceOfImport?.toLowerCase().includes('import') ||
    book.privateTags?.includes('imported') ||
    book.id.startsWith('book-import-'),
  );
}

function shouldPurgeLegacyMetadata(book: UserBookRecord): boolean {
  if (!isImportedBook(book) || book.importMetadataVerified === true) return false;
  const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
  return Boolean(activeEdition && EXTERNAL_METADATA_SOURCES.has(String(activeEdition.externalSource ?? '')));
}

function purgeBook(book: UserBookRecord): UserBookRecord {
  const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
  if (!activeEdition) return book;

  const cleanedActiveEdition = {
    id: activeEdition.id,
    format: activeEdition.format,
    isbn: activeEdition.isbn,
    isbn10: activeEdition.isbn10,
    isbn13: activeEdition.isbn13,
    coverGradient: activeEdition.coverGradient,
    externalSource: 'import' as const,
  };

  return {
    ...book,
    work: {
      ...book.work,
      subtitle: undefined,
      summary: 'Summary unavailable.',
      publisherSummary: undefined,
      genres: [],
      originalLanguage: undefined,
      externalWorkId: undefined,
    },
    editions: book.editions.map((edition) =>
      edition.id === book.activeEditionId ? cleanedActiveEdition : edition,
    ),
    sourceOfImport: 'Library import - awaiting verified metadata',
    importMetadataVerified: false,
    importMetadataReviewNeeded: false,
  };
}

export function purgeUnverifiedLegacyImportMetadata(): number {
  try {
    if (runtimeStorage().getItem(PURGE_VERSION_KEY) === 'done') return 0;

    const storageKey = runtimeStorage().getItem(BOOKS_STORAGE_KEY) !== null
      ? BOOKS_STORAGE_KEY
      : LEGACY_BOOKS_STORAGE_KEY;
    const raw = runtimeStorage().getItem(storageKey);
    if (!raw) {
      writeRuntimeValue(PURGE_VERSION_KEY, 'done');
      return 0;
    }

    const books = JSON.parse(raw) as UserBookRecord[];
    let purgedCount = 0;
    const cleaned = books.map((book) => {
      if (!shouldPurgeLegacyMetadata(book)) return book;
      purgedCount += 1;
      return purgeBook(book);
    });

    if (purgedCount > 0) {
      writeRuntimeJson(BOOKS_STORAGE_KEY, cleaned);
      runtimeStorage().removeItem(LEGACY_BOOKS_STORAGE_KEY);
    }
    writeRuntimeValue(PURGE_VERSION_KEY, 'done');
    return purgedCount;
  } catch (error) {
    console.warn('Inkbound could not purge legacy imported metadata safely.', error);
    return 0;
  }
}
