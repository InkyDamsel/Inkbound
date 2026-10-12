import React, { FormEvent, useEffect, useRef, useState } from 'react';
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
import { isValidCatalogIsbn } from '../features/book-search/isbnResolution';
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
import { scanBarcodeWithNativeRuntime, shouldUseNativeBarcodeScanner } from '../platform/runtimeBarcodeScanner';
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
      && Array.isArray(item.book.editions));
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
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>;
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
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const scannerAudioContextRef = useRef<AudioContext | null>(null);

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
    if (scanLoopRef.current !== null) cancelAnimationFrame(scanLoopRef.current);
    scanLoopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  const playScannerSuccessFeedback = async () => {
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
    setScannerError(null);
    setScannerMessage(null);
    try {
      const resolved = await resolveCatalogIsbn(isbn);
      if (!resolved) {
        setScannerError('Inkbound checked all available catalog paths but could not identify this barcode yet.');
        return;
      }
      const { work, edition, exactIsbn } = resolved;
      if (!exactIsbn) {
        setScannerError('A catalog returned a possible title but could not verify this ISBN. Nothing was added; search by title or enter the book manually to avoid saving the wrong edition.');
        return;
      }
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
        : `Added “${work.title}” from a work-level match. Verify this edition’s page count/format before saving if needed.`);
      void playScannerSuccessFeedback();
    } catch (error) {
      setScannerError(error instanceof Error ? error.message : 'ISBN lookup failed. Please try again.');
    } finally {
      setScannerBusy(false);
    }
  };

  const startCamera = async () => {
    setScannerError(null);
    setScannerMessage(null);

    if (shouldUseNativeBarcodeScanner()) {
      try {
        const raw = await scanBarcodeWithNativeRuntime();
        if (raw) await lookupScannedIsbn(raw);
      } catch (error) {
        setScannerError(error instanceof Error ? error.message : 'Inkbound could not open the barcode scanner.');
      }
      return;
    }

    const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector) {
      setScannerError('Barcode scanning is not supported in this browser. You can still enter the ISBN manually.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      detectorRef.current = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraActive(true);

      const scanFrame = async () => {
        if (!videoRef.current || !detectorRef.current || !streamRef.current) return;
        try {
          const codes = await detectorRef.current.detect(videoRef.current);
          const raw = codes.find((code) => code.rawValue)?.rawValue;
          if (raw) {
            stopCamera();
            await lookupScannedIsbn(raw);
            return;
          }
        } catch {
          // Keep scanning; transient detector errors should not end the camera session.
        }
        scanLoopRef.current = requestAnimationFrame(scanFrame);
      };
      scanLoopRef.current = requestAnimationFrame(scanFrame);
    } catch (error) {
      stopCamera();
      setScannerError(error instanceof Error ? error.message : 'Inkbound could not open the camera.');
    }
  };

  const addScannedBatch = async () => {
    if (scannedBooks.length === 0 || scannerBusy) return;
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
      setScannedBooks([]);
      setScannerReviewPage(1);
      stopCamera();
      // Keep the scanned ISBN draft as an independent recovery copy. Cloud
      // upload is asynchronous and must not be mistaken for a confirmed save.
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
          setResults(mergeCatalogResultGroups(exactAuthorResults, response.groups));
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
    <div className="fixed inset-0 z-[200] flex items-end justify-center overflow-hidden bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="relative min-w-0 max-h-[100dvh] w-full max-w-5xl overflow-x-hidden overflow-y-auto overscroll-contain rounded-t-3xl border border-[#c5a059]/40 bg-[#17101b] px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-7" role="dialog" aria-modal="true" aria-labelledby="add-book-title">
        <button type="button" onClick={onClose} className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-black/30 text-[#ad9fac]" aria-label="Close add reading material dialog"><X className="h-5 w-5" /></button>

        <header className="pr-12">
          <p className="inkbound-kicker">Build your library</p>
          <h2 id="add-book-title" className="mt-2 font-serif text-3xl text-[#f4efe6]">Add Reading Material</h2>
          <p className="mt-2 text-sm text-[#ad9fac]">Search, scan a stack of books, or add something manually.</p>
        </header>

        <div className="mt-6 grid min-w-0 grid-cols-3 gap-1 rounded-xl border border-[#3d2448] bg-[#0d0910] p-1">
          <button type="button" onClick={() => setActiveTab('search')} className={`min-h-11 min-w-0 rounded-lg px-1 text-xs font-semibold sm:px-3 sm:text-sm ${activeTab === 'search' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac]'}`}>Search</button>
          <button type="button" onClick={() => { setActiveTab('scan'); setAuthorPage(null); }} className={`min-h-11 min-w-0 rounded-lg px-1 text-xs font-semibold sm:px-3 sm:text-sm ${activeTab === 'scan' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac]'}`}>Scan Books</button>
          <button type="button" onClick={() => { setActiveTab('manual'); setAuthorPage(null); }} className={`min-h-11 min-w-0 rounded-lg px-1 text-xs font-semibold sm:px-3 sm:text-sm ${activeTab === 'manual' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac]'}`}>Add Manually</button>
        </div>

        {activeTab === 'search' ? (
          <div className="mt-6 space-y-5">
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
          <div className="mt-6 space-y-5">
            <section className="rounded-2xl border border-[#c5a059]/25 bg-[#120c15] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="inkbound-kicker">Stack scanner</p>
                  <h3 className="mt-1 font-serif text-2xl text-[#f4efe6]">Scan as many as you want</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[#ad9fac]">Nothing is added to your Inkbound library while you scan. Review the stack first, then choose the reading list for the whole batch.</p>
                </div>
                <div className="rounded-full border border-[#c5a059]/25 px-3 py-2 text-sm font-bold text-[#e5c158]">{scannedBooks.length} ready</div>
              </div>

              <div className="relative mt-5 aspect-[4/3] max-h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-black">
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

              <form onSubmit={(event) => { event.preventDefault(); void lookupScannedIsbn(manualIsbn); }} className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input value={manualIsbn} onChange={(event) => setManualIsbn(event.target.value)} inputMode="numeric" placeholder="Or enter an ISBN" className="inkbound-select min-h-11 min-w-0 flex-1" />
                <button type="submit" disabled={!manualIsbn.trim() || scannerBusy} className="quiet-shelf-secondary-action justify-center disabled:opacity-50">{scannerBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Add ISBN</button>
              </form>

              {scannerMessage && <p className="mt-3 text-sm text-[#d7c7d7]">{scannerMessage}</p>}
              {scannerError && <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{scannerError}</p>}
            </section>

            <section className="min-w-0 rounded-2xl border border-[#3d2448] bg-[#1d1422] p-3 sm:p-5">
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
                    <nav className="mt-4 flex items-center justify-center gap-4" aria-label="Scanned books pages">
                      <button type="button" className="quiet-shelf-secondary-action min-h-11 px-4 disabled:opacity-40" disabled={safeScannerReviewPage <= 1} onClick={() => setScannerReviewPage((page) => Math.max(1, page - 1))}>Previous</button>
                      <span className="text-sm text-[#ad9fac]">Page {safeScannerReviewPage} of {scannerReviewPageCount}</span>
                      <button type="button" className="quiet-shelf-secondary-action min-h-11 px-4 disabled:opacity-40" disabled={safeScannerReviewPage >= scannerReviewPageCount} onClick={() => setScannerReviewPage((page) => Math.min(scannerReviewPageCount, page + 1))}>Next</button>
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
