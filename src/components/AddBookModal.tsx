import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { BookOpen, Camera, Check, Loader2, ScanLine, Search, Trash2, X } from 'lucide-react';
import {
  FORMAT_OPTIONS,
  MATERIAL_TYPE_OPTIONS,
  OWNERSHIP_OPTIONS,
  PRIORITY_OPTIONS,
  READING_STATUS_OPTIONS,
} from '../domain/libraryTaxonomy';
import { searchGoogleBooks } from '../features/book-search/data/googleBooksApi';
import { createBookFromSearchEdition } from '../features/book-search/mapping/bookSearchMapper';
import type { BookSearchEdition, BookSearchWorkGroup } from '../features/book-search/model/bookSearch';
import {
  CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT,
  createCustomOwnershipCategory,
  readCustomOwnershipCategories,
  type CustomOwnershipCategory,
} from '../features/ownership/customOwnershipCategories';
import { withReadingStatus } from '../features/reading/bookReadingState';
import type { Format, OwnershipStatus, Priority, ReadingMaterialType, ReadingStatus, UserBookRecord } from '../types';

interface AddBookModalProps {
  currentBookCount: number;
  onClose: () => void;
  onAddBook: (newBook: UserBookRecord) => void;
  onAddMultipleBooks?: (newBooks: UserBookRecord[]) => void;
}

type AddBookTab = 'search' | 'scan' | 'manual';
type PendingSearchEdition = { work: BookSearchWorkGroup; edition: BookSearchEdition };
type CustomOwnershipSelection = `custom:${string}`;
type OwnershipSelection = Exclude<OwnershipStatus, 'custom'> | CustomOwnershipSelection;
type ScannedBook = { isbn: string; book: UserBookRecord };

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const ADD_TO_LIST_OPTIONS = READING_STATUS_OPTIONS;
const BUILT_IN_OWNERSHIP_OPTIONS = OWNERSHIP_OPTIONS.filter((option) => option.value !== 'custom');
const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
const uniqueId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const isCustomOwnershipSelection = (selection: OwnershipSelection): selection is CustomOwnershipSelection => selection.startsWith('custom:');

export const AddBookModal: React.FC<AddBookModalProps> = ({ onClose, onAddBook, onAddMultipleBooks }) => {
  const [activeTab, setActiveTab] = useState<AddBookTab>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookSearchWorkGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [pendingSearchEdition, setPendingSearchEdition] = useState<PendingSearchEdition | null>(null);
  const [addedSearchKeys, setAddedSearchKeys] = useState<Set<string>>(() => new Set());
  const [customOwnershipCategories, setCustomOwnershipCategories] = useState<CustomOwnershipCategory[]>(() => readCustomOwnershipCategories());
  const [creatingCustomOwnership, setCreatingCustomOwnership] = useState(false);
  const [newCustomOwnershipName, setNewCustomOwnershipName] = useState('');

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [summary, setSummary] = useState('');
  const [genres, setGenres] = useState('');
  const [pageCount, setPageCount] = useState('');
  const [format, setFormat] = useState<Format>('hardcover');
  const [materialType, setMaterialType] = useState<ReadingMaterialType>('book');
  const [status, setStatus] = useState<ReadingStatus>('tbr');
  const [ownershipSelection, setOwnershipSelection] = useState<OwnershipSelection>('owned');
  const [priority, setPriority] = useState<Priority>('medium');

  const [scannedBooks, setScannedBooks] = useState<ScannedBook[]>([]);
  const [manualIsbn, setManualIsbn] = useState('');
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanLoopRef = useRef<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pendingSearchEdition) {
        setPendingSearchEdition(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pendingSearchEdition]);

  useEffect(() => {
    const refresh = () => setCustomOwnershipCategories(readCustomOwnershipCategories());
    window.addEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => () => {
    if (scanLoopRef.current !== null) cancelAnimationFrame(scanLoopRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

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

  const lookupScannedIsbn = async (rawIsbn: string) => {
    const isbn = normalizeIsbn(rawIsbn);
    if (!(isbn.length === 10 || isbn.length === 13) || scannerBusy) {
      if (isbn) setScannerError('Enter or scan a valid 10- or 13-digit ISBN.');
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
      const response = await searchGoogleBooks(`isbn:${isbn}`);
      const work = response.groups[0];
      const edition = work?.editions[0];
      if (!work || !edition) {
        setScannerError('No matching book was found for that ISBN.');
        return;
      }
      const book = createBookFromSearchEdition({ work, edition, status: 'tbr' });
      setScannedBooks((current) => [...current, { isbn, book }]);
      setManualIsbn('');
      setScannerMessage(`Added “${work.title}” to this scan batch.`);
    } catch (error) {
      setScannerError(error instanceof Error ? error.message : 'ISBN lookup failed. Please try again.');
    } finally {
      setScannerBusy(false);
    }
  };

  const startCamera = async () => {
    setScannerError(null);
    setScannerMessage(null);
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

  const addScannedBatch = () => {
    if (scannedBooks.length === 0) return;
    if (onAddMultipleBooks) onAddMultipleBooks(scannedBooks.map((item) => item.book));
    else scannedBooks.forEach((item) => onAddBook(item.book));
    onClose();
  };

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery || isSearching) return;
    setIsSearching(true);
    setSearchError(null);
    setHasSearched(true);
    setPendingSearchEdition(null);
    try {
      const response = await searchGoogleBooks(trimmedQuery);
      setResults(response.groups);
    } catch (error) {
      setResults([]);
      setSearchError(error instanceof Error ? error.message : 'Reading-material search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const searchEditionKey = (work: BookSearchWorkGroup, edition: BookSearchEdition) =>
    `${work.key}:${edition.source}:${edition.externalEditionId}`;

  const chooseSearchEdition = (work: BookSearchWorkGroup, edition: BookSearchEdition) => {
    setPendingSearchEdition({ work, edition });
  };

  const quickAddSearchEdition = (work: BookSearchWorkGroup, edition: BookSearchEdition) => {
    const key = searchEditionKey(work, edition);
    if (addedSearchKeys.has(key)) return;
    onAddBook(createBookFromSearchEdition({ work, edition, status: 'tbr' }));
    setAddedSearchKeys((current) => new Set(current).add(key));
  };

  const addSearchEditionToList = (selectedStatus: ReadingStatus) => {
    if (!pendingSearchEdition) return;
    const { work, edition } = pendingSearchEdition;
    const key = searchEditionKey(work, edition);
    if (!addedSearchKeys.has(key)) {
      onAddBook(createBookFromSearchEdition({ work, edition, status: selectedStatus }));
      setAddedSearchKeys((current) => new Set(current).add(key));
    }
    setPendingSearchEdition(null);
  };

  const handleManualAdd = () => {
    if (!title.trim() || !author.trim()) return;
    const workId = uniqueId('work');
    const editionId = uniqueId('edition');
    const bookId = uniqueId('book');
    const parsedPageCount = Number.parseInt(pageCount, 10);
    const validPageCount = Number.isFinite(parsedPageCount) && parsedPageCount > 0 ? parsedPageCount : undefined;
    const hasKnownPrintTotal = format !== 'audiobook' && validPageCount !== undefined;
    const isFinished = status === 'finished';
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
    };

    onAddBook(withReadingStatus(baseBook, status, addedOn));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="relative max-h-[100dvh] w-full max-w-5xl overflow-y-auto overscroll-contain rounded-t-3xl border border-[#c5a059]/40 bg-[#17101b] px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-7" role="dialog" aria-modal="true" aria-labelledby="add-book-title">
        <button type="button" onClick={onClose} className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-black/30 text-[#ad9fac]" aria-label="Close add reading material dialog"><X className="h-5 w-5" /></button>

        <header className="pr-12">
          <p className="inkbound-kicker">Build your library</p>
          <h2 id="add-book-title" className="mt-2 font-serif text-3xl text-[#f4efe6]">Add Reading Material</h2>
          <p className="mt-2 text-sm text-[#ad9fac]">Add books, manga, comics, graphic novels, magazines, light novels, novellas, short stories, and anthologies.</p>
        </header>

        <div className="mt-6 grid grid-cols-3 gap-1 rounded-xl border border-[#3d2448] bg-[#0d0910] p-1">
          <button type="button" onClick={() => setActiveTab('search')} className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${activeTab === 'search' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac]'}`}>Search</button>
          <button type="button" onClick={() => setActiveTab('scan')} className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${activeTab === 'scan' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac]'}`}>Scan Books</button>
          <button type="button" onClick={() => setActiveTab('manual')} className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${activeTab === 'manual' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac]'}`}>Add Manually</button>
        </div>

        {activeTab === 'search' ? (
          <div className="mt-6 space-y-5">
            <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#807482]" />
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title, author, or ISBN" autoFocus className="h-12 w-full rounded-xl border border-[#c5a059]/20 bg-[#0d0910] pl-12 pr-4 text-sm text-[#f4efe6] outline-none" />
              </label>
              <button type="submit" disabled={!query.trim() || isSearching} className="quiet-shelf-primary-action min-h-12 px-6 disabled:opacity-50">{isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{isSearching ? 'Searching…' : 'Search'}</button>
            </form>

            {searchError && <div className="rounded-xl border border-[#c97b7b]/40 bg-[#c97b7b]/10 p-4 text-sm text-[#efb6b6]">{searchError}</div>}
            {!hasSearched && <div className="rounded-2xl border border-dashed border-[#c5a059]/25 px-6 py-12 text-center"><BookOpen className="mx-auto h-10 w-10 text-[#c5a059]/65" /><p className="mt-4 text-sm text-[#ad9fac]">Search catalog metadata. You can correct the material type later if the source does not identify it reliably.</p></div>}
            {hasSearched && !isSearching && !searchError && results.length === 0 && <div className="rounded-2xl border border-dashed border-[#c5a059]/25 px-6 py-10 text-center"><p className="font-serif text-xl text-[#f4efe6]">No matching material found</p><button type="button" onClick={() => setActiveTab('manual')} className="quiet-shelf-secondary-action mt-5">Add Manually</button></div>}

            {results.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {results.map((work) => {
                  const edition = work.editions[0];
                  if (!edition) return null;
                  const key = searchEditionKey(work, edition);
                  const added = addedSearchKeys.has(key);
                  return (
                    <article key={work.key} className="flex min-w-0 flex-col rounded-2xl border border-[#c5a059]/18 bg-[#1d1422] p-4">
                      <h3 className="line-clamp-2 font-serif text-xl leading-tight text-[#f4efe6]">{work.title}</h3>
                      <p className="mt-1 line-clamp-1 text-xs text-[#ad9fac]">{work.authors.join(', ')}</p>

                      <div className={`mt-4 flex min-h-36 gap-3 rounded-xl border p-3 ${added ? 'border-[#c5a059]/35 bg-[#17131b]' : 'border-white/7 bg-[#120c15]'}`}>
                        {edition.coverUrl ? <img src={edition.coverUrl} alt="" className="h-28 w-20 shrink-0 rounded object-cover" /> : <span className="grid h-28 w-20 shrink-0 place-items-center rounded bg-gradient-to-br from-[#5c3d62] to-[#171117]"><BookOpen /></span>}
                        <div className="flex min-w-0 flex-1 flex-col text-xs text-[#ad9fac]">
                          <strong className="block text-[#f4efe6]">{FORMAT_OPTIONS.find((option) => option.value === edition.format)?.label ?? edition.format}</strong>
                          {edition.pageCount ? <span className="mt-1 block">{edition.pageCount} pages</span> : <span className="mt-1 block text-[#776b78]">Page count unavailable</span>}
                          <div className="mt-auto pt-3">
                            {added ? (
                              <div className="rounded-lg border border-[#c5a059]/20 bg-[#1d1720] px-3 py-2 text-center font-bold text-[#e5c158]">Added to TBR</div>
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
          </div>
        ) : activeTab === 'scan' ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl border border-[#c5a059]/20 bg-[#120c15] p-5">
              <div className="flex items-start gap-3">
                <ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-[#e2bd66]" />
                <div>
                  <h3 className="font-serif text-xl text-[#f4efe6]">Scan book barcodes</h3>
                  <p className="mt-1 text-sm text-[#ad9fac]">Scan ISBN barcodes one after another, review the batch, then add them to your library together.</p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                <input value={manualIsbn} onChange={(event) => setManualIsbn(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void lookupScannedIsbn(manualIsbn); } }} inputMode="numeric" placeholder="Enter ISBN manually" className="min-h-12 rounded-xl border border-[#c5a059]/20 bg-[#0d0910] px-4 text-sm text-[#f4efe6] outline-none" />
                <button type="button" onClick={() => void lookupScannedIsbn(manualIsbn)} disabled={scannerBusy || !manualIsbn.trim()} className="quiet-shelf-primary-action min-h-12 px-5 disabled:opacity-50">{scannerBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{scannerBusy ? 'Looking up…' : 'Add ISBN'}</button>
              </div>

              <div className="mt-3">
                <button type="button" onClick={() => cameraActive ? stopCamera() : void startCamera()} disabled={scannerBusy} className="quiet-shelf-secondary-action min-h-11 disabled:opacity-50"><Camera className="h-4 w-4" />{cameraActive ? 'Stop camera' : 'Scan with camera'}</button>
              </div>

              {cameraActive && <div className="mt-4 overflow-hidden rounded-2xl border border-[#c5a059]/20 bg-black"><video ref={videoRef} playsInline muted className="aspect-video w-full object-cover" /></div>}
              {!cameraActive && <video ref={videoRef} playsInline muted className="hidden" />}

              {scannerError && <div className="mt-4 rounded-xl border border-[#c97b7b]/40 bg-[#c97b7b]/10 p-3 text-sm text-[#efb6b6]">{scannerError}</div>}
              {scannerMessage && <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-950/20 p-3 text-sm text-emerald-200"><Check className="h-4 w-4" />{scannerMessage}</div>}
            </div>

            <div className="rounded-2xl border border-[#c5a059]/18 bg-[#1d1422] p-5">
              <div className="flex items-center justify-between gap-3">
                <div><p className="inkbound-kicker">Scan batch</p><h3 className="mt-1 font-serif text-xl text-[#f4efe6]">{scannedBooks.length} book{scannedBooks.length === 1 ? '' : 's'} ready</h3></div>
                {scannedBooks.length > 0 && <button type="button" onClick={() => setScannedBooks([])} className="quiet-shelf-secondary-action text-[#efb6b6]"><Trash2 className="h-4 w-4" />Clear</button>}
              </div>

              {scannedBooks.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-[#c5a059]/20 px-5 py-8 text-center text-sm text-[#ad9fac]">Scanned books will appear here before anything is added to your library.</div>
              ) : (
                <div className="mt-4 space-y-2">
                  {scannedBooks.map((item) => {
                    const edition = item.book.editions.find((candidate) => candidate.id === item.book.activeEditionId) ?? item.book.editions[0];
                    return <div key={item.isbn} className="flex items-center gap-3 rounded-xl border border-white/7 bg-[#120c15] p-3">
                      {edition?.coverUrl ? <img src={edition.coverUrl} alt="" className="h-16 w-11 shrink-0 rounded object-cover" /> : <span className="grid h-16 w-11 shrink-0 place-items-center rounded bg-gradient-to-br from-[#5c3d62] to-[#171117]"><BookOpen className="h-4 w-4" /></span>}
                      <div className="min-w-0 flex-1"><p className="truncate font-semibold text-[#f4efe6]">{item.book.work.title}</p><p className="truncate text-xs text-[#ad9fac]">{item.book.work.author} · ISBN {item.isbn}</p></div>
                      <button type="button" onClick={() => setScannedBooks((current) => current.filter((candidate) => candidate.isbn !== item.isbn))} className="grid h-10 w-10 place-items-center rounded-lg text-[#ad9fac] hover:bg-white/5" aria-label={`Remove ${item.book.work.title} from scan batch`}><X className="h-4 w-4" /></button>
                    </div>;
                  })}
                </div>
              )}

              <button type="button" onClick={addScannedBatch} disabled={scannedBooks.length === 0} className="quiet-shelf-primary-action mt-5 min-h-12 w-full disabled:opacity-50">Add {scannedBooks.length || ''} scanned book{scannedBooks.length === 1 ? '' : 's'} to library</button>
            </div>
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
              <Field label="Reading status"><select value={status} onChange={(event) => setStatus(event.target.value as ReadingStatus)}>{READING_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
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
