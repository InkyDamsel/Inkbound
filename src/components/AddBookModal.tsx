import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { ArrowLeft, BookOpen, Camera, Check, Loader2, ScanLine, Search, Trash2, UserRound, X } from 'lucide-react';
import {
  FORMAT_OPTIONS,
  MATERIAL_TYPE_OPTIONS,
  OWNERSHIP_OPTIONS,
  PRIORITY_OPTIONS,
  READING_STATUS_OPTIONS,
} from '../domain/libraryTaxonomy';
import {
  resolveCatalogIsbn,
  searchGoogleBooks,
  searchGoogleBooksAuthorPage,
} from '../features/book-search/data/googleBooksApi';
import { createBookFromSearchEdition } from '../features/book-search/mapping/bookSearchMapper';
import { isValidCatalogIsbn, selectCatalogIsbnFromBarcodes } from '../features/book-search/isbnResolution';
import { auth } from '../lib/firebase';
import type { BookSearchEdition, BookSearchWorkGroup } from '../features/book-search/model/bookSearch';
import {
  CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT,
  createCustomOwnershipCategory,
  readCustomOwnershipCategories,
  type CustomOwnershipCategory,
} from '../features/ownership/customOwnershipCategories';
import { withReadingStatus } from '../features/reading/bookReadingState';
import {
  CUSTOM_READING_STATUSES_CHANGED_EVENT,
  createCustomReadingStatus,
  readCustomReadingStatuses,
  type CustomReadingStatus,
  withCustomReadingStatus,
} from '../features/reading/customReadingStatuses';
import type { Format, OwnershipStatus, Priority, ReadingMaterialType, ReadingStatus, UserBookRecord } from '../types';
import { playScannerSuccessFeedbackOnNativeAndroid, recognizeBookCover, scanBarcodeWithNativeRuntime, shouldUseNativeBarcodeScanner } from '../platform/runtimeBarcodeScanner';
import { flushLargeBrowserStorage } from '../platform/largeBrowserStorage';

interface AddBookModalProps {
  currentBookCount: number;
  onClose: () => void;
  onAddBook: (newBook: UserBookRecord) => void;
  onAddMultipleBooks?: (newBooks: UserBookRecord[]) => boolean;
  onRemoveBook?: (book: UserBookRecord) => void;
}

type AddBookTab = 'search' | 'scan' | 'manual';
type PendingSearchEdition = { work: BookSearchWorkGroup; edition: BookSearchEdition };
type CustomReadingStatusSelection = `custom:${string}`;
type ReadingStatusSelection = Exclude<ReadingStatus, 'custom' | 'wishlist'> | CustomReadingStatusSelection;
type CustomOwnershipSelection = `custom:${string}`;
type OwnershipSelection = Exclude<OwnershipStatus, 'custom'> | CustomOwnershipSelection;
type ScannedBook = { isbn: string; book: UserBookRecord };

const hasIdentifiedBook = (book: UserBookRecord): boolean => {
  const title = book.work?.title?.trim() ?? '';
  const author = book.work?.author?.trim() ?? '';
  return Boolean(title && author && normalizeAuthorName(author) !== 'unknown author'
    && !author.split(',').every((name) => normalizeAuthorName(name) === 'unknown author'));
};

const scannerDraftKey = () => `inkbound:scanner-draft:v1:${auth?.currentUser?.uid ?? 'signed-out'}`;
const readScannerDraft = (): ScannedBook[] => {
  try {
    const stored = window.localStorage.getItem(scannerDraftKey());
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ScannedBook =>
      !!item && typeof item === 'object' && typeof item.isbn === 'string'
      && !!item.book && typeof item.book.id === 'string' && !!item.book.work
      && Array.isArray(item.book.editions) && hasIdentifiedBook(item.book));
  } catch {
    return [];
  }
};
const writeScannerDraft = (books: ScannedBook[]): boolean => {
  try {
    if (books.length) window.localStorage.setItem(scannerDraftKey(), JSON.stringify(books));
    else window.localStorage.removeItem(scannerDraftKey());
    return true;
  } catch {
    return false;
  }
};

type AuthorPageState = {
  name: string;
  previousQuery: string;
  previousResults: BookSearchWorkGroup[];
  previousHasSearched: boolean;
};

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement | HTMLImageElement): Promise<Array<{ rawValue?: string }>>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const ADD_TO_LIST_OPTIONS = READING_STATUS_OPTIONS.filter((option) => option.value !== 'custom') as Array<{ value: Exclude<ReadingStatus, 'custom' | 'wishlist'>; label: string; description?: string }>;
const AUTHOR_CATALOG_PAGE_SIZE = 12;
const builtInStatusLabel = (value: ReadingStatus) => READING_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
const isCustomReadingStatusSelection = (selection: ReadingStatusSelection): selection is CustomReadingStatusSelection =>
  selection.startsWith('custom:');
const BUILT_IN_OWNERSHIP_OPTIONS = OWNERSHIP_OPTIONS.filter((option) => option.value !== 'custom');
const normalizeAuthorName = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normalizeCatalogText = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const looksLikeAuthorNameQuery = (value: string) => {
  const normalized = normalizeAuthorName(value);
  const words = normalized.split(' ').filter(Boolean);
  return words.length >= 2 && words.length <= 6 && !/\d/.test(normalized);
};

const filterExactAuthorResults = (groups: BookSearchWorkGroup[], authorName: string) => {
  const normalizedAuthor = normalizeAuthorName(authorName);
  return groups.filter((work) =>
    work.authors.some((candidate) => normalizeAuthorName(candidate) === normalizedAuthor),
  );
};

const editionIsbnValues = (edition: BookSearchEdition) =>
  [edition.isbn13, edition.isbn10]
    .map((value) => value?.replace(/[^0-9Xx]/g, '').toUpperCase() ?? '')
    .filter(Boolean);

const sameCatalogEdition = (left: BookSearchEdition, right: BookSearchEdition) => {
  if (left.source === right.source && left.externalEditionId === right.externalEditionId) return true;
  const leftIsbns = editionIsbnValues(left);
  const rightIsbns = new Set(editionIsbnValues(right));
  return leftIsbns.some((isbn) => rightIsbns.has(isbn));
};

const mergeCatalogResultGroups = (
  current: BookSearchWorkGroup[],
  incoming: BookSearchWorkGroup[],
): BookSearchWorkGroup[] => {
  const merged = current.map((group) => ({
    ...group,
    genres: [...group.genres],
    editions: [...group.editions],
  }));
  const byIdentity = new Map<string, BookSearchWorkGroup>();

  merged.forEach((group) => {
    byIdentity.set(
      `${normalizeCatalogText(group.title)}::${normalizeAuthorName(group.authors[0] ?? '')}`,
      group,
    );
  });

  incoming.forEach((group) => {
    const identity = `${normalizeCatalogText(group.title)}::${normalizeAuthorName(group.authors[0] ?? '')}`;
    const existing = byIdentity.get(identity);
    if (!existing) {
      const added = { ...group, genres: [...group.genres], editions: [...group.editions] };
      merged.push(added);
      byIdentity.set(identity, added);
      return;
    }

    group.editions.forEach((edition) => {
      if (!existing.editions.some((candidate) => sameCatalogEdition(candidate, edition))) {
        existing.editions.push(edition);
      }
    });
    existing.genres = [...new Set([...existing.genres, ...group.genres])].slice(0, 16);
    if (!existing.publisherSummary && group.publisherSummary) {
      existing.publisherSummary = group.publisherSummary;
    }
  });

  return merged;
};
const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
const uniqueId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const isCustomOwnershipSelection = (selection: OwnershipSelection): selection is CustomOwnershipSelection => selection.startsWith('custom:');

export const AddBookModal: React.FC<AddBookModalProps> = ({ onClose, onAddBook, onAddMultipleBooks, onRemoveBook }) => {
  const [activeTab, setActiveTab] = useState<AddBookTab>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookSearchWorkGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [pendingSearchEdition, setPendingSearchEdition] = useState<PendingSearchEdition | null>(null);
  const [addedSearchBooks, setAddedSearchBooks] = useState<Map<string, UserBookRecord>>(() => new Map());
  const [authorPage, setAuthorPage] = useState<AuthorPageState | null>(null);
  const [authorNextStartIndex, setAuthorNextStartIndex] = useState(0);
  const [authorProviderTotal, setAuthorProviderTotal] = useState<number | null>(null);
  const [authorHasMore, setAuthorHasMore] = useState(false);
  const [isLoadingAuthorMore, setIsLoadingAuthorMore] = useState(false);
  const [authorCatalogPage, setAuthorCatalogPage] = useState(1);
  const [customOwnershipCategories, setCustomOwnershipCategories] = useState<CustomOwnershipCategory[]>(() => readCustomOwnershipCategories());
  const [customReadingStatuses, setCustomReadingStatuses] = useState<CustomReadingStatus[]>(() => readCustomReadingStatuses());
  const [creatingCustomReadingStatus, setCreatingCustomReadingStatus] = useState(false);
  const [newCustomReadingStatusName, setNewCustomReadingStatusName] = useState('');
  const [creatingCustomOwnership, setCreatingCustomOwnership] = useState(false);
  const [newCustomOwnershipName, setNewCustomOwnershipName] = useState('');

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [summary, setSummary] = useState('');
  const [genres, setGenres] = useState('');
  const [pageCount, setPageCount] = useState('');
  const [format, setFormat] = useState<Format>('hardcover');
  const [materialType, setMaterialType] = useState<ReadingMaterialType>('book');
  const [statusSelection, setStatusSelection] = useState<ReadingStatusSelection>('tbr');
  const [ownershipSelection, setOwnershipSelection] = useState<OwnershipSelection>('owned');
  const [priority, setPriority] = useState<Priority>('medium');

  const [scannedBooks, setScannedBooks] = useState<ScannedBook[]>(readScannerDraft);
  const [scannerReviewPage, setScannerReviewPage] = useState(1);
  const scannerReviewPageSize = 8;
  const scannerReviewPageCount = Math.max(1, Math.ceil(scannedBooks.length / scannerReviewPageSize));
  const safeScannerReviewPage = Math.min(scannerReviewPage, scannerReviewPageCount);
  const [scannerCategory, setScannerCategory] = useState<ReadingStatusSelection>('tbr');
  const [manualIsbn, setManualIsbn] = useState('');
  const [unresolvedIsbn, setUnresolvedIsbn] = useState<string | null>(null);
  const [scannerRecoveryTitle, setScannerRecoveryTitle] = useState('');
  const [scannerRecoveryAuthor, setScannerRecoveryAuthor] = useState('');
  const [scannerEditionOptions, setScannerEditionOptions] = useState<BookSearchWorkGroup[]>([]);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const webScannerReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const webScannerControlsRef = useRef<{ stop(): void } | null>(null);
  const webScanHandledRef = useRef(false);
  const webScannerStartingRef = useRef(false);
  const webScannerControlsPendingRef = useRef(false);
  const scannerAudioContextRef = useRef<AudioContext | null>(null);
  const scannerPhotoVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerPhotoStreamRef = useRef<MediaStream | null>(null);
  const [scannerPhotoCameraOpen, setScannerPhotoCameraOpen] = useState(false);
  const [scannerPhotoBusy, setScannerPhotoBusy] = useState(false);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);
  const [photoIsbnChoices, setPhotoIsbnChoices] = useState<string[]>([]);

  useEffect(() => {
    if (!writeScannerDraft(scannedBooks)) {
      setScannerError('Could not protect this scan batch on this device. Keep this screen open until saved.');
    }
  }, [scannedBooks]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pendingSearchEdition) {
        setPendingSearchEdition(null);
        return;
      }
      if (authorPage) {
        setQuery(authorPage.previousQuery);
        setResults(authorPage.previousResults);
        setHasSearched(authorPage.previousHasSearched);
        setSearchError(null);
        setAuthorPage(null);
        setAuthorNextStartIndex(0);
        setAuthorProviderTotal(null);
        setAuthorHasMore(false);
        setIsLoadingAuthorMore(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pendingSearchEdition, authorPage]);

  useEffect(() => {
    const refresh = () => setCustomOwnershipCategories(readCustomOwnershipCategories());
    window.addEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    const refreshReadingStatuses = () => setCustomReadingStatuses(readCustomReadingStatuses());
    window.addEventListener(CUSTOM_READING_STATUSES_CHANGED_EVENT, refreshReadingStatuses);
    return () => window.removeEventListener(CUSTOM_READING_STATUSES_CHANGED_EVENT, refreshReadingStatuses);
  }, []);

  useEffect(() => () => {
    if (scanLoopRef.current !== null) cancelAnimationFrame(scanLoopRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void scannerAudioContextRef.current?.close();
    scannerAudioContextRef.current = null;
  }, []);

  const readingStatusSelectionLabel = (selection: ReadingStatusSelection) => {
    if (isCustomReadingStatusSelection(selection)) {
      const id = selection.slice('custom:'.length);
      return customReadingStatuses.find((status) => status.id === id)?.name ?? 'Custom';
    }
    return builtInStatusLabel(selection);
  };

  const applyReadingStatusSelection = (book: UserBookRecord, selection: ReadingStatusSelection, date?: string) => {
    if (isCustomReadingStatusSelection(selection)) {
      return withCustomReadingStatus(book, selection.slice('custom:'.length));
    }
    return withReadingStatus(book, selection, date);
  };

  const createAndSelectCustomReadingStatus = (
    assign: (selection: ReadingStatusSelection) => void,
  ) => {
    const customStatus = createCustomReadingStatus(newCustomReadingStatusName);
    if (!customStatus) return;
    setCustomReadingStatuses(readCustomReadingStatuses());
    setNewCustomReadingStatusName('');
    setCreatingCustomReadingStatus(false);
    assign(`custom:${customStatus.id}`);
  };

  const createAndSelectCustomOwnership = () => {
    const created = createCustomOwnershipCategory(newCustomOwnershipName);
    if (!created) return;
    setCustomOwnershipCategories(readCustomOwnershipCategories());
    setOwnershipSelection(`custom:${created.id}`);
    setNewCustomOwnershipName('');
    setCreatingCustomOwnership(false);
  };

  const normalizeIsbn = (value: string) => value.replace(/[^0-9Xx]/g, '').toUpperCase();

  const stopCamera = () => {
    webScannerStartingRef.current = false;
    webScannerControlsPendingRef.current = false;
    webScannerControlsRef.current?.stop();
    webScannerControlsRef.current = null;
    webScannerReaderRef.current = null;
    if (scanLoopRef.current !== null) cancelAnimationFrame(scanLoopRef.current);
    scanLoopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  // Mobile WebViews require audio to be unlocked during a user gesture, before
  // asynchronous barcode detection/catalog lookup completes.
  const primeScannerAudio = () => {
    try {
      const AudioContextClass = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = scannerAudioContextRef.current ?? new AudioContextClass();
      scannerAudioContextRef.current = context;
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
    } catch {
      // Audio availability must never prevent scanning.
    }
  };

  const playScannerSuccessFeedback = async () => {
    try {
      if (await playScannerSuccessFeedbackOnNativeAndroid()) return;
    } catch (error) {
      console.warn('[Inkbound scanner] Native scanner feedback unavailable; falling back to Web Audio.', error);
    }
    try {
      const AudioContextClass = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        const context = scannerAudioContextRef.current ?? new AudioContextClass();
        scannerAudioContextRef.current = context;
        if (context.state === 'suspended') await context.resume();

        const now = context.currentTime;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        gain.connect(context.destination);

        const first = context.createOscillator();
        first.type = 'sine';
        first.frequency.setValueAtTime(660, now);
        first.connect(gain);
        first.start(now);
        first.stop(now + 0.09);

        const second = context.createOscillator();
        second.type = 'sine';
        second.frequency.setValueAtTime(880, now + 0.07);
        second.connect(gain);
        second.start(now + 0.07);
        second.stop(now + 0.18);
      }
    } catch {
      // Audio confirmation is best-effort and must never block a successful scan.
    }

    try {
      navigator.vibrate?.(35);
    } catch {
      // Haptics are optional and unsupported on some browsers/devices.
    }
  };

  // A barcode identifies an edition, while title search can identify its work.
  // Only copy a confidently identified author: never copy a different edition's
  // ISBN, cover or page count into the scanned edition.
  const recoverMissingScanAuthor = async (work: BookSearchWorkGroup): Promise<BookSearchWorkGroup> => {
    if (!work.title.trim() || work.authors.some((author) => {
      const normalized = normalizeAuthorName(author);
      return Boolean(normalized) && normalized !== 'unknown author';
    })) return work;
    try {
      const response = await searchGoogleBooks(work.title);
      const title = normalizeCatalogText(work.title);
      const candidates = response.groups.filter((candidate) =>
        normalizeCatalogText(candidate.title) === title
        && candidate.authors.some((author) => {
          const normalized = normalizeAuthorName(author);
          return Boolean(normalized) && normalized !== 'unknown author';
        }));
      const distinctAuthors = new Set(candidates.map((candidate) =>
        candidate.authors.map(normalizeAuthorName).filter((author) => author !== 'unknown author').join('|')));
      if (distinctAuthors.size !== 1 || !candidates.length) return work;
      return { ...work, authors: candidates[0].authors };
    } catch {
      return work;
    }
  };

  const lookupScannedIsbn = async (rawIsbn: string) => {
    const isbn = normalizeIsbn(rawIsbn);
    if (!isValidCatalogIsbn(isbn) || scannerBusy) {
      if (isbn) setScannerError('This barcode is not a valid ISBN-10 or ISBN-13. Check for a separate ISBN barcode; UPC product codes cannot identify a book edition.');
      return;
    }
    if (scannedBooks.some((item) => item.isbn === isbn)) {
      setScannerMessage('That ISBN is already in this scan batch.');
      setScannerError(null);
      return;
    }

    setScannerBusy(true);
    setUnresolvedIsbn(null);
    setScannerEditionOptions([]);
    setScannerRecoveryTitle('');
    setScannerRecoveryAuthor('');
    setScannerError(null);
    setScannerMessage(null);
    try {
      const resolved = await resolveCatalogIsbn(isbn);
      if (!resolved) {
        setUnresolvedIsbn(isbn);
        setScannerRecoveryTitle('');
        setScannerRecoveryAuthor('');
        setScannerError(`ISBN ${isbn} is valid, but no catalog returned a verified edition. Try Scan Cover Instead to identify the book, or enter its title below. Your scanned ISBN is retained.`);
        return;
      }
      const { edition, exactIsbn } = resolved;
      const work = await recoverMissingScanAuthor(resolved.work);
      // Scanner identification must meet the same minimum metadata standard
      // as Search. Never persist an unidentified author as a successful scan.
      const hasVerifiedAuthor = work.authors.some((author) => {
        const normalized = normalizeAuthorName(author);
        return Boolean(normalized) && normalized !== 'unknown author';
      });
      if (!work.title.trim() || !hasVerifiedAuthor) {
        setUnresolvedIsbn(isbn);
        setScannerRecoveryTitle(work.title.trim());
        if (work.title.trim()) {
          const response = await searchGoogleBooks(work.title);
          const matches = response.groups.filter((candidate) => normalizeCatalogText(candidate.title) === normalizeCatalogText(work.title) && candidate.authors.some((name) => normalizeAuthorName(name) !== 'unknown author' && Boolean(normalizeAuthorName(name))));
          setScannerEditionOptions(matches);
        }
        setScannerError(`We could not verify the scanned edition. ${work.title.trim() ? 'Choose a matching catalog edition below, or search manually.' : 'Enter a title to find alternative editions.'}`);
        return;
      }
      // A work-level match is useful even when a retailer-exclusive ISBN is
      // missing from catalog editions. Keep the catalog edition's own ISBN;
      // never mislabel it as the scanned edition.
      const book = createBookFromSearchEdition({ work, edition, status: 'tbr' });
      const nextBatch = [...scannedBooks, { isbn, book }];
      if (!writeScannerDraft(nextBatch)) {
        setScannerError('Device storage is full or unavailable. This book was not added to the batch because it could not be protected.');
        return;
      }
      setScannedBooks(nextBatch);
      setScannerReviewPage(Math.ceil(nextBatch.length / scannerReviewPageSize));
      setManualIsbn('');
      setScannerMessage(exactIsbn
        ? `Added “${work.title}” to this scan batch.`
        : `Added “${work.title}” as a different edition (scanned ISBN ${isbn}). Review the edition before saving; the catalog edition’s ISBN was kept unchanged.`);
      void playScannerSuccessFeedback();
    } catch (error) {
      setUnresolvedIsbn(isbn);
      setScannerError(`ISBN ${isbn} is valid, but catalog lookup failed. Retry or complete the details manually. ${error instanceof Error ? error.message : ''}`);
    } finally {
      setScannerBusy(false);
    }
  };

  const chooseScannerAlternative = (work: BookSearchWorkGroup, edition: BookSearchEdition) => {
    const chosenIsbn = unresolvedIsbn ?? edition.isbn13 ?? edition.isbn10 ?? `catalog:${edition.source}:${edition.externalEditionId}`;
    if (scannedBooks.some((item) => item.isbn === chosenIsbn)) return;
    const book = createBookFromSearchEdition({ work, edition, status: 'tbr' });
    if (!hasIdentifiedBook(book)) return;
    const nextBatch = [...scannedBooks, { isbn: chosenIsbn, book }];
    if (!writeScannerDraft(nextBatch)) {
      setScannerError('Device storage is unavailable. This selection was not added to the batch.');
      return;
    }
    setScannedBooks(nextBatch);
    setScannerReviewPage(Math.ceil(nextBatch.length / scannerReviewPageSize));
    setScannerMessage(unresolvedIsbn ? `Added “${work.title}” using a catalog edition. Scanned ISBN ${unresolvedIsbn} is retained separately; review the selected edition before saving.` : `Added “${work.title}” from its cover. Review the selected catalog edition before saving.`);
    setUnresolvedIsbn(null);
    setScannerEditionOptions([]);
    setScannerError(null);
    void playScannerSuccessFeedback();
  };

  const recoverScannedBookByTitle = async () => {
    const titleQuery = scannerRecoveryTitle.trim();
    const authorQuery = scannerRecoveryAuthor.trim();
    if (!unresolvedIsbn || !titleQuery || isSearching) return;
    setIsSearching(true);
    setScannerEditionOptions([]);
    setSearchError(null);
    setHasSearched(true);
    setAuthorPage(null);
    setPendingSearchEdition(null);
    setQuery(titleQuery);
    try {
      // Query the work, not the retailer-specific ISBN. A title/author match
      // can recover metadata even when that edition is absent from catalogs.
      const response = await searchGoogleBooks(titleQuery);
      const normalizedTitle = normalizeCatalogText(titleQuery);
      const normalizedAuthor = normalizeAuthorName(authorQuery);
      const candidates = response.groups.filter((work) => {
        const workTitle = normalizeCatalogText(work.title);
        const titleMatches = workTitle === normalizedTitle
          || workTitle.startsWith(normalizedTitle + ' ')
          || normalizedTitle.startsWith(workTitle + ' ');
        const authorMatches = !normalizedAuthor || work.authors.some((name) =>
          normalizeAuthorName(name) === normalizedAuthor);
        return titleMatches && authorMatches;
      });
      setResults(candidates);
      setActiveTab('search');
      if (!candidates.length) {
        setSearchError('No matching title and author found. Try a shorter title, adjust the author, or enter the book manually. Your scanned ISBN is retained.');
      }
    } catch (error) {
      setResults([]);
      setActiveTab('search');
      setSearchError(error instanceof Error ? error.message : 'Catalog search unavailable. Your scanned ISBN is retained.');
    } finally {
      setIsSearching(false);
    }
  };

  const recoverBookFromCover = async (file: File) => {
    if (scannerPhotoBusy || scannerBusy) return;
    setScannerPhotoBusy(true);
    setScannerError(null);
    setScannerMessage('Reading the cover and searching the catalog…');
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not process cover photograph.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const image = canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
      setPhotoIsbnChoices([]);
      const lines = await recognizeBookCover(image);
      // A photographed copyright page can identify the exact edition without a barcode.
      // OCR may split ISBN-13 and ISBN-10 across lines or include both on one line.
      // Only accept checksum-valid values explicitly adjacent to an ISBN label.
      // Parse ISBNs per OCR line: joining lines used to consume adjacent edition
      // numbers and accidentally suppress all matches on retailer copyright pages.
      const detectedIsbns = [...new Set(lines.flatMap((line) =>
        [...line.matchAll(/(?:ISBN(?:-1[03])?\s*[:：]?\s*)(97[89][\d\s-]{9,20}\d|[\d\s-]{9,18}[\dX])/gi)]
          .map((match) => normalizeIsbn(match[1]).slice(0, 13))
          .filter(isValidCatalogIsbn)))];
      if (detectedIsbns.length > 0) {
        const selected = unresolvedIsbn && detectedIsbns.includes(unresolvedIsbn)
          ? unresolvedIsbn : detectedIsbns.length === 1 ? detectedIsbns[0] : null;
        if (selected) {
          if (selected !== unresolvedIsbn) await lookupScannedIsbn(selected);
          else setScannerMessage('Printed ISBN matches the scanned ISBN. Scan the front cover to identify this uncatalogued edition.');
          return;
        }
        setPhotoIsbnChoices(detectedIsbns);
        setScannerMessage('Select the ISBN printed for your edition, then scan the front cover if its catalog entry is missing.');
        return;
      }
      // Never carry a previous book's author/title into this cover attempt.
      setScannerRecoveryTitle('');
      setScannerRecoveryAuthor('');
      setScannerEditionOptions([]);
      // Build title candidates from OCR lines without letting cover blurbs,
      // badges, or endorsements contaminate the actual title.
      const coverLines = lines.map((line) => line.replace(/[^a-zA-Z\s'-]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
      const isNoise = (value: string) => /(?:new york times|bestsell|walmart|exclusive|author|edition|isbn|book club|a novel|anything you can do|slay)/i.test(value);
      const cleanLines = coverLines.filter((line) => !isNoise(line));
      const phrases = cleanLines.flatMap((line, index) => [
        line,
        ...[2, 3, 4].map((count) => cleanLines.slice(index, index + count).join(' ')),
      ]);
      // Search the title as it appears on the cover, not 32 unrelated fragments.
      const candidates = [...new Set(phrases)]
        .filter((phrase) => phrase.length >= 4 && phrase.length <= 85 && !isNoise(phrase))
        .sort((left, right) => {
          const score = (value: string) => {
            const words = value.split(/\s+/);
            const useful = words.filter((word) => word.length >= 4);
            return (words.length >= 2 && words.length <= 7 ? 10 : 0)
              + useful.length * 2 - Math.max(0, words.length - 7) * 3;
          };
          return score(right) - score(left);
        })
        .slice(0, 12);
      if (!candidates.length) throw new Error('No readable title found. Try a clearer, straight-on photo in good light.');
      const recognized = normalizeCatalogText(lines.join(' '));
      const coverWords = new Set(recognized.split(' ').filter(Boolean));
      let best: { work: BookSearchWorkGroup; score: number } | null = null;
      let found: BookSearchWorkGroup[] = [];
      for (const candidate of candidates) {
        // One failed provider request must not discard the entire photograph.
        let response: Awaited<ReturnType<typeof searchGoogleBooks>>;
        try {
          response = await searchGoogleBooks(candidate);
        } catch {
          continue;
        }
        for (const work of response.groups) {
          const titleKey = normalizeCatalogText(work.title);
          const titleWords = titleKey.split(' ').filter(Boolean);
          if (!titleWords.length || titleKey.length < 4) continue;
          const meaningful = titleWords.filter((word) => word.length >= 4);
          // OCR may split or slightly misread large decorative cover lettering.
          // Require most distinctive title words plus author confirmation.
          const titleHits = meaningful.filter((word) => coverWords.has(word)).length;
          if (!meaningful.length || titleHits < Math.max(1, Math.ceil(meaningful.length * 0.65))) continue;
          // Single-word titles need an exact OCR word and a matching author;
          // otherwise a generic cover word could identify an unrelated book.
          const singleWordTitle = titleWords.length === 1;
          const authorScore = work.authors.some((name) => {
            const authorWords = normalizeAuthorName(name).split(' ').filter((word) => word.length >= 4);
            return authorWords.length >= 2 && authorWords.every((word) => coverWords.has(word));
          }) ? 0.5 : 0;
          // A complete multiword title is required; author confirmation ranks matches.
          if (singleWordTitle && !authorScore) continue;
          const score = titleHits / meaningful.length + authorScore + Math.min(0.2, meaningful.length * 0.05);
          if (score > (best?.score ?? 0)) { best = { work, score }; found = response.groups; }
        }
        if (best && best.score >= 1.5) break;
      }
      if (!best) {
        setScannerEditionOptions([]);
        setScannerRecoveryTitle('');
        setScannerRecoveryAuthor('');
        throw new Error('Cover text was detected, but no reliable catalog match was found. Try another photo or enter the title.');
      }
      // Cover OCR identifies a work, not the scanned edition. Offer the
      // matching catalog editions in Scanner, never silently substitute ISBNs.
      const titleKey = normalizeCatalogText(best.work.title);
      const matches = found.filter((work) =>
        normalizeCatalogText(work.title) === titleKey
        && work.authors.some((name) => normalizeAuthorName(name) !== 'unknown author'));
      if (!matches.length) throw new Error('The cover title was found, but no edition with a known author is available.');
      if (!unresolvedIsbn) {
        setScannerRecoveryTitle(best.work.title);
        setScannerRecoveryAuthor(best.work.authors.join(', '));
        setScannerMessage('Cover identified a possible book. Review the matching editions below.');
      }
      setScannerEditionOptions(matches);
      setScannerRecoveryTitle(best.work.title);
      setScannerMessage('Cover identified a possible book. Review the editions below and choose Add to Stack.');
      setScannerError(null);
      // Keep the original scanned ISBN until the reader selects an edition.
    } catch (error) {
      setScannerMessage(null);
      setScannerError(error instanceof Error ? error.message : 'Cover recognition failed. Try another photo.');
    } finally {
      setScannerPhotoBusy(false);
      if (coverFileInputRef.current) coverFileInputRef.current.value = '';
    }
  };

  const startCamera = async () => {
    if (webScannerStartingRef.current || cameraActive) return;
    webScannerStartingRef.current = true;
    primeScannerAudio();
    setScannerError(null);
    setScannerMessage(null);

    if (shouldUseNativeBarcodeScanner()) {
      try {
        const raw = await scanBarcodeWithNativeRuntime();
        if (raw) await lookupScannedIsbn(raw);
      } catch (error) {
        setScannerError(error instanceof Error ? error.message : 'Inkbound could not open the barcode scanner.');
      }
      webScannerStartingRef.current = false;
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerError('Camera access is unavailable. Open Inkbound over HTTPS and allow camera access, or enter the ISBN manually.');
      webScannerStartingRef.current = false;
      return;
    }

    try {
      if (!videoRef.current) { webScannerStartingRef.current = false; return; }
      // Use the same proven barcode decoder on every web browser, including
      // Safari, Chrome and Firefox. Browser BarcodeDetector support varies.
      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.EAN_8,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 140,
        delayBetweenScanSuccess: 500,
      });
      webScannerReaderRef.current = reader;
      webScanHandledRef.current = false;
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
        videoRef.current,
        (result) => {
          if (!result || webScanHandledRef.current) return;
          const decoded = result.getText();
          const isbn = selectCatalogIsbnFromBarcodes([decoded]);
          if (!isbn) {
            setScannerMessage('Barcode detected, but it is not a book ISBN. Center the 13-digit ISBN barcode and move closer until the bars are sharp.');
            return;
          }
          webScanHandledRef.current = true;
          stopCamera();
          void lookupScannedIsbn(isbn);
        },
      );
      webScannerControlsRef.current = controls;
      webScannerStartingRef.current = false;
      setCameraActive(true);
      setScannerMessage('Point the camera at the 13-digit ISBN barcode. Hold steady and keep the bars in focus.');
    } catch (error) {
      stopCamera();
      setScannerError(error instanceof Error ? error.message : 'Inkbound could not open the camera.');
      webScannerStartingRef.current = false;
    }
  };

  const addScannedBatch = async () => {
    if (scannedBooks.length === 0 || scannerBusy) return;
    const incomplete = scannedBooks.filter((item) => !hasIdentifiedBook(item.book));
    if (incomplete.length) {
      setScannerError(`${incomplete.length} scanned book(s) have missing titles or authors. They cannot be saved until identified. Remove them from the batch and use title recovery; the rest of your batch remains intact.`);
      return;
    }
    const books = scannedBooks.map((item) => applyReadingStatusSelection(item.book, scannerCategory));
    try {
      if (!onAddMultipleBooks) {
        setScannerError('Batch saving is unavailable. Your scanned books have been kept for retry.');
        return;
      }
      if (!onAddMultipleBooks(books)) {
        setScannerError('Inkbound could not save this batch. All scanned books are still here; do not close this screen.');
        return;
      }
      // A synchronous runtime write is not proof that IndexedDB committed.
      // Keep the recoverable scan draft if the durable write failed.
      await flushLargeBrowserStorage();
      // Clear the persisted draft synchronously before closing the modal.
      // React's state effect may never run if onClose unmounts this component.
      if (!writeScannerDraft([])) {
        setScannerError('Books were saved, but the scanner draft could not be cleared. Please clear the stack before scanning again.');
        return;
      }
      setScannedBooks([]);
      setScannerReviewPage(1);
      stopCamera();
      onClose();
    } catch (error) {
      setScannerError(error instanceof Error ? `Batch durability not confirmed: ${error.message}. The scanned ISBN backup is retained.` : 'Batch durability not confirmed. Your scanned ISBN backup is retained.');
    }
  };


  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery || isSearching) return;
    setAuthorPage(null);
    setAuthorNextStartIndex(0);
    setAuthorProviderTotal(null);
    setAuthorHasMore(false);
    setIsLoadingAuthorMore(false);
    setAuthorCatalogPage(1);
    setIsSearching(true);
    setSearchError(null);
    setHasSearched(true);
    setPendingSearchEdition(null);
    try {
      const response = await searchGoogleBooks(trimmedQuery);
      if (looksLikeAuthorNameQuery(trimmedQuery)) {
        try {
          const authorResponse = await searchGoogleBooksAuthorPage(trimmedQuery, 0);
          const exactAuthorResults = filterExactAuthorResults(authorResponse.groups, trimmedQuery);
          // An author-qualified search must not be diluted by generic keyword
          // matches (e.g. books with the author's name in their title).
          // Retain generic results only when no verified author match exists.
          setResults(exactAuthorResults.length > 0
            ? mergeCatalogResultGroups(exactAuthorResults, filterExactAuthorResults(response.groups, trimmedQuery))
            : response.groups);
        } catch {
          // Generic search remains fully usable if the author-qualified
          // supplement is unavailable or rate-limited.
          setResults(response.groups);
        }
      } else {
        setResults(response.groups);
      }
    } catch (error) {
      setResults([]);
      setSearchError(error instanceof Error ? error.message : 'Reading-material search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const searchEditionKey = (work: BookSearchWorkGroup, edition: BookSearchEdition) =>
    `${work.key}:${edition.source}:${edition.externalEditionId}`;


  const openAuthorPage = async (authorName: string) => {
    if (isSearching) return;
    const knownAuthorBooks = filterExactAuthorResults(results, authorName);
    setAuthorPage({
      name: authorName,
      previousQuery: query,
      previousResults: results,
      previousHasSearched: hasSearched,
    });
    // Keep already-discovered books visible while the author provider loads.
    // An empty or unavailable provider response must never erase these books.
    setResults(knownAuthorBooks);
    setAuthorNextStartIndex(0);
    setAuthorProviderTotal(null);
    setAuthorHasMore(false);
    setIsLoadingAuthorMore(false);
    setIsSearching(true);
    setSearchError(null);
    setHasSearched(true);
    setPendingSearchEdition(null);

    try {
      const response = await searchGoogleBooksAuthorPage(authorName, 0);
      const exactAuthorResults = filterExactAuthorResults(response.groups, authorName);
      setResults(mergeCatalogResultGroups(knownAuthorBooks, exactAuthorResults));
      setAuthorNextStartIndex(response.nextStartIndex);
      setAuthorProviderTotal(response.providerTotalItems || null);
      setAuthorHasMore(response.hasMore);
    } catch (error) {
      setAuthorHasMore(false);
      if (knownAuthorBooks.length === 0) {
        setSearchError(error instanceof Error ? error.message : 'Author catalog search failed. Please try again.');
      }
      // Retain matching books already returned by the main search.
    } finally {
      setIsSearching(false);
    }
  };

  const loadMoreAuthorBooks = async () => {
    if (!authorPage || !authorHasMore || isLoadingAuthorMore) return;
    setIsLoadingAuthorMore(true);
    setSearchError(null);

    try {
      const response = await searchGoogleBooksAuthorPage(authorPage.name, authorNextStartIndex);
      const exactAuthorResults = filterExactAuthorResults(response.groups, authorPage.name);
      setResults((current) => mergeCatalogResultGroups(current, exactAuthorResults));
      setAuthorNextStartIndex(response.nextStartIndex);
      setAuthorProviderTotal(response.providerTotalItems || authorProviderTotal);
      setAuthorHasMore(response.hasMore && response.nextStartIndex > authorNextStartIndex);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Could not load more books. Please try again.');
    } finally {
      setIsLoadingAuthorMore(false);
    }
  };

  const closeAuthorPage = () => {
    if (!authorPage) return;
    setQuery(authorPage.previousQuery);
    setResults(authorPage.previousResults);
    setHasSearched(authorPage.previousHasSearched);
    setSearchError(null);
    setAuthorPage(null);
    setAuthorNextStartIndex(0);
    setAuthorProviderTotal(null);
    setAuthorHasMore(false);
    setIsLoadingAuthorMore(false);
    setAuthorCatalogPage(1);
  };

  const chooseSearchEdition = (work: BookSearchWorkGroup, edition: BookSearchEdition) => {
    setPendingSearchEdition({ work, edition });
  };

  const storeAddedSearchBook = (work: BookSearchWorkGroup, edition: BookSearchEdition, book: UserBookRecord) => {
    const key = searchEditionKey(work, edition);
    setAddedSearchBooks((current) => {
      const next = new Map(current);
      next.set(key, book);
      return next;
    });
  };

  const quickAddSearchEdition = (work: BookSearchWorkGroup, edition: BookSearchEdition) => {
    const key = searchEditionKey(work, edition);
    if (addedSearchBooks.has(key)) return;
    const book = createBookFromSearchEdition({ work, edition, status: 'tbr' });
    onAddBook(book);
    storeAddedSearchBook(work, edition, book);
  };

  const removeAddedSearchBook = (work: BookSearchWorkGroup, edition: BookSearchEdition) => {
    const key = searchEditionKey(work, edition);
    const book = addedSearchBooks.get(key);
    if (!book || !onRemoveBook) return;
    onRemoveBook(book);
    setAddedSearchBooks((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };

  const addSearchEditionToList = (selectedStatus: ReadingStatusSelection) => {
    if (!pendingSearchEdition) return;
    const { work, edition } = pendingSearchEdition;
    const key = searchEditionKey(work, edition);
    if (!addedSearchBooks.has(key)) {
      const baseBook = createBookFromSearchEdition({ work, edition, status: 'tbr' });
      const book = applyReadingStatusSelection(baseBook, selectedStatus);
      onAddBook(book);
      storeAddedSearchBook(work, edition, book);
    }
    setPendingSearchEdition(null);
  };

  const authorCatalogTotalPages = authorPage
    ? Math.max(1, Math.ceil(results.length / AUTHOR_CATALOG_PAGE_SIZE))
    : 1;
  const safeAuthorCatalogPage = Math.min(authorCatalogPage, authorCatalogTotalPages);
  const visibleSearchResults = authorPage
    ? results.slice(
        (safeAuthorCatalogPage - 1) * AUTHOR_CATALOG_PAGE_SIZE,
        safeAuthorCatalogPage * AUTHOR_CATALOG_PAGE_SIZE,
      )
    : results;

  const handleManualAdd = () => {
    if (!title.trim() || !author.trim()) return;
    if (unresolvedIsbn && !isValidCatalogIsbn(unresolvedIsbn)) return;
    const workId = uniqueId('work');
    const editionId = uniqueId('edition');
    const bookId = uniqueId('book');
    const parsedPageCount = Number.parseInt(pageCount, 10);
    const validPageCount = Number.isFinite(parsedPageCount) && parsedPageCount > 0 ? parsedPageCount : undefined;
    const hasKnownPrintTotal = format !== 'audiobook' && validPageCount !== undefined;
    const isFinished = statusSelection === 'finished';
    const addedOn = today();
    const customOwnership = isCustomOwnershipSelection(ownershipSelection);
    const ownership: OwnershipStatus = customOwnership ? 'custom' : ownershipSelection;
    const customOwnershipCategoryId = customOwnership ? ownershipSelection.slice('custom:'.length) : undefined;

    const baseBook: UserBookRecord = {
      id: bookId,
      work: {
        id: workId,
        title: title.trim(),
        author: author.trim(),
        summary: summary.trim() || 'No summary added yet.',
        publisherSummary: summary.trim() || undefined,
        materialType,
        genres: genres.split(',').map((genre) => genre.trim()).filter(Boolean),
        publicationYear: new Date().getFullYear(),
      },
      activeEditionId: editionId,
      editions: [{
        id: editionId,
        format,
        isbn13: unresolvedIsbn?.length === 13 ? unresolvedIsbn : undefined,
        isbn10: unresolvedIsbn?.length === 10 ? unresolvedIsbn : undefined,
        pageCount: format === 'audiobook' ? undefined : validPageCount,
        coverGradient: 'from-[#5c3d62] via-[#35243f] to-[#171117]',
      }],
      status: 'tbr',
      ownership,
      customOwnershipCategoryId,
      progressPages: isFinished && hasKnownPrintTotal ? validPageCount! : 0,
      progressMinutes: 0,
      progressPercentage: 0,
      favoriteQuotes: [],
      privateTags: [],
      priority,
      moods: [],
      collections: [],
      sourceOfImport: 'Manual entry',
      dateAdded: addedOn,
      dateAddedAt: new Date().toISOString(),
    };

    onAddBook(applyReadingStatusSelection(baseBook, statusSelection, addedOn));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-black/80 p-3 backdrop-blur-sm sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="inkbound-modal-surface relative min-h-0 min-w-0 max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl overflow-x-hidden overflow-y-auto overscroll-contain rounded-3xl border border-[#c5a059]/40 bg-[#17101b] px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-7" style={{ maxWidth: 'min(1080px, calc(100vw - 24px))', maxHeight: 'calc(100dvh - 24px)' }} role="dialog" aria-modal="true" aria-labelledby="add-book-title">
        <button type="button" onClick={onClose} className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-black/30 text-[#ad9fac]" aria-label="Close add reading material dialog"><X className="h-5 w-5" /></button>

        <header className="pr-12">
          <p className="inkbound-kicker">Build your library</p>
          <h2 id="add-book-title" className="mt-2 font-serif text-3xl text-[#f4efe6]">Add Reading Material</h2>
          <p className="mt-2 text-sm text-[#ad9fac]">Search, scan a stack of books, or add something manually.</p>
        </header>

        <input ref={coverFileInputRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Photograph book cover" onChange={(event) => { const file = event.target.files?.[0]; if (file) void recoverBookFromCover(file); }} />
        <div className="mt-6 grid min-w-0 grid-cols-4 gap-1 rounded-xl border border-[#3d2448] bg-[#0d0910] p-1">
          <button type="button" onClick={() => setActiveTab('search')} className={`min-h-11 min-w-0 rounded-lg px-1 text-xs font-semibold sm:px-3 sm:text-sm ${activeTab === 'search' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac]'}`}>Search</button>
          <button type="button" onClick={() => { primeScannerAudio(); setActiveTab('scan'); setAuthorPage(null); }} className={`min-h-11 min-w-0 rounded-lg px-1 text-xs font-semibold sm:px-3 sm:text-sm ${activeTab === 'scan' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac]'}`}>Scan Books</button>
          <button type="button" disabled={scannerPhotoBusy || scannerBusy} onClick={() => { setActiveTab('scan'); setAuthorPage(null); coverFileInputRef.current?.click(); }} className="min-h-11 min-w-0 rounded-lg px-1 text-xs font-semibold text-[#ad9fac] disabled:opacity-50 sm:px-3 sm:text-sm">{scannerPhotoBusy ? 'Reading…' : 'Scan Cover'}</button>
          <button type="button" onClick={() => { setActiveTab('manual'); setAuthorPage(null); }} className={`min-h-11 min-w-0 rounded-lg px-1 text-xs font-semibold sm:px-3 sm:text-sm ${activeTab === 'manual' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac]'}`}>Add Manually</button>
        </div>

        {activeTab === 'search' ? (
          <div className="mt-6 space-y-5">
            {unresolvedIsbn && <div className="rounded-xl border border-[#c5a059]/40 bg-[#c5a059]/10 p-3 text-sm text-[#f1d9a1]">Scanned ISBN {unresolvedIsbn} is preserved. Results below are possible other editions, not verified matches for that ISBN. Choose an edition deliberately, or return to Scan Books to complete the original edition manually.</div>}
            {authorPage ? (
              <section className="overflow-hidden rounded-2xl border border-[#c5a059]/25 bg-gradient-to-br from-[#241726] via-[#1d1422] to-[#120c15] p-5 sm:p-6">
                <button type="button" onClick={closeAuthorPage} className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-bold text-[#d8c28b] transition hover:bg-white/5 hover:text-[#f1d37b]">
                  <ArrowLeft className="h-4 w-4" /> Back to search results
                </button>
                <div className="mt-4 flex items-center gap-4">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-[#c5a059]/30 bg-[#c5a059]/10 text-[#e5c158]"><UserRound className="h-6 w-6" /></div>
                  <div className="min-w-0">
                    <p className="inkbound-kicker">Author catalog</p>
                    <h3 className="mt-1 truncate font-serif text-3xl text-[#f4efe6]">{authorPage.name}</h3>
                    <p className="mt-1 text-sm text-[#ad9fac]">
                      {isSearching
                        ? 'Finding books…'
                        : `${results.length} title${results.length === 1 ? '' : 's'} loaded${authorProviderTotal && authorProviderTotal >= results.length ? ` of ${authorProviderTotal}` : ''}`}
                    </p>
                  </div>
                </div>
              </section>
            ) : (
              <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
                <label className="relative min-w-0 flex-1">
                  <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#807482]" />
                  <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title, author, or ISBN" autoFocus className="h-12 w-full rounded-xl border border-[#c5a059]/20 bg-[#0d0910] pl-12 pr-4 text-sm text-[#f4efe6] outline-none" />
                </label>
                <button type="submit" disabled={!query.trim() || isSearching} className="quiet-shelf-primary-action min-h-12 px-6 disabled:opacity-50">{isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{isSearching ? 'Searching…' : 'Search'}</button>
              </form>
            )}

            {searchError && <div className="rounded-xl border border-[#c97b7b]/40 bg-[#c97b7b]/10 p-4 text-sm text-[#efb6b6]">{searchError}</div>}
            {!authorPage && !hasSearched && <div className="rounded-2xl border border-dashed border-[#c5a059]/25 px-6 py-12 text-center"><BookOpen className="mx-auto h-10 w-10 text-[#c5a059]/65" /><p className="mt-4 text-sm text-[#ad9fac]">Search catalog metadata. You can correct the material type later if the source does not identify it reliably.</p></div>}
            {hasSearched && !isSearching && !searchError && results.length === 0 && <div className="rounded-2xl border border-dashed border-[#c5a059]/25 px-6 py-10 text-center"><p className="font-serif text-xl text-[#f4efe6]">{authorPage ? `No books found for ${authorPage.name}` : 'No matching material found'}</p>{!authorPage && <button type="button" onClick={() => setActiveTab('manual')} className="quiet-shelf-secondary-action mt-5">Add Manually</button>}</div>}

            {results.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleSearchResults.map((work) => {
                  const edition = work.editions[0];
                  if (!edition) return null;
                  const key = searchEditionKey(work, edition);
                  const addedBook = addedSearchBooks.get(key);
                  const added = Boolean(addedBook);
                  return (
                    <article key={work.key} className="flex min-w-0 flex-col rounded-2xl border border-[#c5a059]/18 bg-[#1d1422] p-4">
                      <h3 className="line-clamp-2 font-serif text-xl leading-tight text-[#f4efe6]">{work.title}</h3>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs">
                        {work.authors.map((authorName, index) => (
                          <React.Fragment key={`${work.key}-${authorName}`}>
                            {index > 0 && <span className="text-[#6f6370]">·</span>}
                            <button
                              type="button"
                              onClick={() => void openAuthorPage(authorName)}
                              className="font-medium text-[#b9a9ba] underline decoration-transparent underline-offset-2 transition hover:text-[#e5c158] hover:decoration-[#c5a059]/45"
                              title={`View books by ${authorName}`}
                            >
                              {authorName}
                            </button>
                          </React.Fragment>
                        ))}
                      </div>

                      <div className={`mt-4 flex min-h-36 gap-3 rounded-xl border p-3 ${added ? 'border-[#c5a059]/35 bg-[#17131b]' : 'border-white/7 bg-[#120c15]'}`}>
                        {edition.coverUrl ? <img src={edition.coverUrl} alt="" className="h-28 w-20 shrink-0 rounded object-cover" /> : <span className="grid h-28 w-20 shrink-0 place-items-center rounded bg-gradient-to-br from-[#5c3d62] to-[#171117]"><BookOpen /></span>}
                        <div className="flex min-w-0 flex-1 flex-col text-xs text-[#ad9fac]">
                          <strong className="block text-[#f4efe6]">{FORMAT_OPTIONS.find((option) => option.value === edition.format)?.label ?? edition.format}</strong>
                          {edition.pageCount ? <span className="mt-1 block">{edition.pageCount} pages</span> : <span className="mt-1 block text-[#776b78]">Page count unavailable</span>}
                          <div className="mt-auto pt-3">
                            {addedBook ? (
                              <div className="rounded-xl border border-[#c5a059]/20 bg-[#1d1720] px-3 py-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-2 font-semibold text-[#e5c158]">
                                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#c5a059]/15"><Check className="h-3.5 w-3.5" /></span>
                                    <span className="truncate">In your library</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeAddedSearchBook(work, edition)}
                                    disabled={!onRemoveBook}
                                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-[#8f8290] transition hover:border-rose-400/50 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40"
                                    aria-label={`Remove ${work.title} from your library`}
                                    title="Remove accidental add"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                <p className="mt-1.5 pl-8 text-[11px] font-medium text-[#bcaebe]">Added to TBR</p>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2">
                                <button type="button" onClick={() => quickAddSearchEdition(work, edition)} className="quiet-shelf-primary-action min-h-10 justify-center px-3">+ Add</button>
                                <button type="button" onClick={() => chooseSearchEdition(work, edition)} className="min-h-9 text-xs font-bold text-[#d8c28b]">Choose list</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {authorPage && !isSearching && results.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAuthorCatalogPage((current) => Math.max(1, current - 1))}
                  disabled={safeAuthorCatalogPage <= 1 || isLoadingAuthorMore}
                  className="quiet-shelf-secondary-action min-h-11 px-4 disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" /> Previous
                </button>
                <span className="min-w-[110px] text-center text-sm font-semibold text-[#ad9fac]">
                  Page {safeAuthorCatalogPage} of {authorCatalogTotalPages}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (safeAuthorCatalogPage < authorCatalogTotalPages) {
                      setAuthorCatalogPage((current) => current + 1);
                      return;
                    }
                    if (!authorHasMore) return;
                    const previousLength = results.length;
                    await loadMoreAuthorBooks();
                    window.setTimeout(() => {
                      setAuthorCatalogPage(Math.floor(previousLength / AUTHOR_CATALOG_PAGE_SIZE) + 1);
                    }, 0);
                  }}
                  disabled={isLoadingAuthorMore || (safeAuthorCatalogPage >= authorCatalogTotalPages && !authorHasMore)}
                  className="quiet-shelf-secondary-action min-h-11 px-4 disabled:opacity-40"
                >
                  {isLoadingAuthorMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {isLoadingAuthorMore ? 'Loading…' : 'Next'}
                </button>
              </div>
            )}
          </div>
        ) : activeTab === 'scan' ? (
          <div className="mt-5 grid min-w-0 items-start gap-4 lg:grid-cols-2">
            <section className="min-w-0 rounded-2xl border border-[#c5a059]/25 bg-[#120c15] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="inkbound-kicker">Stack scanner</p>
                  <h3 className="mt-1 font-serif text-2xl text-[#f4efe6]">Scan as many as you want</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[#ad9fac]">Nothing is added to your Inkbound library while you scan. Review the stack first, then choose the reading list for the whole batch.</p>
                </div>
                <div className="rounded-full border border-[#c5a059]/25 px-3 py-2 text-sm font-bold text-[#e5c158]">{scannedBooks.length} ready</div>
              </div>

              <div className="relative mt-5 aspect-[4/3] max-h-[300px] overflow-hidden rounded-2xl border border-white/10 bg-black">
                <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
                {cameraActive && (
                  <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-[#e5c158]/80">
                    <span className="absolute left-1/2 top-1/2 w-3/4 -translate-x-1/2 border-t border-[#e5c158]/70" />
                  </div>
                )}
                {!cameraActive && (
                  <div className="absolute inset-0 grid place-items-center bg-[#120817]/90 px-6 text-center">
                    <div>
                      <Camera className="mx-auto h-10 w-10 text-[#c5a059]" />
                      <p className="mt-3 text-sm text-[#ad9fac]">Use your camera to scan the ISBN barcode.</p>
                      <button type="button" onClick={() => void startCamera()} disabled={scannerBusy} className="quiet-shelf-primary-action mt-4 disabled:opacity-50"><ScanLine className="h-4 w-4" /> Start Scanner</button>
                    </div>
                  </div>
                )}
              </div>

              {cameraActive && (
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={stopCamera} className="quiet-shelf-secondary-action">Stop Camera</button>
                </div>
              )}

              <form onSubmit={(event) => { event.preventDefault(); primeScannerAudio(); void lookupScannedIsbn(manualIsbn); }} className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input value={manualIsbn} onChange={(event) => setManualIsbn(event.target.value)} inputMode="numeric" placeholder="Or enter an ISBN" className="inkbound-select min-h-11 min-w-0 flex-1" />
                <button type="submit" disabled={!manualIsbn.trim() || scannerBusy} className="quiet-shelf-secondary-action justify-center disabled:opacity-50">{scannerBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Add ISBN</button>
              </form>


              {scannerMessage && <p className="mt-3 text-sm text-[#d7c7d7]">{scannerMessage}</p>}
              {photoIsbnChoices.length > 0 && <div className="mt-3 grid gap-2" aria-label="ISBNs found in photo">
                {photoIsbnChoices.map((isbn) => <button key={isbn} type="button" disabled={scannerBusy} onClick={() => { setPhotoIsbnChoices([]); void lookupScannedIsbn(isbn); }} className="quiet-shelf-secondary-action justify-center">Use ISBN {isbn}</button>)}
              </div>}
              {scannerEditionOptions.length > 0 && <div className="mt-3 rounded-xl border border-[#c5a059]/40 bg-[#1d1422] p-3">
                <p className="font-serif text-lg text-[#f4efe6]">Possible editions</p>
                <p className="mt-1 text-xs text-[#b9a9ba]">Select only if the book and author match. Cover recognition does not verify the physical edition; the selected catalog edition keeps its own ISBN and details.</p>
                <div className="mt-3 grid gap-2">
                  {scannerEditionOptions.flatMap((work) => work.editions.slice(0, 3).map((edition) => ({ work, edition }))).slice(0, 9).map(({ work, edition }, index) => <div key={`${work.key}-${edition.externalEditionId}-${index}`} className="flex items-center gap-3 rounded-lg border border-[#c5a059]/20 bg-[#120c15] p-2">
                    {edition.coverUrl ? <img src={edition.coverUrl} alt="" className="h-20 w-14 shrink-0 rounded object-cover" /> : <BookOpen className="h-10 w-14 shrink-0 text-[#c5a059]" />}
                    <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[#f4efe6]">{work.title}</p><p className="text-xs text-[#b9a9ba]">{work.authors.join(', ')}</p><p className="text-xs text-[#ad9fac]">{edition.format} · {edition.pageCount ? `${edition.pageCount} pages` : 'Pages unavailable'}</p><button type="button" onClick={() => chooseScannerAlternative(work, edition)} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#d8b65a] bg-[#c5a059] px-3 py-3 text-center text-sm font-bold text-[#160e17] shadow-sm transition hover:bg-[#e5c158] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e5c158]"><Check className="h-4 w-4 shrink-0" /> Add to Stack</button></div>
                  </div>)}
                </div>
              </div>}
              {scannerError && <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200"><p>{scannerError}</p>{unresolvedIsbn && <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void recoverScannedBookByTitle(); }}>
                <p className="text-xs text-[#e6d6e2]">Enter a title and optionally an author. Inkbound will look up book details and available editions automatically, keeping scanned ISBN {unresolvedIsbn} separate.</p>
                <input aria-label="Book title for scanner recovery" value={scannerRecoveryTitle} onChange={(event) => setScannerRecoveryTitle(event.target.value)} placeholder="Book title" enterKeyHint="next" className="w-full rounded-lg border border-[#7a526f] bg-[#1d1422] px-3 py-2 text-sm text-white" />
                <input aria-label="Author for scanner recovery" value={scannerRecoveryAuthor} onChange={(event) => setScannerRecoveryAuthor(event.target.value)} placeholder="Author (optional)" enterKeyHint="search" className="w-full rounded-lg border border-[#7a526f] bg-[#1d1422] px-3 py-2 text-sm text-white" />
                <button type="submit" disabled={!scannerRecoveryTitle.trim() || isSearching} className="quiet-shelf-secondary-action w-full min-h-11 disabled:opacity-50">{isSearching ? 'Looking up book details…' : 'Find book details & editions'}</button>
                <button type="button" className="quiet-shelf-secondary-action w-full min-h-11" onClick={() => { setActiveTab('manual'); setScannerError(null); }}>Enter details manually instead</button>
              </form>}</div>}
            </section>

            <section className="min-w-0 rounded-2xl border border-[#3d2448] bg-[#1d1422] p-3 sm:p-5 lg:max-h-[min(66dvh,650px)] lg:overflow-y-auto">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="inkbound-kicker">Review before saving</p>
                  <h3 className="mt-1 font-serif text-2xl text-[#f4efe6]">Scanned books</h3>
                </div>
                {scannedBooks.length > 0 && <button type="button" onClick={() => { setScannedBooks([]); setScannerReviewPage(1); }} className="text-xs font-bold text-rose-300">Clear all</button>}
              </div>

              {scannedBooks.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-[#c5a059]/20 px-5 py-10 text-center text-sm text-[#ad9fac]">Your scanned books will collect here until you are ready to save them.</div>
              ) : (
                <>
                  <div className="mt-4 space-y-3">
                    {scannedBooks.slice((safeScannerReviewPage - 1) * scannerReviewPageSize, safeScannerReviewPage * scannerReviewPageSize).map((item) => {
                      const edition = item.book.editions.find((candidate) => candidate.id === item.book.activeEditionId) ?? item.book.editions[0];
                      return (
                        <article key={`${item.isbn}-${item.book.id}`} className="flex min-w-0 items-start gap-2 rounded-xl border border-white/8 bg-[#120c15] p-2.5 sm:items-center sm:gap-3 sm:p-3">
                          {edition?.coverUrl ? <img src={edition.coverUrl} alt="" className="h-20 w-14 shrink-0 rounded object-cover" /> : <span className="grid h-20 w-14 shrink-0 place-items-center rounded bg-gradient-to-br from-[#5c3d62] to-[#171117]"><BookOpen className="h-5 w-5" /></span>}
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-semibold leading-snug text-[#f4efe6] sm:text-base">{item.book.work.title}</p>
                            <p className="break-words text-xs text-[#ad9fac]">{item.book.work.author}</p>
                            <p className="mt-1 break-all text-[11px] text-[#8f8290]">ISBN {item.isbn} · {readingStatusSelectionLabel(scannerCategory)}</p>
                          </div>
                          <button type="button" onClick={() => setScannedBooks((current) => current.filter((candidate) => candidate !== item))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-rose-300" aria-label={`Remove ${item.book.work.title}`}><Trash2 className="h-4 w-4" /></button>
                        </article>
                      );
                    })}
                  </div>

                  {scannerReviewPageCount > 1 && (
                    <nav className="sticky bottom-0 z-20 mt-4 flex w-full min-w-0 items-center justify-between gap-1 rounded-xl border border-[#c5a059]/50 bg-[#241629] p-2 shadow-lg" aria-label="Scanned books pages">
                      <button type="button" aria-label="Previous scanned books page" style={{ display: 'inline-flex', visibility: 'visible', minHeight: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', padding: '8px 6px', border: '1px solid #94738b', borderRadius: 12, backgroundColor: '#50354f', color: '#fff1f7', fontWeight: 700, opacity: safeScannerReviewPage <= 1 ? 0.45 : 1 }} disabled={safeScannerReviewPage <= 1} onClick={() => setScannerReviewPage((page) => Math.max(1, page - 1))}>← Previous</button>
                      <span className="min-w-0 text-center text-xs font-semibold text-[#d7c7d7]" aria-live="polite">Page {safeScannerReviewPage} of {scannerReviewPageCount}</span>
                      <button type="button" aria-label="Next scanned books page" style={{ display: 'inline-flex', visibility: 'visible', minHeight: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', padding: '8px 12px', border: '1px solid #94738b', borderRadius: 12, backgroundColor: '#50354f', color: '#fff1f7', fontWeight: 700, opacity: safeScannerReviewPage >= scannerReviewPageCount ? 0.45 : 1 }} disabled={safeScannerReviewPage >= scannerReviewPageCount} onClick={() => setScannerReviewPage((page) => Math.min(scannerReviewPageCount, page + 1))}>Next →</button>
                    </nav>
                  )}
                  <p className="mt-4 text-center text-xs font-semibold text-[#ad9fac]" aria-live="polite">Showing {((safeScannerReviewPage - 1) * scannerReviewPageSize) + 1}–{Math.min(safeScannerReviewPage * scannerReviewPageSize, scannedBooks.length)} of {scannedBooks.length} scanned books.</p>
                </>
              )}

              <div className="mt-5">
                <Field label="Add scanned books to">
                  <select value={scannerCategory} onChange={(event) => setScannerCategory(event.target.value as ReadingStatusSelection)}>
                    {ADD_TO_LIST_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    {customReadingStatuses.length > 0 && <optgroup label="Custom statuses">{customReadingStatuses.map((customStatus) => <option key={customStatus.id} value={`custom:${customStatus.id}`}>{customStatus.name}</option>)}</optgroup>}
                  </select>
                </Field>
              </div>

              <button type="button" onClick={addScannedBatch} disabled={scannedBooks.length === 0 || scannerBusy} className="quiet-shelf-primary-action mt-3 w-full justify-center disabled:opacity-40"><Check className="h-4 w-4" /> Save {scannedBooks.length || ''} Book{scannedBooks.length === 1 ? '' : 's'} to {readingStatusSelectionLabel(scannerCategory)}</button>
            </section>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title *"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" /></Field>
              <Field label="Author / creator *"><input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Author or creator" /></Field>
              {unresolvedIsbn && <div className="rounded-xl border border-[#c5a059]/35 bg-[#c5a059]/10 p-3 text-sm text-[#e5c158] sm:col-span-2">ISBN {unresolvedIsbn} will be retained on this edition. Enter the title and author to save it.</div>}
              <Field label="Reading material"><select value={materialType} onChange={(event) => setMaterialType(event.target.value as ReadingMaterialType)}>{MATERIAL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
              <Field label="Genres"><input value={genres} onChange={(event) => setGenres(event.target.value)} placeholder="Fantasy, Romance" /></Field>
              {format !== 'audiobook' && <Field label="Page count"><input type="number" min="1" value={pageCount} onChange={(event) => setPageCount(event.target.value)} placeholder="Optional" /></Field>}
              <Field label="Format"><select value={format} onChange={(event) => setFormat(event.target.value as Format)}>{FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
              <div><Field label="Reading status"><select value={statusSelection} onChange={(event) => { if (event.target.value === '__new__') { setCreatingCustomReadingStatus(true); return; } setStatusSelection(event.target.value as ReadingStatusSelection); setCreatingCustomReadingStatus(false); }}>{READING_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}{customReadingStatuses.length > 0 && <optgroup label="Custom statuses">{customReadingStatuses.map((customStatus) => <option key={customStatus.id} value={`custom:${customStatus.id}`}>{customStatus.name}</option>)}</optgroup>}<option value="__new__">+ Create custom status…</option></select></Field>{creatingCustomReadingStatus && <div className="mt-2 flex gap-2"><input value={newCustomReadingStatusName} onChange={(event) => setNewCustomReadingStatusName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createAndSelectCustomReadingStatus(setStatusSelection); } }} placeholder="e.g. Buddy Read, Up Next" className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#c5a059]/18 bg-[#0d0910] px-3 text-sm text-[#f4efe6] outline-none" autoFocus /><button type="button" onClick={() => createAndSelectCustomReadingStatus(setStatusSelection)} disabled={!newCustomReadingStatusName.trim()} className="quiet-shelf-secondary-action px-3 disabled:opacity-50">Create</button></div>}</div>
              <div>
                <Field label="Ownership"><select value={ownershipSelection} onChange={(event) => { if (event.target.value === '__new__') { setCreatingCustomOwnership(true); return; } setOwnershipSelection(event.target.value as OwnershipSelection); setCreatingCustomOwnership(false); }}><optgroup label="Ownership">{BUILT_IN_OWNERSHIP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>{customOwnershipCategories.length > 0 && <optgroup label="Custom ownership">{customOwnershipCategories.map((category) => <option key={category.id} value={`custom:${category.id}`}>{category.name}</option>)}</optgroup>}<option value="__new__">+ Create custom ownership…</option></select></Field>
                {creatingCustomOwnership && <div className="mt-2 flex gap-2"><input value={newCustomOwnershipName} onChange={(event) => setNewCustomOwnershipName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createAndSelectCustomOwnership(); } }} placeholder="e.g. Home Library" className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#c5a059]/18 bg-[#0d0910] px-3 text-sm text-[#f4efe6] outline-none" autoFocus /><button type="button" onClick={createAndSelectCustomOwnership} disabled={!newCustomOwnershipName.trim()} className="quiet-shelf-secondary-action px-3 disabled:opacity-50">Create</button></div>}
              </div>
              <Field label="Priority"><select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>{PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            </div>
            <Field label="Summary"><textarea rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Optional description or notes" /></Field>
            <button type="button" onClick={handleManualAdd} disabled={!title.trim() || !author.trim()} className="quiet-shelf-primary-action min-h-12 w-full disabled:opacity-50">Add to Library</button>
          </div>
        )}

        {pendingSearchEdition && (
          <div className="fixed inset-0 z-[220] grid place-items-center bg-black/70 p-4">
            <section className="w-full max-w-lg rounded-2xl border border-[#c5a059]/35 bg-[#17101b] p-6">
              <div className="flex justify-between"><div><p className="inkbound-kicker">Add to your library</p><h3 className="mt-2 font-serif text-2xl text-[#f4efe6]">Which reading status?</h3><p className="mt-2 text-sm text-[#ad9fac]">{pendingSearchEdition.work.title}</p></div><button type="button" onClick={() => setPendingSearchEdition(null)} className="grid h-11 w-11 place-items-center"><X /></button></div>
              <div className="mt-4 grid gap-2">
                {ADD_TO_LIST_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => addSearchEditionToList(option.value)} className="min-h-12 rounded-xl border border-[#c5a059]/18 bg-[#120c15] px-4 py-3 text-left"><span className="block text-sm font-bold text-[#f4efe6]">{option.label}</span><span className="text-xs text-[#ad9fac]">{option.description}</span></button>)}
                {customReadingStatuses.map((customStatus) => <button key={customStatus.id} type="button" onClick={() => addSearchEditionToList(`custom:${customStatus.id}`)} className="min-h-12 rounded-xl border border-[#c5a059]/18 bg-[#120c15] px-4 py-3 text-left"><span className="block text-sm font-bold text-[#f4efe6]">{customStatus.name}</span><span className="text-xs text-[#ad9fac]">Your custom reading status.</span></button>)}
                {!creatingCustomReadingStatus ? <button type="button" onClick={() => setCreatingCustomReadingStatus(true)} className="min-h-12 rounded-xl border border-dashed border-[#c5a059]/35 bg-[#120c15] px-4 py-3 text-left text-sm font-bold text-[#e5c158]">+ Create custom status</button> : <div className="rounded-xl border border-[#c5a059]/25 bg-[#120c15] p-3"><p className="text-xs font-bold text-[#f4efe6]">Create custom reading status</p><div className="mt-2 flex gap-2"><input value={newCustomReadingStatusName} onChange={(event) => setNewCustomReadingStatusName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createAndSelectCustomReadingStatus((selection) => addSearchEditionToList(selection)); } }} placeholder="e.g. Buddy Read, Up Next" className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#c5a059]/18 bg-[#0d0910] px-3 text-sm text-[#f4efe6] outline-none" autoFocus /><button type="button" onClick={() => createAndSelectCustomReadingStatus((selection) => addSearchEditionToList(selection))} disabled={!newCustomReadingStatusName.trim()} className="quiet-shelf-secondary-action px-3 disabled:opacity-50">Create</button></div></div>}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
};

type FieldChildProps = { className?: string };

const Field: React.FC<{ label: string; children: React.ReactElement<FieldChildProps> }> = ({ label, children }) => (
  <label className="block text-sm font-semibold text-[#f4efe6]">
    <span className="mb-2 block">{label}</span>
    {React.cloneElement(children, {
      className: `min-h-11 w-full rounded-xl border border-[#c5a059]/18 bg-[#0d0910] px-3 py-2 text-sm text-[#f4efe6] outline-none placeholder:text-[#6f6370] ${children.props.className ?? ''}`,
    })}
  </label>
);
