import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Camera, Check, Loader2, ScanLine, Search, Trash2, UserRound, X } from 'lucide-react';
import {
  FORMAT_OPTIONS,
  MATERIAL_TYPE_OPTIONS,
  OWNERSHIP_OPTIONS,
  PRIORITY_OPTIONS,
  READING_STATUS_OPTIONS,
} from '../domain/libraryTaxonomy';
import { searchGoogleBooks, searchGoogleBooksAuthorPage, searchGoogleBooksPage } from '../features/book-search/data/googleBooksApi';
import { createBookFromSearchEdition } from '../features/book-search/mapping/bookSearchMapper';
import { hardenCatalogGroups, isValidCatalogIsbn10, isValidCatalogIsbn13 } from '../features/book-search/catalogHardening';
import type { BookSearchEdition, BookSearchWorkGroup } from '../features/book-search/model/bookSearch';
import {
  CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT,
  createCustomOwnershipCategory,
  readCustomOwnershipCategories,
  type CustomOwnershipCategory,
} from '../features/ownership/customOwnershipCategories';
import { withReadingStatus } from '../features/reading/bookReadingState';
import { notifyCloudDataUpdated } from '../features/sync/cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from '../features/sync/storageKeys';
import { getRuntimeStorage, readRuntimeJson, writeRuntimeJson } from '../platform/runtimeStorage';
import type { Format, OwnershipStatus, Priority, ReadingMaterialType, ReadingStatus, UserBookRecord } from '../types';
import { CanonicalInput } from './form/CanonicalInput';

interface AddBookModalProps {
  currentBookCount: number;
  onClose: () => void;
  onAddBook: (newBook: UserBookRecord) => void;
  onAddMultipleBooks?: (newBooks: UserBookRecord[]) => void;
}

type AddBookTab = 'search' | 'scan' | 'manual';
type PendingSearchEdition = { work: BookSearchWorkGroup; edition: BookSearchEdition };
type CustomCategorySelection = `custom:${string}`;
type CategorySelection = ReadingStatus | CustomCategorySelection;
type ScannedBook = { isbn: string; book: UserBookRecord };
type IsbnInputSource = 'camera' | 'manual';
type AuthorPageState = {
  name: string;
  previousQuery: string;
  previousResults: BookSearchWorkGroup[];
  previousHasSearched: boolean;
  previousSearchNextStartIndex: number;
  previousSearchProviderTotal: number | null;
  previousSearchHasMore: boolean;
};

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const ADD_TO_LIST_OPTIONS = READING_STATUS_OPTIONS;
const SCANNER_REVIEW_PAGE_SIZE = 6;
const SCANNER_DRAFT_STORAGE_KEY = 'inkbound_scanner_review_draft_v1';
const BOOKS_STORAGE_KEY = SYNC_STORAGE_KEYS.books;

const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
const uniqueId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const isCustomCategorySelection = (selection: CategorySelection): selection is CustomCategorySelection => selection.startsWith('custom:');
const categoryStatus = (selection: CategorySelection): ReadingStatus => isCustomCategorySelection(selection) ? 'custom' : selection;
const categoryId = (selection: CategorySelection): string | undefined => isCustomCategorySelection(selection) ? selection.slice('custom:'.length) : undefined;
const normalizeIsbn = (value: string) => value.replace(/[^0-9Xx]/g, '').toUpperCase();
const editionIsbnValues = (edition: BookSearchEdition) => [edition.isbn13, edition.isbn10].map((value) => normalizeIsbn(value ?? '')).filter(Boolean);
const searchEditionKey = (work: BookSearchWorkGroup, edition: BookSearchEdition) => `${work.key}:${edition.source}:${edition.externalEditionId}`;
const statusLabel = (status: ReadingStatus) => READING_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
const normalizeAuthorName = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normalizeCatalogText = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const filterExactAuthorResults = (groups: BookSearchWorkGroup[], authorName: string) => {
  const normalizedAuthor = normalizeAuthorName(authorName);
  return groups.filter((work) =>
    work.authors.some((candidate) => normalizeAuthorName(candidate) === normalizedAuthor),
  );
};

const sameCatalogEdition = (left: BookSearchEdition, right: BookSearchEdition) => {
  if (left.source === right.source && left.externalEditionId === right.externalEditionId) return true;
  const leftIsbns = editionIsbnValues(left);
  const rightIsbns = new Set(editionIsbnValues(right));
  return leftIsbns.some((isbn) => rightIsbns.has(isbn));
};

const mergeCatalogResultGroups = (current: BookSearchWorkGroup[], incoming: BookSearchWorkGroup[], searchQuery?: string, preferredAuthor?: string) => {
  const merged = current.map((group) => ({ ...group, genres: [...group.genres], editions: [...group.editions] }));
  const byIdentity = new Map<string, BookSearchWorkGroup>();
  merged.forEach((group) => {
    byIdentity.set(`${normalizeCatalogText(group.title)}::${normalizeAuthorName(group.authors[0] ?? '')}`, group);
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
      if (!existing.editions.some((candidate) => sameCatalogEdition(candidate, edition))) existing.editions.push(edition);
    });
    existing.genres = [...new Set([...existing.genres, ...group.genres])].slice(0, 16);
    if (!existing.publisherSummary && group.publisherSummary) existing.publisherSummary = group.publisherSummary;
  });

  return hardenCatalogGroups(merged, { searchQuery, preferredAuthor });
};

const isValidIsbn = (value: string) => isValidCatalogIsbn10(value) || isValidCatalogIsbn13(value);

function readScannerDraft(): ScannedBook[] {
  try {
    const raw = getRuntimeStorage().getItem(SCANNER_DRAFT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ScannedBook[] : [];
  } catch {
    return [];
  }
}

function persistScannerDraft(items: ScannedBook[]) {
  try {
    const storage = getRuntimeStorage();
    if (items.length === 0) storage.removeItem(SCANNER_DRAFT_STORAGE_KEY);
    else storage.setItem(SCANNER_DRAFT_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Draft persistence is a best-effort local safety net. Library saves still use canonical persistence.
  }
}

export const AddBookModal: React.FC<AddBookModalProps> = ({ onClose, onAddBook, onAddMultipleBooks }) => {
  const [activeTab, setActiveTab] = useState<AddBookTab>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookSearchWorkGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [pendingSearchEdition, setPendingSearchEdition] = useState<PendingSearchEdition | null>(null);
  const [addedSearchBooks, setAddedSearchBooks] = useState<Map<string, UserBookRecord>>(() => new Map());
  const [searchNextStartIndex, setSearchNextStartIndex] = useState(0);
  const [searchProviderTotal, setSearchProviderTotal] = useState<number | null>(null);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [isLoadingSearchMore, setIsLoadingSearchMore] = useState(false);
  const [authorPage, setAuthorPage] = useState<AuthorPageState | null>(null);
  const [authorNextStartIndex, setAuthorNextStartIndex] = useState(0);
  const [authorProviderTotal, setAuthorProviderTotal] = useState<number | null>(null);
  const [authorHasMore, setAuthorHasMore] = useState(false);
  const [isLoadingAuthorMore, setIsLoadingAuthorMore] = useState(false);
  const [customCategories, setCustomCategories] = useState<CustomOwnershipCategory[]>(() => readCustomOwnershipCategories());
  const [creatingCustomCategory, setCreatingCustomCategory] = useState(false);
  const [newCustomCategoryName, setNewCustomCategoryName] = useState('');

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [summary, setSummary] = useState('');
  const [genres, setGenres] = useState('');
  const [pageCount, setPageCount] = useState('');
  const [format, setFormat] = useState<Format>('hardcover');
  const [materialType, setMaterialType] = useState<ReadingMaterialType>('book');
  const [category, setCategory] = useState<CategorySelection>('tbr');
  const [ownership, setOwnership] = useState<OwnershipStatus>('owned');
  const [priority, setPriority] = useState<Priority>('medium');

  const [scannedBooks, setScannedBooks] = useState<ScannedBook[]>(readScannerDraft);
  const [scannerReviewPage, setScannerReviewPage] = useState(1);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [scanLookupBusy, setScanLookupBusy] = useState(false);
  const [manualIsbn, setManualIsbn] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const lastDetectedRef = useRef<{ value: string; at: number } | null>(null);
  const lookupBusyRef = useRef(false);
  const scannedBooksRef = useRef<ScannedBook[]>([]);

  useEffect(() => {
    scannedBooksRef.current = scannedBooks;
    persistScannerDraft(scannedBooks);
  }, [scannedBooks]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(scannedBooks.length / SCANNER_REVIEW_PAGE_SIZE));
    setScannerReviewPage((current) => Math.min(current, totalPages));
  }, [scannedBooks.length]);

  const stopCamera = () => {
    if (scanLoopRef.current !== null) cancelAnimationFrame(scanLoopRef.current);
    scanLoopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  useEffect(() => () => stopCamera(), []);
  useEffect(() => { if (activeTab !== 'scan') stopCamera(); }, [activeTab]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pendingSearchEdition) { setPendingSearchEdition(null); return; }
      if (authorPage) {
        setQuery(authorPage.previousQuery);
        setResults(authorPage.previousResults);
        setHasSearched(authorPage.previousHasSearched);
        setSearchNextStartIndex(authorPage.previousSearchNextStartIndex);
        setSearchProviderTotal(authorPage.previousSearchProviderTotal);
        setSearchHasMore(authorPage.previousSearchHasMore);
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
    const refresh = () => setCustomCategories(readCustomOwnershipCategories());
    window.addEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
  }, []);

  const createAndSelectCustomCategory = () => {
    const created = createCustomOwnershipCategory(newCustomCategoryName);
    if (!created) return;
    setCustomCategories(readCustomOwnershipCategories());
    setCategory(`custom:${created.id}`);
    setNewCustomCategoryName('');
    setCreatingCustomCategory(false);
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
    setSearchNextStartIndex(0);
    setSearchProviderTotal(null);
    setSearchHasMore(false);
    setIsLoadingSearchMore(false);
    setIsSearching(true);
    setSearchError(null);
    setHasSearched(true);
    setPendingSearchEdition(null);
    try {
      let googlePage = null;
      try {
        googlePage = await searchGoogleBooksPage(trimmedQuery, 0);
      } catch (error) {
        console.warn('Paged Google Books search unavailable; falling back to the standard catalog chain.', error);
      }

      if (googlePage && googlePage.groups.length > 0) {
        setResults(googlePage.groups);
        setSearchNextStartIndex(googlePage.nextStartIndex);
        setSearchProviderTotal(googlePage.providerTotalItems || null);
        setSearchHasMore(googlePage.hasMore);
      } else {
        const response = await searchGoogleBooks(trimmedQuery);
        setResults(response.groups);
        setSearchNextStartIndex(0);
        setSearchProviderTotal(null);
        setSearchHasMore(false);
      }
    } catch (error) {
      setResults([]);
      setSearchError(error instanceof Error ? error.message : 'Reading-material search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const loadMoreSearchResults = async () => {
    const trimmedQuery = query.trim();
    if (authorPage || !trimmedQuery || !searchHasMore || isLoadingSearchMore) return;
    setIsLoadingSearchMore(true);
    setSearchError(null);
    try {
      const response = await searchGoogleBooksPage(trimmedQuery, searchNextStartIndex);
      setResults((current) => mergeCatalogResultGroups(current, response.groups, trimmedQuery));
      setSearchNextStartIndex(response.nextStartIndex);
      setSearchProviderTotal(response.providerTotalItems || searchProviderTotal);
      setSearchHasMore(response.hasMore && response.nextStartIndex > searchNextStartIndex);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Could not load more search results. Please try again.');
    } finally {
      setIsLoadingSearchMore(false);
    }
  };

  const openAuthorPage = async (authorName: string) => {
    if (isSearching) return;
    const previousState: AuthorPageState = {
      name: authorName,
      previousQuery: query,
      previousResults: results,
      previousHasSearched: hasSearched,
      previousSearchNextStartIndex: searchNextStartIndex,
      previousSearchProviderTotal: searchProviderTotal,
      previousSearchHasMore: searchHasMore,
    };
    setAuthorPage(previousState);
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
      setResults(exactAuthorResults);
      setAuthorNextStartIndex(response.nextStartIndex);
      setAuthorProviderTotal(response.providerTotalItems || null);
      setAuthorHasMore(response.hasMore);
    } catch (error) {
      setResults([]);
      setAuthorHasMore(false);
      setSearchError(error instanceof Error ? error.message : 'Author catalog search failed. Please try again.');
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
      setResults((current) => mergeCatalogResultGroups(current, exactAuthorResults, undefined, authorPage.name));
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
    setSearchNextStartIndex(authorPage.previousSearchNextStartIndex);
    setSearchProviderTotal(authorPage.previousSearchProviderTotal);
    setSearchHasMore(authorPage.previousSearchHasMore);
    setSearchError(null);
    setAuthorPage(null);
    setAuthorNextStartIndex(0);
    setAuthorProviderTotal(null);
    setAuthorHasMore(false);
    setIsLoadingAuthorMore(false);
  };

  const storeAddedSearchBook = (work: BookSearchWorkGroup, edition: BookSearchEdition, book: UserBookRecord) => {
    const key = searchEditionKey(work, edition);
    setAddedSearchBooks((current) => {
      const next = new Map(current);
      next.set(key, book);
      return next;
    });
  };

  const removeStoredSearchBook = (work: BookSearchWorkGroup, edition: BookSearchEdition) => {
    const key = searchEditionKey(work, edition);
    const addedBook = addedSearchBooks.get(key);
    if (!addedBook) return;

    const currentBooks = readRuntimeJson<UserBookRecord[]>(BOOKS_STORAGE_KEY, []);
    const nextBooks = currentBooks.filter((book) => book.id !== addedBook.id);
    if (!writeRuntimeJson(BOOKS_STORAGE_KEY, nextBooks)) return;

    notifyCloudDataUpdated([BOOKS_STORAGE_KEY]);
    setAddedSearchBooks((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };

  const replaceStoredSearchBook = (work: BookSearchWorkGroup, edition: BookSearchEdition, book: UserBookRecord) => {
    const currentBooks = readRuntimeJson<UserBookRecord[]>(BOOKS_STORAGE_KEY, []);
    const nextBooks = currentBooks.map((candidate) => candidate.id === book.id ? book : candidate);
    if (!writeRuntimeJson(BOOKS_STORAGE_KEY, nextBooks)) return;
    notifyCloudDataUpdated([BOOKS_STORAGE_KEY]);
    storeAddedSearchBook(work, edition, book);
  };

  const chooseSearchEdition = (work: BookSearchWorkGroup, edition: BookSearchEdition) => {
    setPendingSearchEdition({ work, edition });
  };

  const quickAddSearchEdition = (work: BookSearchWorkGroup, edition: BookSearchEdition) => {
    const key = searchEditionKey(work, edition);
    if (addedSearchBooks.has(key)) return;
    const book = createBookFromSearchEdition({ work, edition, status: 'tbr' });
    onAddBook(book);
    storeAddedSearchBook(work, edition, book);
  };

  const addSearchEditionToList = (selection: CategorySelection) => {
    if (!pendingSearchEdition) return;
    const { work, edition } = pendingSearchEdition;
    const key = searchEditionKey(work, edition);
    const customCategoryId = categoryId(selection);
    const status = categoryStatus(selection);
    const existing = addedSearchBooks.get(key);

    if (existing) {
      const updated = {
        ...withReadingStatus(existing, status),
        customOwnershipCategoryId: customCategoryId,
      };
      replaceStoredSearchBook(work, edition, updated);
    } else {
      const book = {
        ...createBookFromSearchEdition({ work, edition, status }),
        customOwnershipCategoryId: customCategoryId,
      };
      onAddBook(book);
      storeAddedSearchBook(work, edition, book);
    }

    setPendingSearchEdition(null);
  };

  const resolveScannedIsbn = async (rawValue: string, source: IsbnInputSource = 'manual') => {
    const isbn = normalizeIsbn(rawValue);
    if (!isValidIsbn(isbn)) {
      setScannerError(source === 'manual' ? 'Enter a valid ISBN-10 or ISBN-13. ISBN-13 barcodes begin with 978 or 979.' : null);
      if (source === 'camera') setScannerMessage('Barcode detected, but it is not an ISBN. Aim at the 978/979 ISBN barcode.');
      return;
    }
    if (scannedBooksRef.current.some((item) => item.isbn === isbn)) {
      setScannerMessage('Already scanned — it is still in your review list.');
      return;
    }
    if (lookupBusyRef.current) return;
    lookupBusyRef.current = true;
    setScanLookupBusy(true);
    setScannerError(null);
    setScannerMessage(`ISBN ${isbn} detected — looking it up…`);
    try {
      const response = await searchGoogleBooks(isbn);
      const candidates = response.groups.flatMap((work) => work.editions.map((edition) => ({ work, edition })));
      const exact = candidates.find(({ edition }) => editionIsbnValues(edition).includes(isbn));
      const match = exact ?? candidates[0];
      if (!match) {
        setScannerError(`Inkbound could not find a book for ISBN ${isbn}. You can keep scanning and add this one manually later.`);
        return;
      }
      const book = createBookFromSearchEdition({ work: match.work, edition: match.edition, status: 'tbr' });
      const staged: ScannedBook = { isbn, book: { ...book, status: 'tbr', dateStarted: undefined, dateFinished: undefined } };
      setScannedBooks((current) => {
        const next = [...current, staged];
        setScannerReviewPage(Math.ceil(next.length / SCANNER_REVIEW_PAGE_SIZE));
        return next;
      });
      setScannerMessage(`Added “${match.work.title}” to review. Keep scanning.`);
    } catch (error) {
      setScannerError(error instanceof Error ? error.message : 'Inkbound could not look up that ISBN.');
    } finally {
      lookupBusyRef.current = false;
      setScanLookupBusy(false);
    }
  };

  const scanFrame = async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || !streamRef.current) return;
    try {
      if (!lookupBusyRef.current && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const detected = await detector.detect(video);
        const detectedValues = detected.map((result) => result.rawValue).filter((value): value is string => Boolean(value));
        const normalizedValues = detectedValues.map(normalizeIsbn);
        const isbn = normalizedValues.find(isValidIsbn);
        if (isbn) {
          const recent = lastDetectedRef.current;
          if (!recent || recent.value !== isbn || Date.now() - recent.at > 2500) {
            lastDetectedRef.current = { value: isbn, at: Date.now() };
            void resolveScannedIsbn(isbn, 'camera');
          }
        } else if (normalizedValues.length > 0) {
          const firstBarcode = normalizedValues[0];
          const recent = lastDetectedRef.current;
          if (!recent || recent.value !== firstBarcode || Date.now() - recent.at > 2500) {
            lastDetectedRef.current = { value: firstBarcode, at: Date.now() };
            setScannerError(null);
            setScannerMessage('Barcode detected, but it is not an ISBN. Aim at the 978/979 ISBN barcode.');
          }
        }
      }
    } catch {
      // Individual frame failures are harmless; keep scanning.
    }
    scanLoopRef.current = requestAnimationFrame(() => void scanFrame());
  };

  const startCamera = async () => {
    setScannerError(null);
    const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector) {
      setScannerError('Live barcode scanning is not available in this browser. You can still enter ISBNs below.');
      return;
    }
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      detectorRef.current = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setScannerMessage('Camera ready. Scan the ISBN barcode on the back of a book.');
      scanLoopRef.current = requestAnimationFrame(() => void scanFrame());
    } catch (error) {
      stopCamera();
      setScannerError(error instanceof Error ? error.message : 'Inkbound could not open the camera.');
    }
  };

  const addManualIsbn = (event: FormEvent) => {
    event.preventDefault();
    const value = manualIsbn.trim();
    if (!value) return;
    setManualIsbn('');
    void resolveScannedIsbn(value, 'manual');
  };

  const saveScannedBooks = () => {
    if (scannedBooks.length === 0) return;
    const books = scannedBooks.map((item) => ({ ...item.book, status: 'tbr' as const, dateStarted: undefined, dateFinished: undefined }));
    if (onAddMultipleBooks) onAddMultipleBooks(books);
    else books.forEach(onAddBook);
    setScannedBooks([]);
    setScannerReviewPage(1);
    stopCamera();
    onClose();
  };

  const handleManualAdd = () => {
    if (!title.trim() || !author.trim()) return;
    const workId = uniqueId('work');
    const editionId = uniqueId('edition');
    const bookId = uniqueId('book');
    const parsedPageCount = Number.parseInt(pageCount, 10);
    const validPageCount = Number.isFinite(parsedPageCount) && parsedPageCount > 0 ? parsedPageCount : undefined;
    const hasKnownPrintTotal = format !== 'audiobook' && validPageCount !== undefined;
    const selectedStatus = categoryStatus(category);
    const selectedCustomCategoryId = categoryId(category);
    const isFinished = selectedStatus === 'finished';
    const addedOn = today();
    const newBook: UserBookRecord = {
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
      status: selectedStatus,
      ownership,
      customOwnershipCategoryId: selectedCustomCategoryId,
      progressPages: isFinished && hasKnownPrintTotal ? validPageCount! : 0,
      progressMinutes: 0,
      progressPercentage: isFinished && hasKnownPrintTotal ? 100 : 0,
      favoriteQuotes: [],
      privateTags: [],
      priority,
      moods: [],
      collections: [],
      sourceOfImport: 'Manual entry',
      dateAdded: addedOn,
      dateStarted: selectedStatus === 'currently-reading' || isFinished ? addedOn : undefined,
      dateFinished: isFinished ? addedOn : undefined,
    };
    onAddBook(newBook);
    onClose();
  };

  const scannerReviewTotalPages = Math.max(1, Math.ceil(scannedBooks.length / SCANNER_REVIEW_PAGE_SIZE));
  const scannerReviewStart = (scannerReviewPage - 1) * SCANNER_REVIEW_PAGE_SIZE;
  const scannerReviewBooks = scannedBooks.slice(scannerReviewStart, scannerReviewStart + SCANNER_REVIEW_PAGE_SIZE);

  const renderSearchResults = () => results.length > 0 && (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {results.map((work) => (
        <article key={work.key} className="flex min-w-0 flex-col rounded-2xl border border-[#c5a059]/18 bg-[#1d1422] p-4">
          <div className="min-w-0">
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
          </div>
          <div className="mt-4 grid gap-3">
            {work.editions.map((edition) => {
              const key = searchEditionKey(work, edition);
              const addedBook = addedSearchBooks.get(key);
              const added = Boolean(addedBook);
              return (
                <div key={edition.externalEditionId} className={`flex min-h-36 gap-3 rounded-xl border p-3 ${added ? 'border-[#c5a059]/35 bg-[#17131b]' : 'border-white/7 bg-[#120c15]'}`}>
                  {edition.coverUrl ? <img src={edition.coverUrl} alt="" className="h-28 w-20 shrink-0 rounded object-cover" /> : <span className="grid h-28 w-20 shrink-0 place-items-center rounded bg-gradient-to-br from-[#5c3d62] to-[#171117]"><BookOpen /></span>}
                  <div className="flex min-w-0 flex-1 flex-col text-xs text-[#ad9fac]">
                    <strong className="block text-[#f4efe6]">{FORMAT_OPTIONS.find((option) => option.value === edition.format)?.label ?? edition.format}</strong>
                    {typeof edition.pageCount === 'number' && edition.pageCount > 0 ? <span className="mt-1 block">{edition.pageCount} pages</span> : <span className="mt-1 block text-[#776b78]">Page count unavailable</span>}
                    <div className="mt-auto pt-3">
                      {addedBook ? (
                        <div className="rounded-xl border border-[#c5a059]/20 bg-[#1d1720] px-3 py-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 font-semibold text-[#e5c158]"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#c5a059]/15"><Check className="h-3.5 w-3.5" /></span><span>In your library</span></div>
                              <p className="mt-1.5 pl-8 text-[11px] font-medium text-[#bcaebe]">{statusLabel(addedBook.status)}</p>
                            </div>
                            <button type="button" onClick={() => removeStoredSearchBook(work, edition)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-[#8f8290] transition hover:border-rose-400/50 hover:bg-rose-500/10 hover:text-rose-300 focus:border-rose-400/50 focus:text-rose-300" aria-label={`Remove ${work.title} from your library`} title="Remove from library"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                          <button type="button" onClick={() => chooseSearchEdition(work, edition)} className="mt-2 min-h-8 w-full rounded-lg border border-[#c5a059]/15 bg-[#120c15]/70 px-2 text-[11px] font-bold text-[#d8c28b] transition hover:border-[#c5a059]/35 hover:bg-[#c5a059]/5">Change list</button>
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
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="relative max-h-[100dvh] w-full max-w-5xl overflow-y-auto overscroll-contain rounded-t-3xl border border-[#c5a059]/40 bg-[#17101b] px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-7" role="dialog" aria-modal="true" aria-labelledby="add-book-title">
        <button type="button" onClick={onClose} className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-black/30 text-[#ad9fac]" aria-label="Close add reading material dialog"><X className="h-5 w-5" /></button>
        <header className="pr-12">
          <p className="inkbound-kicker">Build your library</p>
          <h2 id="add-book-title" className="mt-2 font-serif text-3xl text-[#f4efe6]">Add Reading Material</h2>
          <p className="mt-2 text-sm text-[#ad9fac]">Search, scan a stack of books, or add something manually.</p>
        </header>

        <div className="mt-6 grid grid-cols-3 gap-1 rounded-xl border border-[#3d2448] bg-[#0d0910] p-1">
          {([['search', 'Search'], ['scan', 'Scan Books'], ['manual', 'Add Manually']] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => { setActiveTab(id); if (id !== 'search') setAuthorPage(null); }} className={`min-h-11 rounded-lg px-2 text-sm font-semibold ${activeTab === id ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac]'}`}>{label}</button>
          ))}
        </div>

        {activeTab === 'scan' ? (
          <div className="mt-6 space-y-5">
            <section className="rounded-2xl border border-[#c5a059]/25 bg-[#120c15] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="inkbound-kicker">Stack scanner</p>
                  <h3 className="mt-1 font-serif text-2xl text-[#f4efe6]">Scan as many as you want</h3>
                  <p className="mt-2 max-w-2xl text-sm text-[#ad9fac]">Nothing is added to your Inkbound library while you scan. Your review stack stays saved on this device until you save or clear it. When you are finished, save the whole stack to your TBR.</p>
                </div>
                <div className="rounded-full border border-[#c5a059]/25 px-3 py-2 text-sm font-bold text-[#e5c158]">{scannedBooks.length} ready</div>
              </div>
              <div className="relative mt-5 max-h-[420px] aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-black">
                <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
                <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-[#e5c158]/80"><span className="absolute left-1/2 top-1/2 w-3/4 -translate-x-1/2 border-t border-[#e5c158]/70" /></div>
                {!cameraActive && (
                  <div className="absolute inset-0 grid place-items-center bg-[#120817]/90 text-center">
                    <div>
                      <Camera className="mx-auto h-10 w-10 text-[#c5a059]" />
                      <p className="mt-3 text-sm text-[#ad9fac]">Use your camera to scan the ISBN barcode.</p>
                      <button type="button" onClick={() => void startCamera()} className="quiet-shelf-primary-action mt-4"><ScanLine className="h-4 w-4" /> Start Scanner</button>
                    </div>
                  </div>
                )}
              </div>
              {cameraActive && <div className="mt-3 flex justify-end"><button type="button" onClick={stopCamera} className="quiet-shelf-secondary-action">Stop Camera</button></div>}
              <form onSubmit={addManualIsbn} className="mt-4 flex flex-col gap-2 sm:flex-row">
                <CanonicalInput value={manualIsbn} onValueChange={setManualIsbn} inputMode="numeric" placeholder="Or enter an ISBN" className="inkbound-select min-w-0 flex-1" />
                <button type="submit" disabled={!manualIsbn.trim() || scanLookupBusy} className="quiet-shelf-secondary-action justify-center disabled:opacity-50">{scanLookupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Add ISBN</button>
              </form>
              {scannerMessage && <p className="mt-3 text-sm text-[#d7c7d7]">{scannerMessage}</p>}
              {scannerError && <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{scannerError}</p>}
            </section>

            <section className="rounded-2xl border border-[#3d2448] bg-[#1d1422] p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div><p className="inkbound-kicker">Review before saving</p><h3 className="mt-1 font-serif text-2xl text-[#f4efe6]">Scanned books</h3></div>
                {scannedBooks.length > 0 && <button type="button" onClick={() => { setScannedBooks([]); setScannerReviewPage(1); }} className="text-xs font-bold text-rose-300">Clear all</button>}
              </div>
              {scannedBooks.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-[#c5a059]/20 px-5 py-10 text-center text-sm text-[#ad9fac]">Your scanned books will collect here until you are ready to save them.</div>
              ) : (
                <>
                  <div className="mt-4 space-y-3">
                    {scannerReviewBooks.map((item) => {
                      const edition = item.book.editions.find((entry) => entry.id === item.book.activeEditionId) ?? item.book.editions[0];
                      return (
                        <article key={`${item.isbn}-${item.book.id}`} className="flex items-center gap-3 rounded-xl border border-white/8 bg-[#120c15] p-3">
                          {edition?.coverUrl ? <img src={edition.coverUrl} alt="" className="h-20 w-14 shrink-0 rounded object-cover" /> : <span className="grid h-20 w-14 shrink-0 place-items-center rounded bg-gradient-to-br from-[#5c3d62] to-[#171117]"><BookOpen className="h-5 w-5" /></span>}
                          <div className="min-w-0 flex-1"><p className="truncate font-semibold text-[#f4efe6]">{item.book.work.title}</p><p className="truncate text-xs text-[#ad9fac]">{item.book.work.author}</p><p className="mt-1 text-[11px] text-[#8f8290]">ISBN {item.isbn} · TBR</p></div>
                          <button type="button" onClick={() => setScannedBooks((current) => current.filter((candidate) => candidate !== item))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-rose-300" aria-label={`Remove ${item.book.work.title}`}><Trash2 className="h-4 w-4" /></button>
                        </article>
                      );
                    })}
                  </div>
                  {scannerReviewTotalPages > 1 && (
                    <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-[#120c15] p-2">
                      <button type="button" onClick={() => setScannerReviewPage((current) => Math.max(1, current - 1))} disabled={scannerReviewPage === 1} className="quiet-shelf-secondary-action min-h-10 px-3 disabled:opacity-35">← Previous</button>
                      <span className="text-xs font-semibold text-[#ad9fac]">Page {scannerReviewPage} of {scannerReviewTotalPages} · {scannedBooks.length} books</span>
                      <button type="button" onClick={() => setScannerReviewPage((current) => Math.min(scannerReviewTotalPages, current + 1))} disabled={scannerReviewPage === scannerReviewTotalPages} className="quiet-shelf-secondary-action min-h-10 px-3 disabled:opacity-35">Next →</button>
                    </div>
                  )}
                </>
              )}
              <button type="button" onClick={saveScannedBooks} disabled={scannedBooks.length === 0} className="quiet-shelf-primary-action mt-5 w-full justify-center disabled:opacity-40"><Check className="h-4 w-4" /> Save {scannedBooks.length || ''} Book{scannedBooks.length === 1 ? '' : 's'} to TBR</button>
            </section>
          </div>
        ) : activeTab === 'search' ? (
          <div className="mt-6 space-y-5">
            {authorPage ? (
              <section className="overflow-hidden rounded-2xl border border-[#c5a059]/25 bg-gradient-to-br from-[#241726] via-[#1d1422] to-[#120c15] p-5 sm:p-6">
                <button type="button" onClick={closeAuthorPage} className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-bold text-[#d8c28b] transition hover:bg-white/5 hover:text-[#f1d37b]"><ArrowLeft className="h-4 w-4" /> Back to search results</button>
                <div className="mt-4 flex items-center gap-4">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-[#c5a059]/30 bg-[#c5a059]/10 text-[#e5c158]"><UserRound className="h-6 w-6" /></div>
                  <div className="min-w-0">
                    <p className="inkbound-kicker">Author catalog</p>
                    <h3 className="mt-1 truncate font-serif text-3xl text-[#f4efe6]">{authorPage.name}</h3>
                    <p className="mt-1 text-sm text-[#ad9fac]">
                      {isSearching
                        ? 'Finding books…'
                        : authorHasMore
                          ? `${results.length}+ titles found`
                          : `${results.length} title${results.length === 1 ? '' : 's'} found`}
                    </p>
                    {!isSearching && authorProviderTotal !== null && authorHasMore && <p className="mt-1 text-[11px] text-[#776b78]">More catalog matches are available — load another batch when you are ready.</p>}
                  </div>
                </div>
              </section>
            ) : (
              <>
                <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
                  <label className="relative min-w-0 flex-1"><Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#807482]" /><CanonicalInput type="search" value={query} onValueChange={setQuery} placeholder="Search by title, author, or ISBN" autoFocus className="h-12 w-full rounded-xl border border-[#c5a059]/20 bg-[#0d0910] pl-12 pr-4 text-sm text-[#f4efe6] outline-none" /></label>
                  <button type="submit" disabled={!query.trim() || isSearching} className="quiet-shelf-primary-action min-h-12 px-6 disabled:opacity-50">{isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{isSearching ? 'Searching…' : 'Search'}</button>
                </form>
                {!isSearching && hasSearched && results.length > 0 && searchProviderTotal !== null && (
                  <p className="text-xs text-[#776b78]">Showing {results.length} unique title{results.length === 1 ? '' : 's'}{searchHasMore ? ' so far' : ''}.</p>
                )}
              </>
            )}
            {searchError && <div className="rounded-xl border border-[#c97b7b]/40 bg-[#c97b7b]/10 p-4 text-sm text-[#efb6b6]">{searchError}</div>}
            {!authorPage && !hasSearched && <div className="rounded-2xl border border-dashed border-[#c5a059]/25 px-6 py-12 text-center"><BookOpen className="mx-auto h-10 w-10 text-[#c5a059]/65" /><p className="mt-4 text-sm text-[#ad9fac]">Search catalog metadata. Add books directly to TBR without leaving your results, or choose another list when you need it.</p></div>}
            {hasSearched && !isSearching && !searchError && results.length === 0 && <div className="rounded-2xl border border-dashed border-[#c5a059]/25 px-6 py-10 text-center"><p className="font-serif text-xl text-[#f4efe6]">{authorPage ? `No books found for ${authorPage.name}` : 'No matching material found'}</p>{!authorPage && <button type="button" onClick={() => setActiveTab('manual')} className="quiet-shelf-secondary-action mt-5">Add Manually</button>}</div>}
            {isSearching && authorPage && <div className="grid place-items-center rounded-2xl border border-dashed border-[#c5a059]/20 py-12 text-[#ad9fac]"><Loader2 className="h-6 w-6 animate-spin text-[#c5a059]" /><span className="mt-3 text-sm">Loading {authorPage.name}'s catalog…</span></div>}
            {!isSearching && renderSearchResults()}
            {!isSearching && ((authorPage && authorHasMore) || (!authorPage && searchHasMore)) && (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-[#c5a059]/18 bg-[#120c15] px-5 py-5">
                <button
                  type="button"
                  onClick={() => void (authorPage ? loadMoreAuthorBooks() : loadMoreSearchResults())}
                  disabled={authorPage ? isLoadingAuthorMore : isLoadingSearchMore}
                  className="quiet-shelf-secondary-action min-h-11 min-w-48 justify-center disabled:opacity-50"
                >
                  {(authorPage ? isLoadingAuthorMore : isLoadingSearchMore) && <Loader2 className="h-4 w-4 animate-spin" />}
                  {authorPage
                    ? (isLoadingAuthorMore ? 'Loading more…' : 'Load more books')
                    : (isLoadingSearchMore ? 'Loading more…' : 'Load more results')}
                </button>
                <p className="text-[11px] text-[#776b78]">Showing {results.length} unique title{results.length === 1 ? '' : 's'} so far.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title *"><CanonicalInput value={title} onValueChange={setTitle} placeholder="Title" /></Field>
              <Field label="Author / creator *"><CanonicalInput value={author} onValueChange={setAuthor} placeholder="Author or creator" /></Field>
              <Field label="Reading material"><select value={materialType} onChange={(event) => setMaterialType(event.target.value as ReadingMaterialType)}>{MATERIAL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
              <Field label="Genres"><CanonicalInput value={genres} onValueChange={setGenres} placeholder="Fantasy, Romance" /></Field>
              {format !== 'audiobook' && <Field label="Page count"><CanonicalInput type="number" min="1" value={pageCount} onValueChange={setPageCount} placeholder="Optional" /></Field>}
              <Field label="Format"><select value={format} onChange={(event) => setFormat(event.target.value as Format)}>{FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
              <div>
                <Field label="Reading status / category"><select value={category} onChange={(event) => { if (event.target.value === '__new__') { setCreatingCustomCategory(true); return; } setCategory(event.target.value as CategorySelection); setCreatingCustomCategory(false); }}><optgroup label="Reading status">{READING_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>{customCategories.length > 0 && <optgroup label="Custom categories">{customCategories.map((customCategory) => <option key={customCategory.id} value={`custom:${customCategory.id}`}>{customCategory.name}</option>)}</optgroup>}<option value="__new__">+ New custom category…</option></select></Field>
                {creatingCustomCategory && <div className="mt-2 flex gap-2"><CanonicalInput value={newCustomCategoryName} onValueChange={setNewCustomCategoryName} placeholder="Category name" className="inkbound-select min-w-0 flex-1" /><button type="button" onClick={createAndSelectCustomCategory} className="quiet-shelf-secondary-action">Create</button></div>}
              </div>
              <Field label="Ownership"><select value={ownership} onChange={(event) => setOwnership(event.target.value as OwnershipStatus)}>{OWNERSHIP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
              <Field label="Priority"><select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>{PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            </div>
            <Field label="Summary"><textarea rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Optional" /></Field>
            <button type="button" onClick={handleManualAdd} disabled={!title.trim() || !author.trim()} className="quiet-shelf-primary-action w-full justify-center disabled:opacity-50">Add to Inkbound</button>
          </div>
        )}

        {pendingSearchEdition && (
          <div className="fixed inset-0 z-[260] flex items-end justify-center bg-black/80 sm:items-center sm:p-4" onMouseDown={() => setPendingSearchEdition(null)}>
            <section className="w-full max-w-md rounded-t-3xl border border-[#c5a059]/35 bg-[#17101b] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-3xl" onMouseDown={(event) => event.stopPropagation()}>
              <h3 className="font-serif text-2xl text-[#f4efe6]">{addedSearchBooks.has(searchEditionKey(pendingSearchEdition.work, pendingSearchEdition.edition)) ? 'Change reading list' : 'Add to which list?'}</h3>
              <p className="mt-2 text-sm text-[#ad9fac]">Your search results will stay open so you can keep building your library.</p>
              <div className="mt-5 grid gap-2">
                {ADD_TO_LIST_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => addSearchEditionToList(option.value as CategorySelection)} className="quiet-shelf-secondary-action justify-between">{option.label}<span>→</span></button>)}
              </div>
              <button type="button" onClick={() => setPendingSearchEdition(null)} className="mt-4 min-h-11 w-full text-sm font-semibold text-[#ad9fac]">Cancel</button>
            </section>
          </div>
        )}
      </section>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactElement }> = ({ label, children }) => (
  <label className="block text-xs font-bold text-[#f4efe6]">{label}{React.cloneElement(children as React.ReactElement<{ className?: string }>, { className: `${(children.props as { className?: string }).className ?? ''} inkbound-select mt-2 w-full` })}</label>
);
