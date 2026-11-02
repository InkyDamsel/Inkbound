import { uniquePrivateTags } from '../features/library/privateTags';
import React, { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ImagePlus, Loader2, Pencil, Play, Plus, RefreshCw, Save, Search, Star, Trash2, Upload, X } from 'lucide-react';
import { FORMAT_OPTIONS, PRIORITY_OPTIONS, READING_STATUS_OPTIONS } from '../domain/libraryTaxonomy';
import { searchGoogleBooks } from '../features/book-search/data/googleBooksApi';
import { fetchOpenLibrarySummary } from '../features/book-search/data/openLibraryApi';
import type { BookSearchEdition, BookSearchWorkGroup } from '../features/book-search/model/bookSearch';
import { getActiveEdition, getBookReadingState, getEffectiveRereadCount, getReadingCompletions, withReadingStatus } from '../features/reading/bookReadingState';
import { deriveProgressFromPercentage } from '../features/reading/progressActivity';
import { addSavedQuote, createSavedQuote, deleteSavedQuote, setFavoriteSavedQuote, updateSavedQuote } from '../features/reading/bookQuotes';
import {
  getSessionDurationMinutes,
  getSessionListeningMinutes,
  getSessionPagesRead,
  localDateKey,
} from '../features/reading/sessionAnalytics';
import { SYNC_STORAGE_KEYS } from '../features/sync/storageKeys';
import { getRuntimeStorage } from '../platform/runtimeStorage';
import { prepareBookCoverImage } from '../platform/prepareBookCoverImage';
import type { Edition, Format, Priority, ReadingSession, UserBookRecord } from '../types';
import { bookRatingLabel, spiceLevelLabel } from '../features/reading/bookRating';
import { BookCover } from './BookCover';
import { SessionEditorModal } from './SessionEditorModal';
import { BulkHistoricalSessionsModal } from './BulkHistoricalSessionsModal';
import { CustomOwnershipBookControl } from './ownership/CustomOwnershipBookControl';
import { ChiliPepperIcon, IconStepRating } from './reading/IconStepRating';
import { CustomReadingStatusBookControl } from './reading/CustomReadingStatusBookControl';
import { CanonicalNumberInput } from './form/CanonicalInput';

interface BookProgressCorrection {
  progressPages?: number;
  progressMinutes?: number;
  pageCount?: number;
  audiobookDurationMins?: number;
}

interface BookDetailsModalProps {
  book: UserBookRecord | null;
  sessions: ReadingSession[];
  onClose: () => void;
  onUpdateBook: (updatedBook: UserBookRecord) => void;
  onCorrectProgress: (bookId: string, correction: BookProgressCorrection) => void;
  onDeleteBook: (book: UserBookRecord) => void;
  onStartSession: (book: UserBookRecord) => void;
  onSaveManualSession: (session: ReadingSession) => void;
  onSaveManualSessions: (sessions: ReadingSession[]) => void;
  onUpdateSession: (session: ReadingSession) => void;
  onDeleteSession: (sessionId: string) => void;
}

type DetailsTab = 'details' | 'summary' | 'quotes' | 'reading' | 'sessions' | 'editions' | 'rereads';
type CoverMode = 'choices' | 'search' | 'url';

const MAX_COVER_FILE_BYTES = 12 * 1024 * 1024;
const ACCEPTED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ENRICHMENT_QUEUE_KEY = SYNC_STORAGE_KEYS.importEnrichmentQueue;
const MATCH_STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'book', 'books', 'series', 'complete', 'edition']);

const normalize = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
const tokens = (value?: string) => [...new Set(normalize(value).split(' ').filter((token) => token.length >= 3 && !MATCH_STOP_WORDS.has(token)))];
const csvList = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
const tagList = (value: string) => uniquePrivateTags(value.split(','));

const candidateMatchesBookIdentity = (book: UserBookRecord, work: BookSearchWorkGroup) => {
  const wantedTitle = tokens(book.work.title);
  const candidateTitle = normalize(work.title);
  const titleMatches = wantedTitle.filter((token) => candidateTitle.includes(token)).length;
  const required = wantedTitle.length <= 2 ? wantedTitle.length : Math.max(2, Math.ceil(wantedTitle.length * 0.67));
  if (wantedTitle.length > 0 && titleMatches < required) return false;
  const wantedAuthor = tokens(book.work.author);
  if (wantedAuthor.length === 0) return true;
  const candidateAuthor = normalize(work.authors.join(' '));
  const lastName = wantedAuthor.at(-1);
  return wantedAuthor.filter((token) => candidateAuthor.includes(token)).length >= Math.max(1, Math.ceil(wantedAuthor.length * 0.5))
    || Boolean(lastName && candidateAuthor.includes(lastName));
};

const stopAutomaticEnrichmentForBook = (bookId: string) => {
  try {
    const storage = getRuntimeStorage();
    const raw = storage.getItem(ENRICHMENT_QUEUE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Array<{ targetBookId?: string }>;
    const next = Array.isArray(parsed) ? parsed.filter((item) => item.targetBookId !== bookId) : [];
    if (next.length) storage.setItem(ENRICHMENT_QUEUE_KEY, JSON.stringify(next));
    else storage.removeItem(ENRICHMENT_QUEUE_KEY);
  } catch {
    // User edits still save even if queue cleanup is unavailable.
  }
};

export const BookDetailsModal: React.FC<BookDetailsModalProps> = ({ book, sessions, onClose, onUpdateBook, onCorrectProgress, onDeleteBook, onStartSession, onSaveManualSession, onSaveManualSessions, onUpdateSession, onDeleteSession }) => {
  const [activeTab, setActiveTab] = useState<DetailsTab>('details');
  const [coverManagerOpen, setCoverManagerOpen] = useState(false);
  const [coverMode, setCoverMode] = useState<CoverMode>('choices');
  const [coverQuery, setCoverQuery] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [coverResults, setCoverResults] = useState<BookSearchWorkGroup[]>([]);
  const [coverSearching, setCoverSearching] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [isSyncingBook, setIsSyncingBook] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<ReadingSession | null>(null);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [isBulkManualEntryOpen, setIsBulkManualEntryOpen] = useState(false);
  const [newEditionFormat, setNewEditionFormat] = useState<Format>('paperback');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [seriesName, setSeriesName] = useState('');
  const [seriesOrder, setSeriesOrder] = useState('');
  const [summary, setSummary] = useState('');
  const [publisherSummary, setPublisherSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [review, setReview] = useState('');
  const [quoteText, setQuoteText] = useState('');
  const [quotePageOrChapter, setQuotePageOrChapter] = useState('');
  const [quoteNote, setQuoteNote] = useState('');
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [tags, setTags] = useState('');
  const [collections, setCollections] = useState('');
  const swipeStartY = useRef<number | null>(null);
  const swipeStartX = useRef<number | null>(null);

  useEffect(() => {
    setActiveTab('details');
    setEditingSession(null);
    setTitle(book?.work.title ?? '');
    setAuthor(book?.work.author ?? '');
    setSeriesName(book?.work.seriesName ?? '');
    setSeriesOrder(typeof book?.work.seriesOrder === 'number' ? String(book.work.seriesOrder) : '');
    setSummary(book?.work.personalSummary ?? '');
    setPublisherSummary(book?.work.publisherSummary ?? '');
    setNotes(book?.personalNotes ?? '');
    setReview(book?.review ?? '');
    setQuoteText('');
    setQuotePageOrChapter('');
    setQuoteNote('');
    setEditingQuoteId(null);
    setTags((book?.privateTags ?? []).join(', '));
    setCollections((book?.collections ?? []).join(', '));
    setCoverQuery(book ? `${book.work.title} ${book.work.author}` : '');
    setCoverUrl('');
    setCoverResults([]);
    setCoverError(null);
    setSyncMessage(null);
  }, [book?.id]);

  const activeEdition = useMemo(() => book ? getActiveEdition(book) : undefined, [book]);
  const readingState = useMemo(() => book ? getBookReadingState(book) : undefined, [book]);
  const bookSessions = useMemo(
    () => sessions.filter((session) => session.bookId === book?.id).sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`)),
    [sessions, book?.id],
  );

  if (!book || !activeEdition || !readingState) return null;

  const deriveBookForActiveEdition = (nextEdition: Edition, nextEditions: Edition[], nextActiveEditionId = nextEdition.id): UserBookRecord => {
    const candidate: UserBookRecord = {
      ...book,
      activeEditionId: nextActiveEditionId,
      editions: nextEditions,
    };
    const state = getBookReadingState(candidate);
    if (state.progressNeedsCorrection) {
      return withReadingStatus(candidate, 'finished', book.dateFinished ?? book.lastSessionDate ?? localDateKey());
    }
    return { ...candidate, progressPercentage: state.progressPercentage };
  };

  const updateBook = (changes: Partial<UserBookRecord>) => onUpdateBook({ ...book, ...changes });
  const resetQuoteEditor = () => {
    setQuoteText('');
    setQuotePageOrChapter('');
    setQuoteNote('');
    setEditingQuoteId(null);
  };
  const saveQuote = () => {
    const trimmed = quoteText.trim();
    if (!trimmed) return;
    if (editingQuoteId) {
      onUpdateBook(updateSavedQuote(book, editingQuoteId, {
        quote: trimmed,
        pageOrChapter: quotePageOrChapter.trim() || undefined,
        note: quoteNote.trim() || undefined,
      }));
    } else {
      onUpdateBook(addSavedQuote(book, createSavedQuote(trimmed, quotePageOrChapter, quoteNote)));
    }
    resetQuoteEditor();
  };
  const editQuote = (quoteId: string) => {
    const quote = (book.favoriteQuotes ?? []).find((item) => item.id === quoteId);
    if (!quote) return;
    setQuoteText(quote.quote);
    setQuotePageOrChapter(quote.pageOrChapter ?? '');
    setQuoteNote(quote.note ?? '');
    setEditingQuoteId(quote.id);
  };
  const updateOptionalRating = (field: 'rating' | 'spiceLevel', value?: number) => {
    if (value !== undefined) {
      updateBook({ [field]: value });
      return;
    }
    const nextBook = { ...book };
    delete nextBook[field];
    onUpdateBook(nextBook);
  };
  const updateActiveEdition = (changes: Partial<Edition>, markManual = true) => {
    if (markManual) stopAutomaticEnrichmentForBook(book.id);
    const nextEdition: Edition = {
      ...activeEdition,
      ...changes,
      ...(markManual ? { externalSource: 'manual' as const } : {}),
      ...(markManual && Object.prototype.hasOwnProperty.call(changes, 'coverUrl')
        ? { manualCoverUpdatedAt: new Date().toISOString() }
        : {}),
    };
    const nextEditions = book.editions.map((edition) => edition.id === activeEdition.id ? nextEdition : edition);
    onUpdateBook(deriveBookForActiveEdition(nextEdition, nextEditions, activeEdition.id));
  };

  const activateEdition = (edition: Edition) => {
    onUpdateBook(deriveBookForActiveEdition(edition, book.editions, edition.id));
  };

  const saveDetails = () => {
    if (!title.trim() || !author.trim()) return;
    stopAutomaticEnrichmentForBook(book.id);
    onUpdateBook({
      ...book,
      work: {
        ...book.work,
        title: title.trim(),
        author: author.trim(),
        seriesName: seriesName.trim() || undefined,
        seriesOrder: seriesOrder.trim() && Number.isFinite(Number(seriesOrder))
          ? Math.max(0, Number(seriesOrder))
          : undefined,
      },
      privateTags: tagList(tags),
      collections: csvList(collections),
    });
  };

  const saveSummary = () => {
    stopAutomaticEnrichmentForBook(book.id);
    onUpdateBook({
      ...book,
      work: {
        ...book.work,
        personalSummary: summary.trim() || undefined,
        publisherSummary: publisherSummary.trim() || undefined,
        summary: summary.trim() || publisherSummary.trim() || book.work.summary || 'Summary unavailable.',
      },
      personalNotes: notes.trim() || undefined,
      review: review.trim() || undefined,
    });
  };


  const updateFinishedDate = (dateFinished?: string) => {
    if (!dateFinished) {
      updateBook({ dateFinished: undefined });
      return;
    }
    onUpdateBook({ ...withReadingStatus(book, 'finished', dateFinished), dateFinished });
  };

  const correctProgressPercentage = (percentage: number) => {
    const safePercentage = Math.max(0, Math.min(100, percentage));
    const derived = deriveProgressFromPercentage(activeEdition, safePercentage);
    if (derived.progressMinutes !== undefined || derived.progressPages !== undefined) {
      onCorrectProgress(book.id, derived);
      return;
    }
    // Without a known page count/audio duration, percentage remains current
    // progress only. Inkbound cannot safely invent pages/minutes for daily goals.
    updateBook({ progressPercentage: safePercentage });
  };

  const syncBookMetadata = async () => {
    if (isSyncingBook) return;
    if (!navigator.onLine) return setSyncMessage('Inkbound needs an internet connection to sync metadata.');
    setIsSyncingBook(true);
    setSyncMessage(null);
    try {
      const response = await searchGoogleBooks(`${book.work.title} ${book.work.author}`);
      const candidates = response.groups.filter((work) => candidateMatchesBookIdentity(book, work)).flatMap((work) => work.editions.map((edition) => ({ work, edition })));
      const candidateHasSummary = ({ work, edition }: { work: BookSearchWorkGroup; edition: BookSearchEdition }) => Boolean((edition.publisherSummary ?? work.publisherSummary)?.trim());
      const match = (!book.work.publisherSummary
        ? candidates.find((candidate) => candidate.edition.format === activeEdition.format && candidateHasSummary(candidate))
          ?? candidates.find(candidateHasSummary)
        : undefined)
        ?? candidates.find(({ edition }) => edition.format === activeEdition.format && Boolean(edition.coverUrl))
        ?? candidates.find(({ edition }) => Boolean(edition.coverUrl))
        ?? candidates[0];
      if (!match) return setSyncMessage('No safe title-and-author match was found. Inkbound left this book unchanged.');
      const { work: matchedWork, edition: matchedEdition } = match;
      const matchedSeriesEdition = candidates.find(({ edition }) => edition.seriesName?.trim())?.edition;
      const matchedSeriesName = matchedEdition.seriesName?.trim()
        || matchedSeriesEdition?.seriesName?.trim();
      const matchedSeriesOrder = typeof matchedEdition.seriesOrder === 'number'
        ? matchedEdition.seriesOrder
        : matchedSeriesEdition?.seriesOrder;
      let matchedPublisherSummary = matchedEdition.publisherSummary ?? matchedWork.publisherSummary;
      if (!book.work.publisherSummary && !matchedPublisherSummary) {
        try {
          matchedPublisherSummary = await fetchOpenLibrarySummary(book.work.title, book.work.author);
        } catch (error) {
          console.warn('Open Library work summary lookup failed.', error);
        }
      }
      const manualEdition = activeEdition.externalSource === 'manual';
      const nextEdition: Edition = manualEdition ? activeEdition : {
        ...activeEdition,
        isbn: activeEdition.isbn || matchedEdition.isbn13 || matchedEdition.isbn10,
        isbn10: activeEdition.isbn10 || matchedEdition.isbn10,
        isbn13: activeEdition.isbn13 || matchedEdition.isbn13,
        pageCount: activeEdition.pageCount || matchedEdition.pageCount,
        publisher: activeEdition.publisher || matchedEdition.publisher,
        publicationDate: activeEdition.publicationDate || matchedEdition.publicationDate,
        coverUrl: activeEdition.coverUrl || matchedEdition.coverUrl,
        language: activeEdition.language || matchedEdition.language,
        editionName: activeEdition.editionName || matchedEdition.editionName,
        externalSource: matchedEdition.source,
        externalEditionId: matchedEdition.externalEditionId,
      };
      const nextBook: UserBookRecord = {
        ...book,
        work: {
          ...book.work,
          subtitle: book.work.subtitle || matchedWork.subtitle,
          publisherSummary: book.work.publisherSummary || matchedPublisherSummary,
          summary: book.work.personalSummary || book.work.publisherSummary || matchedPublisherSummary || book.work.summary,
          genres: book.work.genres.length ? book.work.genres : matchedWork.genres,
          seriesName: book.work.seriesName?.trim() || matchedSeriesName || undefined,
          seriesOrder: typeof book.work.seriesOrder === 'number'
            ? book.work.seriesOrder
            : matchedSeriesOrder,
          publicationYear: book.work.publicationYear || matchedEdition.publicationYear,
          originalLanguage: book.work.originalLanguage || matchedEdition.language,
          externalWorkId: matchedWork.key,
        },
        editions: book.editions.map((edition) => edition.id === activeEdition.id ? nextEdition : edition),
      };
      onUpdateBook(nextBook);
      setPublisherSummary(nextBook.work.publisherSummary ?? '');
      setSeriesName(nextBook.work.seriesName ?? '');
      setSeriesOrder(typeof nextBook.work.seriesOrder === 'number' ? String(nextBook.work.seriesOrder) : '');
      setSyncMessage(matchedPublisherSummary
        ? `Metadata synced. Publisher summary updated.`
        : manualEdition
          ? 'Metadata synced. Your manual edition values were preserved, but no publisher summary was available from Hardcover, Google Books, or Open Library.'
          : `Metadata synced from ${matchedEdition.source.replaceAll('-', ' ')}, but no publisher summary was available from Hardcover, Google Books, or Open Library.`);
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Inkbound could not sync this book.');
    } finally {
      setIsSyncingBook(false);
    }
  };

  const searchCovers = async (event: FormEvent) => {
    event.preventDefault();
    if (!coverQuery.trim() || coverSearching) return;
    setCoverSearching(true);
    setCoverError(null);
    try {
      const response = await searchGoogleBooks(coverQuery.trim());
      setCoverResults(response.groups.filter((group) => candidateMatchesBookIdentity(book, group) && group.editions.some((edition) => edition.coverUrl)));
    } catch (error) {
      setCoverResults([]);
      setCoverError(error instanceof Error ? error.message : 'Cover search failed.');
    } finally {
      setCoverSearching(false);
    }
  };

  const chooseOnlineCover = (edition: BookSearchEdition) => {
    if (!edition.coverUrl) return;
    updateActiveEdition({ coverUrl: edition.coverUrl, externalEditionId: edition.externalEditionId });
    setCoverManagerOpen(false);
  };

  const useCoverUrl = () => {
    const value = coverUrl.trim();
    if (!/^https:\/\//i.test(value)) {
      setCoverError('Enter a direct HTTPS image URL.');
      return;
    }
    setCoverError(null);
    updateActiveEdition({ coverUrl: value });
    setCoverManagerOpen(false);
  };

  const uploadCover = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ACCEPTED_COVER_TYPES.includes(file.type)) return setCoverError('Please choose a JPG, PNG, or WEBP image.');
    if (file.size > MAX_COVER_FILE_BYTES) return setCoverError('Please choose an image smaller than 12 MB.');

    setCoverError(null);
    try {
      const preparedCover = await prepareBookCoverImage(file);
      updateActiveEdition({ coverUrl: preparedCover });
      setCoverManagerOpen(false);
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : 'Inkbound could not prepare that cover image.');
    }
  };

  const addEdition = () => {
    stopAutomaticEnrichmentForBook(book.id);
    const edition: Edition = { id: `edition-${Date.now()}`, format: newEditionFormat, coverGradient: 'from-[#5c3d62] via-[#35243f] to-[#171117]', externalSource: 'manual' };
    onUpdateBook(deriveBookForActiveEdition(edition, [...book.editions, edition], edition.id));
  };

  const metadataLabel = activeEdition.externalSource === 'manual' ? 'Manual / user-edited' : activeEdition.externalSource ? `Verified via ${activeEdition.externalSource.replaceAll('-', ' ')}` : book.sourceOfImport?.toLowerCase().includes('import') ? 'Imported record' : 'Inkbound record';
  const tabs: Array<{ id: DetailsTab; label: string }> = [
    { id: 'details', label: 'Book Details' }, { id: 'summary', label: 'Summary & Notes' }, { id: 'quotes', label: `Quotes (${book.favoriteQuotes?.length ?? 0})` }, { id: 'reading', label: 'Reading' }, { id: 'sessions', label: `Sessions (${bookSessions.length})` }, { id: 'editions', label: `Editions (${book.editions.length})` }, { id: 'rereads', label: `Rereads (${getEffectiveRereadCount(book)})` },
  ];

  const beginSwipeToClose = (event: React.TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    swipeStartY.current = touch?.clientY ?? null;
    swipeStartX.current = touch?.clientX ?? null;
  };

  const finishSwipeToClose = (event: React.TouchEvent<HTMLElement>) => {
    const startY = swipeStartY.current;
    const startX = swipeStartX.current;
    swipeStartY.current = null;
    swipeStartX.current = null;
    if (startY === null || startX === null) return;

    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaY = touch.clientY - startY;
    const deltaX = Math.abs(touch.clientX - startX);

    // iOS-style sheet dismissal: a deliberate downward swipe from the modal
    // header closes Book Details. Horizontal tab/series gestures and ordinary
    // taps are ignored.
    if (deltaY >= 80 && deltaY > deltaX * 1.25) onClose();
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-end bg-black/75 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <section className="inkbound-modal-surface flex max-h-[96dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] shadow-2xl sm:!max-h-[88dvh] sm:!max-w-[960px] sm:rounded-3xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <header className="book-details-modal-header relative border-b border-[#3d2448] bg-gradient-to-r from-[#281333] via-[#1d0e26] to-[#140a1a] p-4 sm:p-6" onTouchStart={beginSwipeToClose} onTouchEnd={finishSwipeToClose}>
          <div className="book-details-swipe-handle mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/25 sm:hidden" aria-hidden="true" />
          <button type="button" onClick={onClose} className="book-details-close-button absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-black/30 text-stone-300" aria-label="Close book details"><X className="h-5 w-5" /></button>
          <div className="flex items-start gap-4 pr-10 sm:gap-6"><button type="button" onClick={() => { setCoverManagerOpen(true); setCoverMode('choices'); }} className="shrink-0"><BookCover work={book.work} edition={activeEdition} size="lg" /></button><div className="min-w-0 flex-1"><span className="inline-flex rounded bg-[#c5a059] px-2 py-1 text-[10px] font-bold uppercase text-[#120817]">{activeEdition.format}</span><h2 className="mt-3 line-clamp-2 font-serif text-2xl font-bold text-[#f4efe6] sm:text-4xl">{book.work.title}</h2><p className="mt-1 text-sm italic text-stone-400">by {book.work.author}</p><p className="mt-2 text-xs text-[#b9aaba]">Metadata: <strong className="text-[#e5c158]">{metadataLabel}</strong></p>{syncMessage && <p className="mt-2 text-xs text-[#b9aaba]">{syncMessage}</p>}</div></div>

        </header>
        <div className="book-details-mobile-actions book-details-action-bar shrink-0 flex flex-wrap items-center gap-2 border-b border-[#3d2448] bg-[#1c0f24] px-3 py-2">
          <button type="button" onClick={() => setCoverManagerOpen(true)} className="quiet-shelf-secondary-action min-h-11 justify-center px-3 text-xs"><ImagePlus className="h-4 w-4" /> Cover</button>
          <button type="button" onClick={() => void syncBookMetadata()} disabled={isSyncingBook} className="quiet-shelf-secondary-action min-h-11 justify-center px-3 text-xs"><RefreshCw className={`h-4 w-4 ${isSyncingBook ? 'animate-spin' : ''}`} /> Sync Metadata</button>
          <button type="button" onClick={() => setDeleteConfirmOpen(true)} className="quiet-shelf-secondary-action min-h-11 justify-center px-3 text-xs text-rose-300"><Trash2 className="h-4 w-4" /> Delete</button>
        </div>
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#3d2448] bg-[#120817] px-3 py-2 text-xs font-semibold">{tabs.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`min-h-11 whitespace-nowrap rounded-xl px-4 ${activeTab === tab.id ? 'bg-[#c5a059] font-bold text-[#120817]' : 'text-stone-400 hover:bg-[#25132f]'}`}>{tab.label}</button>)}</nav>
        <div className="flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6">
          {activeTab === 'details' && <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-[#f4efe6]">Title<input value={title} onChange={(e) => setTitle(e.target.value)} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Author<input value={author} onChange={(e) => setAuthor(e.target.value)} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Series<input value={seriesName} onChange={(e) => setSeriesName(e.target.value)} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Series #<input inputMode="decimal" type="number" min={0} step="0.5" value={seriesOrder} onChange={(e) => setSeriesOrder(e.target.value)} className="inkbound-select mt-2 w-full" /></label>{READING_STATUS_OPTIONS.length > 0 && <CustomReadingStatusBookControl book={book} onUpdateBook={onUpdateBook} />}<CustomOwnershipBookControl book={book} onUpdateBook={onUpdateBook} /><label className="text-xs font-bold text-[#f4efe6]">Priority<select value={book.priority} onChange={(e) => updateBook({ priority: e.target.value as Priority })} className="inkbound-select mt-2 w-full">{PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="text-xs font-bold text-[#f4efe6]">Date Added<input type="date" value={book.dateAdded} onChange={(e) => updateBook({ dateAdded: e.target.value })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Date Started<input type="date" value={book.dateStarted ?? ''} onChange={(e) => updateBook({ dateStarted: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Date Finished<input type="date" value={book.dateFinished ?? ''} onChange={(e) => updateFinishedDate(e.target.value || undefined)} className="inkbound-select mt-2 w-full" /></label></div><label className="block text-xs font-bold text-[#f4efe6]">Tags<input value={tags} onChange={(e) => setTags(e.target.value)} className="inkbound-select mt-2 w-full" /></label><label className="block text-xs font-bold text-[#f4efe6]">Collections<input value={collections} onChange={(e) => setCollections(e.target.value)} className="inkbound-select mt-2 w-full" /></label><button type="button" onClick={saveDetails} className="quiet-shelf-primary-action"><Save className="h-4 w-4" /> Save Book Details</button></div>}
          {activeTab === 'summary' && <div className="space-y-5"><label className="block text-xs font-bold text-[#f4efe6]">My Summary<textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} className="mt-2 w-full rounded-xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6]" /></label><label className="block text-xs font-bold text-[#f4efe6]">Publisher Summary<textarea rows={6} value={publisherSummary} onChange={(e) => setPublisherSummary(e.target.value)} className="mt-2 w-full rounded-xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6]" /></label><label className="block text-xs font-bold text-[#f4efe6]">Review<textarea rows={5} value={review} onChange={(e) => setReview(e.target.value)} className="mt-2 w-full rounded-xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6]" /></label><label className="block text-xs font-bold text-[#f4efe6]">Private Notes<textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-2 w-full rounded-xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6]" /></label><button type="button" onClick={saveSummary} className="quiet-shelf-primary-action"><Save className="h-4 w-4" /> Save Summary & Notes</button></div>}
          {activeTab === 'quotes' && <div className="space-y-5">
            <section className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wider text-[#e5c158]">{editingQuoteId ? 'Edit saved quote' : 'Save a quote'}</p><p className="mt-1 text-xs leading-5 text-stone-400">Quotes are saved with this book and can be used in Inkbound Studio share cards.</p></div>{editingQuoteId && <button type="button" onClick={resetQuoteEditor} className="quiet-shelf-secondary-action">Cancel</button>}</div>
              <label className="mt-4 block text-xs font-bold text-[#f4efe6]">Quote<textarea rows={5} value={quoteText} onChange={(e) => setQuoteText(e.target.value)} placeholder="Paste or type the quote..." className="mt-2 w-full rounded-xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6]" /></label>
              <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-[#f4efe6]">Page / Chapter / Location<input value={quotePageOrChapter} onChange={(e) => setQuotePageOrChapter(e.target.value)} placeholder="Optional" className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Note<input value={quoteNote} onChange={(e) => setQuoteNote(e.target.value)} placeholder="Why you saved it (optional)" className="inkbound-select mt-2 w-full" /></label></div>
              <button type="button" onClick={saveQuote} disabled={!quoteText.trim()} className="quiet-shelf-primary-action mt-4 disabled:opacity-45"><Save className="h-4 w-4" /> {editingQuoteId ? 'Save Changes' : 'Save Quote'}</button>
            </section>
            {(book.favoriteQuotes?.length ?? 0) === 0 ? <div className="rounded-2xl border border-dashed border-[#3d2448] p-8 text-center text-sm text-stone-400">No saved quotes yet.</div> : <div className="space-y-3">{(book.favoriteQuotes ?? []).map((quote) => <article key={quote.id} className="rounded-2xl border border-[#3d2448] bg-[#120817] p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="whitespace-pre-wrap font-serif text-lg leading-7 text-[#f4efe6]">“{quote.quote}”</p>{quote.pageOrChapter && <p className="mt-2 text-xs font-semibold text-[#e5c158]">{quote.pageOrChapter}</p>}{quote.note && <p className="mt-2 text-sm leading-6 text-stone-400">{quote.note}</p>}</div><button type="button" onClick={() => onUpdateBook(setFavoriteSavedQuote(book, quote.id))} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${quote.isFavorite ? 'border-[#c5a059]/60 bg-[#c5a059]/15 text-[#e5c158]' : 'border-[#3d2448] text-stone-500'}`} aria-label={quote.isFavorite ? 'Favorite quote' : 'Make favorite quote'} title="Use as default Favorite Quote"><Star className={`h-4 w-4 ${quote.isFavorite ? 'fill-current' : ''}`} /></button></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => editQuote(quote.id)} className="quiet-shelf-secondary-action"><Pencil className="h-4 w-4" /> Edit</button><button type="button" onClick={() => { onUpdateBook(deleteSavedQuote(book, quote.id)); if (editingQuoteId === quote.id) resetQuoteEditor(); }} className="quiet-shelf-secondary-action text-rose-300"><Trash2 className="h-4 w-4" /> Delete</button></div></article>)}</div>}
          </div>}
          {activeTab === 'reading' && <div className="space-y-5"><section className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-stone-400">Reading Progress</p><p className="mt-1 font-serif text-4xl font-bold text-[#f4efe6]">{readingState.progressPercentage}%</p></div><BookOpen className="h-9 w-9 text-[#c5a059]" /></div></section><div className="grid gap-4 sm:grid-cols-2">{activeEdition.format === 'audiobook' ? <label className="text-xs font-bold text-[#f4efe6]">Current Minute<CanonicalNumberInput inputMode="numeric" min={0} max={activeEdition.audiobookDurationMins} value={book.progressMinutes} onCommit={(value) => { if (value === undefined) return; onCorrectProgress(book.id, { progressMinutes: Math.max(0, value) }); }} className="inkbound-select mt-2 w-full" /><span className="mt-1 block text-[11px] font-normal text-stone-500">Your current audiobook position. This is not automatically counted as today’s listening activity.</span></label> : <label className="text-xs font-bold text-[#f4efe6]">Current Page<CanonicalNumberInput inputMode="numeric" min={0} max={activeEdition.pageCount} value={book.progressPages} onCommit={(value) => { if (value === undefined) return; onCorrectProgress(book.id, { progressPages: Math.max(0, value) }); }} className="inkbound-select mt-2 w-full" /><span className="mt-1 block text-[11px] font-normal text-stone-500">Where you are in the book now. Inkbound only counts the increase toward today if you confirm it.</span></label>}<label className="text-xs font-bold text-[#f4efe6]">Progress %<CanonicalNumberInput inputMode="numeric" min={0} max={100} value={readingState.progressPercentage} onCommit={(value) => { if (value === undefined) return; correctProgressPercentage(value); }} className="inkbound-select mt-2 w-full" /><span className="mt-1 block text-[11px] font-normal text-stone-500">Changing this can update the current page/minute when the edition total is known.</span></label></div>{book.status === 'finished' && <p className="rounded-xl border border-[#c5a059]/25 bg-[#25132f] p-3 text-xs leading-5 text-stone-300">Finished status is independent from page totals. If this book was marked Finished by mistake, change its status above. Progress can still be corrected without erasing your finished date.</p>}<div className="grid gap-4 sm:grid-cols-2"><div><div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs font-bold text-[#f4efe6]">Rating</p><span className="flex items-center gap-1 text-xs text-[#e5c158]"><Star className="h-4 w-4 fill-current" />{bookRatingLabel(book.rating)}</span></div><IconStepRating value={book.rating} onChange={(rating) => updateOptionalRating('rating', rating)} kind="star" ariaLabel="Book rating" /></div><div><div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs font-bold text-[#f4efe6]">Spice Level</p><span className="flex items-center gap-1 text-xs text-orange-300"><ChiliPepperIcon className="h-4 w-4" />{spiceLevelLabel(book.spiceLevel)}</span></div><IconStepRating value={book.spiceLevel} onChange={(spiceLevel) => updateOptionalRating('spiceLevel', spiceLevel)} kind="spice" ariaLabel="Spice level" allowZero /></div></div><button type="button" onClick={() => onStartSession(book)} className="quiet-shelf-primary-action"><Play className="h-4 w-4 fill-current" /> Start Reading Session</button></div>}
          {activeTab === 'rereads' && <div className="space-y-5"><section className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-5"><p className="text-xs font-bold uppercase tracking-wider text-stone-400">Times read</p><p className="mt-2 font-serif text-4xl font-bold text-[#f4efe6]">{getEffectiveRereadCount(book) + 1}×</p><p className="mt-1 text-xs text-stone-500">Original read + {getEffectiveRereadCount(book)} reread{getEffectiveRereadCount(book) === 1 ? '' : 's'}</p></div><div className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-5"><p className="text-xs font-bold uppercase tracking-wider text-stone-400">Reading sessions</p><p className="mt-2 font-serif text-4xl font-bold text-[#f4efe6]">{bookSessions.length}</p><p className="mt-1 text-xs text-stone-500">Persisted sessions for this book</p></div><div className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-5"><p className="text-xs font-bold uppercase tracking-wider text-stone-400">Latest finish</p><p className="mt-2 font-serif text-xl font-bold text-[#f4efe6]">{getReadingCompletions(book).at(-1)?.date || book.dateFinished || 'Not recorded'}</p><p className="mt-1 text-xs text-stone-500">Current canonical finished date</p></div></section><section className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-serif text-xl text-[#f4efe6]">Reread count</h3><p className="mt-1 max-w-xl text-xs leading-5 text-stone-400">Correct the number of times you have reread this book. Inkbound preserves this on the canonical book record; changing it does not delete sessions or dates.</p></div><label className="w-full text-xs font-bold text-[#f4efe6] sm:w-40">Rereads<CanonicalNumberInput inputMode="numeric" min={0} value={book.rereadCount ?? 0} onCommit={(value) => { if (value === undefined) return; onUpdateBook({ ...book, rereadCount: Math.max(0, Math.floor(value)) }); }} className="inkbound-select mt-2 w-full" /></label></div></section>{bookSessions.length > 0 && <section className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-5"><h3 className="font-serif text-xl text-[#f4efe6]">Reading activity</h3><div className="mt-4 grid gap-3 sm:grid-cols-3"><div><p className="text-xs text-stone-500">Tracked time</p><p className="mt-1 font-bold text-[#f4efe6]">{bookSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0).toLocaleString()} min</p></div><div><p className="text-xs text-stone-500">Pages tracked</p><p className="mt-1 font-bold text-[#f4efe6]">{bookSessions.reduce((sum, session) => sum + getSessionPagesRead(session), 0).toLocaleString()}</p></div><div><p className="text-xs text-stone-500">Listening tracked</p><p className="mt-1 font-bold text-[#f4efe6]">{bookSessions.reduce((sum, session) => sum + getSessionListeningMinutes(session), 0).toLocaleString()} min</p></div></div></section>}</div>}
          {activeTab === 'sessions' && <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setIsManualEntryOpen(true)} className="quiet-shelf-secondary-action justify-center"><Plus className="h-4 w-4" /> Add Past Session</button>
              <button type="button" onClick={() => setIsBulkManualEntryOpen(true)} className="quiet-shelf-secondary-action justify-center"><Plus className="h-4 w-4" /> Add Multiple</button>
              <button type="button" onClick={() => onStartSession(book)} className="quiet-shelf-primary-action justify-center"><Play className="h-4 w-4 fill-current" /> Start Reading Session</button>
            </div>
            {bookSessions.length === 0 ? <div className="rounded-2xl border border-dashed border-[#3d2448] p-8 text-center text-sm text-stone-400">No reading sessions logged for this book yet.</div> : bookSessions.map((session) => {
              const durationMinutes = getSessionDurationMinutes(session);
              const pagesRead = getSessionPagesRead(session);
              const minutesListened = getSessionListeningMinutes(session);
              return <article key={session.id} className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="text-[#f4efe6]">{session.date}</strong><p className="mt-2 text-xs text-stone-400">{session.startTime}–{session.endTime}{pagesRead > 0 ? ` · ${pagesRead} pages` : ''}{minutesListened > 0 ? ` · ${minutesListened} min listened` : ''}</p></div><div className="flex shrink-0 items-center gap-2"><span className="text-xs text-[#e5c158]">{durationMinutes} min</span><button type="button" onClick={() => setEditingSession(session)} className="quiet-shelf-secondary-action min-h-11 px-3" aria-label={`Edit session from ${session.date}`}><Pencil className="h-4 w-4" /><span>Edit</span></button></div></div>{session.notes && <p className="mt-3 text-sm text-stone-300">{session.notes}</p>}</article>;
            })}
          </div>}
          {activeTab === 'editions' && <div className="space-y-5"><div className="grid gap-4 lg:grid-cols-[220px_1fr]"><div className="space-y-3">{book.editions.map((edition) => <button key={edition.id} type="button" onClick={() => activateEdition(edition)} className={`w-full rounded-xl border p-3 text-left ${edition.id === book.activeEditionId ? 'border-[#c5a059] bg-[#c5a059]/10' : 'border-[#3d2448] bg-[#25132f]'}`}><strong className="capitalize text-[#f4efe6]">{edition.format}</strong>{edition.id === book.activeEditionId && <span className="ml-2 text-xs text-[#e5c158]">Active</span>}</button>)}</div><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-[#f4efe6]">Format<select value={activeEdition.format} onChange={(e) => updateActiveEdition({ format: e.target.value as Format })} className="inkbound-select mt-2 w-full">{FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="text-xs font-bold text-[#f4efe6]">ISBN<input value={activeEdition.isbn ?? activeEdition.isbn13 ?? activeEdition.isbn10 ?? ''} onChange={(e) => updateActiveEdition({ isbn: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Page Count<input inputMode="numeric" min={0} type="number" value={activeEdition.pageCount ?? ''} onChange={(e) => { stopAutomaticEnrichmentForBook(book.id); onCorrectProgress(book.id, { pageCount: e.target.value ? Math.max(0, Number(e.target.value)) : 0 }); }} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Audiobook Minutes<input inputMode="numeric" min={0} type="number" value={activeEdition.audiobookDurationMins ?? ''} onChange={(e) => { stopAutomaticEnrichmentForBook(book.id); onCorrectProgress(book.id, { audiobookDurationMins: e.target.value ? Math.max(0, Number(e.target.value)) : 0 }); }} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Publisher<input value={activeEdition.publisher ?? ''} onChange={(e) => updateActiveEdition({ publisher: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Publication Date<input type="date" value={activeEdition.publicationDate?.slice(0,10) ?? ''} onChange={(e) => updateActiveEdition({ publicationDate: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Language<input value={activeEdition.language ?? ''} onChange={(e) => updateActiveEdition({ language: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Edition Name<input value={activeEdition.editionName ?? ''} onChange={(e) => updateActiveEdition({ editionName: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label></div></div><section className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-4"><div className="flex flex-col gap-3 sm:flex-row"><select value={newEditionFormat} onChange={(e) => setNewEditionFormat(e.target.value as Format)} className="inkbound-select">{FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button type="button" onClick={addEdition} className="quiet-shelf-primary-action justify-center"><Plus className="h-4 w-4" /> Add Edition</button></div></section></div>}
        </div>
        <footer className="book-details-bottom-toolbar shrink-0 border-t border-[#3d2448] bg-[#17101b] px-3 py-2" aria-label="Book actions" />
      </section>
      {isManualEntryOpen && <SessionEditorModal books={[book]} onClose={() => setIsManualEntryOpen(false)} onSave={onSaveManualSession} />}
      {isBulkManualEntryOpen && <BulkHistoricalSessionsModal books={[book]} onClose={() => setIsBulkManualEntryOpen(false)} onSave={onSaveManualSessions} />}
      {editingSession && <SessionEditorModal books={[book]} session={editingSession} onClose={() => setEditingSession(null)} onSave={onUpdateSession} onDelete={onDeleteSession} />}
      {coverManagerOpen && <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-4" onClick={() => setCoverManagerOpen(false)}><section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-3xl border border-[#c5a059]/40 bg-[#17101b] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-h-[92dvh] sm:rounded-3xl sm:p-7" role="dialog" aria-modal="true" aria-label="Manage book cover" onClick={(e) => e.stopPropagation()}><div className="flex justify-between"><h2 className="font-serif text-3xl text-[#f4efe6]">Manage Cover</h2><button type="button" onClick={() => setCoverManagerOpen(false)} className="grid h-11 w-11 place-items-center rounded-full" aria-label="Close cover manager"><X className="h-5 w-5" /></button></div>{coverMode === 'choices' ? <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><button type="button" onClick={() => { setCoverError(null); setCoverMode('search'); }} className="rounded-2xl border border-[#c5a059]/25 bg-[#25132f] p-5 text-left"><Search className="h-6 w-6 text-[#e5c158]" /><h3 className="mt-3 font-serif text-xl text-[#f4efe6]">Search Online</h3></button><button type="button" onClick={() => { setCoverError(null); setCoverUrl(activeEdition.coverUrl?.startsWith('https://') ? activeEdition.coverUrl : ''); setCoverMode('url'); }} className="rounded-2xl border border-[#c5a059]/25 bg-[#25132f] p-5 text-left"><ImagePlus className="h-6 w-6 text-[#e5c158]" /><h3 className="mt-3 font-serif text-xl text-[#f4efe6]">Cover URL</h3><p className="mt-2 text-xs leading-5 text-stone-400">Paste a direct HTTPS image link.</p></button><label className="cursor-pointer rounded-2xl border border-[#c5a059]/25 bg-[#25132f] p-5"><Upload className="h-6 w-6 text-[#e5c158]" /><h3 className="mt-3 font-serif text-xl text-[#f4efe6]">Upload Your Own</h3><p className="mt-2 text-xs leading-5 text-stone-400">Phone photos are optimized before saving so your library stays fast and sync-safe.</p><input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadCover} className="sr-only" /></label><button type="button" onClick={() => { updateActiveEdition({ coverUrl: undefined }); setCoverManagerOpen(false); }} className="rounded-2xl border border-rose-500/25 bg-[#25132f] p-5 text-left"><Trash2 className="h-6 w-6 text-rose-300" /><h3 className="mt-3 font-serif text-xl text-[#f4efe6]">Remove Cover</h3></button></div> : coverMode === 'url' ? <div className="mt-6 space-y-4"><button type="button" onClick={() => { setCoverError(null); setCoverMode('choices'); }} className="min-h-11 text-xs font-bold text-[#e5c158]">← Back</button><label className="block text-sm font-bold text-[#f4efe6]">Cover image URL<input type="url" inputMode="url" value={coverUrl} onChange={(e) => { setCoverUrl(e.target.value); setCoverError(null); }} placeholder="https://example.com/cover.jpg" className="inkbound-select mt-2 w-full" /></label><p className="text-xs leading-5 text-stone-400">Use a direct HTTPS image link. The image must be publicly accessible; links can stop working if their host removes them.</p>{coverUrl.trim() && /^https:\/\//i.test(coverUrl.trim()) && <div className="flex justify-center py-2"><img src={coverUrl.trim()} alt="Cover URL preview" className="max-h-64 max-w-[180px] rounded-xl object-contain shadow-xl" onError={() => setCoverError('Inkbound could not load that image URL. Check that it is a direct, public image link.')} /></div>}{coverError && <p className="text-sm text-rose-300">{coverError}</p>}<button type="button" onClick={useCoverUrl} disabled={!coverUrl.trim()} className="quiet-shelf-primary-action w-full justify-center">Use This Cover</button></div> : <div className="mt-6 space-y-4"><button type="button" onClick={() => setCoverMode('choices')} className="min-h-11 text-xs font-bold text-[#e5c158]">← Back</button><form onSubmit={searchCovers} className="flex flex-col gap-3 sm:flex-row"><input value={coverQuery} onChange={(e) => setCoverQuery(e.target.value)} className="inkbound-select min-w-0 flex-1" /><button type="submit" className="quiet-shelf-primary-action justify-center" disabled={coverSearching}>{coverSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search</button></form>{coverError && <p className="text-sm text-rose-300">{coverError}</p>}<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{coverResults.flatMap((group) => group.editions.filter((edition) => edition.coverUrl).map((edition) => ({ group, edition }))).map(({ group, edition }) => <button key={`${group.key}-${edition.externalEditionId}`} type="button" onClick={() => chooseOnlineCover(edition)} className="rounded-xl border border-[#3d2448] bg-[#25132f] p-3 text-left"><img src={edition.coverUrl} alt={`Cover for ${group.title}`} className="aspect-[2/3] w-full rounded-lg object-cover" /><p className="mt-2 line-clamp-2 text-xs text-[#f4efe6]">{group.title}</p></button>)}</div></div>}</section></div>}
      {deleteConfirmOpen && <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/80 p-3 sm:p-4" onClick={() => setDeleteConfirmOpen(false)}><section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-rose-500/35 bg-[#17101b] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:rounded-3xl" role="dialog" aria-modal="true" aria-label="Delete book confirmation" onClick={(e) => e.stopPropagation()}><h2 className="font-serif text-2xl text-[#f4efe6]">Delete this book?</h2><p className="mt-2 text-sm text-stone-400">“{book.work.title}” and its reading sessions will be removed.</p><div className="mt-6 grid grid-cols-2 gap-3"><button type="button" onClick={() => setDeleteConfirmOpen(false)} className="flex min-h-11 w-full items-center justify-center rounded-xl border border-[#c5a059]/25 bg-[#25172b] px-3 py-2 text-sm font-semibold text-[#f4efe6]">Cancel</button><button type="button" onClick={() => onDeleteBook(book)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-500/35 bg-rose-950/30 px-3 py-2 text-sm font-semibold text-rose-300"><Trash2 className="h-4 w-4 shrink-0" /> Delete Book</button></div></section></div>}
    </div>
  );
};

