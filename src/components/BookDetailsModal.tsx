import React, { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { BookOpen, ImagePlus, Loader2, Play, Plus, RefreshCw, Save, Search, Star, Trash2, Upload, X } from 'lucide-react';
import { searchGoogleBooks } from '../features/book-search/data/googleBooksApi';
import { fetchOpenLibrarySummary } from '../features/book-search/data/openLibraryApi';
import type { BookSearchEdition, BookSearchWorkGroup } from '../features/book-search/model/bookSearch';
import {
  getSessionDurationMinutes,
  getSessionListeningMinutes,
  getSessionPagesRead,
} from '../features/reading/sessionAnalytics';
import type { Edition, Format, OwnershipStatus, Priority, ReadingSession, ReadingStatus, UserBookRecord } from '../types';
import { BookCover } from './BookCover';

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
}

type DetailsTab = 'details' | 'summary' | 'reading' | 'sessions' | 'editions';
type CoverMode = 'choices' | 'search';

const MAX_COVER_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ENRICHMENT_QUEUE_KEY = 'inkbound_import_enrichment_queue_v3';
const MATCH_STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'book', 'books', 'series', 'complete', 'edition']);

const normalize = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
const tokens = (value?: string) => [...new Set(normalize(value).split(' ').filter((token) => token.length >= 3 && !MATCH_STOP_WORDS.has(token)))];
const csvList = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];

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
    const raw = localStorage.getItem(ENRICHMENT_QUEUE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Array<{ targetBookId?: string }>;
    const next = Array.isArray(parsed) ? parsed.filter((item) => item.targetBookId !== bookId) : [];
    if (next.length) localStorage.setItem(ENRICHMENT_QUEUE_KEY, JSON.stringify(next));
    else localStorage.removeItem(ENRICHMENT_QUEUE_KEY);
  } catch {
    // User edits still save even if queue cleanup is unavailable.
  }
};

export const BookDetailsModal: React.FC<BookDetailsModalProps> = ({ book, sessions, onClose, onUpdateBook, onCorrectProgress, onDeleteBook, onStartSession }) => {
  const [activeTab, setActiveTab] = useState<DetailsTab>('details');
  const [coverManagerOpen, setCoverManagerOpen] = useState(false);
  const [coverMode, setCoverMode] = useState<CoverMode>('choices');
  const [coverQuery, setCoverQuery] = useState('');
  const [coverResults, setCoverResults] = useState<BookSearchWorkGroup[]>([]);
  const [coverSearching, setCoverSearching] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [isSyncingBook, setIsSyncingBook] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [newEditionFormat, setNewEditionFormat] = useState<Format>('paperback');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [seriesName, setSeriesName] = useState('');
  const [seriesOrder, setSeriesOrder] = useState('');
  const [summary, setSummary] = useState('');
  const [publisherSummary, setPublisherSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [review, setReview] = useState('');
  const [tags, setTags] = useState('');
  const [collections, setCollections] = useState('');

  useEffect(() => {
    setActiveTab('details');
    setTitle(book?.work.title ?? '');
    setAuthor(book?.work.author ?? '');
    setSeriesName(book?.work.seriesName ?? '');
    setSeriesOrder(book?.work.seriesOrder ? String(book.work.seriesOrder) : '');
    setSummary(book?.work.personalSummary ?? '');
    setPublisherSummary(book?.work.publisherSummary ?? '');
    setNotes(book?.personalNotes ?? '');
    setReview(book?.review ?? '');
    setTags((book?.privateTags ?? []).join(', '));
    setCollections((book?.collections ?? []).join(', '));
    setCoverQuery(book ? `${book.work.title} ${book.work.author}` : '');
    setCoverResults([]);
    setCoverError(null);
    setSyncMessage(null);
  }, [book?.id]);

  const activeEdition = useMemo(() => book?.editions.find((edition) => edition.id === book.activeEditionId) ?? book?.editions[0], [book]);
  const bookSessions = useMemo(
    () => sessions.filter((session) => session.bookId === book?.id).sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`)),
    [sessions, book?.id],
  );

  if (!book || !activeEdition) return null;

  const updateBook = (changes: Partial<UserBookRecord>) => onUpdateBook({ ...book, ...changes });
  const updateActiveEdition = (changes: Partial<Edition>, markManual = true) => {
    if (markManual) stopAutomaticEnrichmentForBook(book.id);
    onUpdateBook({
      ...book,
      editions: book.editions.map((edition) => edition.id === activeEdition.id ? { ...edition, ...changes, ...(markManual ? { externalSource: 'manual' as const } : {}) } : edition),
    });
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
        seriesOrder: seriesOrder.trim() ? Math.max(0, Number(seriesOrder)) || undefined : undefined,
      },
      privateTags: csvList(tags),
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

  const updateStatus = (status: ReadingStatus) => {
    if (status === 'finished') {
      if (activeEdition.format === 'audiobook' && activeEdition.audiobookDurationMins && activeEdition.audiobookDurationMins > 0) {
        onCorrectProgress(book.id, { progressMinutes: activeEdition.audiobookDurationMins });
        return;
      }
      if (activeEdition.format !== 'audiobook' && activeEdition.pageCount && activeEdition.pageCount > 0) {
        onCorrectProgress(book.id, { progressPages: activeEdition.pageCount });
        return;
      }

      // A user may finish a book whose total length is unknown, but we must not
      // invent a 100% progress value without a canonical edition total.
      updateBook({ status: 'finished', dateFinished: book.dateFinished ?? new Date().toISOString().split('T')[0] });
      return;
    }

    updateBook({ status, dateFinished: undefined });
  };

  const correctProgressPercentage = (percentage: number) => {
    const safePercentage = Math.max(0, Math.min(100, percentage));
    if (activeEdition.format === 'audiobook' && activeEdition.audiobookDurationMins) {
      onCorrectProgress(book.id, { progressMinutes: Math.round((safePercentage / 100) * activeEdition.audiobookDurationMins) });
      return;
    }
    if (activeEdition.pageCount) {
      onCorrectProgress(book.id, { progressPages: Math.round((safePercentage / 100) * activeEdition.pageCount) });
      return;
    }
    updateBook({ progressPercentage: safePercentage, ...(safePercentage < 100 && book.status === 'finished' ? { status: 'currently-reading' as const, dateFinished: undefined } : {}) });
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
          publicationYear: book.work.publicationYear || matchedEdition.publicationYear,
          originalLanguage: book.work.originalLanguage || matchedEdition.language,
          externalWorkId: matchedWork.key,
        },
        editions: book.editions.map((edition) => edition.id === activeEdition.id ? nextEdition : edition),
      };
      onUpdateBook(nextBook);
      setPublisherSummary(nextBook.work.publisherSummary ?? '');
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

  const uploadCover = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ACCEPTED_COVER_TYPES.includes(file.type)) return setCoverError('Please choose a JPG, PNG, or WEBP image.');
    if (file.size > MAX_COVER_FILE_BYTES) return setCoverError('Please choose an image smaller than 5 MB.');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      updateActiveEdition({ coverUrl: reader.result });
      setCoverManagerOpen(false);
    };
    reader.onerror = () => setCoverError('Inkbound could not read that image.');
    reader.readAsDataURL(file);
  };

  const addEdition = () => {
    stopAutomaticEnrichmentForBook(book.id);
    const edition: Edition = { id: `edition-${Date.now()}`, format: newEditionFormat, coverGradient: 'from-[#5c3d62] via-[#35243f] to-[#171117]', externalSource: 'manual' };
    onUpdateBook({ ...book, activeEditionId: edition.id, editions: [...book.editions, edition] });
  };

  const metadataLabel = activeEdition.externalSource === 'manual' ? 'Manual / user-edited' : activeEdition.externalSource ? `Verified via ${activeEdition.externalSource.replaceAll('-', ' ')}` : book.sourceOfImport?.toLowerCase().includes('import') ? 'Imported record' : 'Inkbound record';
  const tabs: Array<{ id: DetailsTab; label: string }> = [
    { id: 'details', label: 'Book Details' }, { id: 'summary', label: 'Summary & Notes' }, { id: 'reading', label: 'Reading' }, { id: 'sessions', label: `Sessions (${bookSessions.length})` }, { id: 'editions', label: `Editions (${book.editions.length})` },
  ];

  return (
    <div className="fixed inset-0 z-[130] flex items-end bg-black/75 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <section className="flex max-h-[96dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] shadow-2xl sm:max-h-[92vh] sm:max-w-5xl sm:rounded-3xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <header className="relative border-b border-[#3d2448] bg-gradient-to-r from-[#281333] via-[#1d0e26] to-[#140a1a] p-4 sm:p-6">
          <button type="button" onClick={onClose} className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-black/30 text-stone-300" aria-label="Close book details"><X className="h-5 w-5" /></button>
          <div className="flex items-start gap-4 pr-10 sm:gap-6"><button type="button" onClick={() => { setCoverManagerOpen(true); setCoverMode('choices'); }} className="shrink-0"><BookCover work={book.work} edition={activeEdition} size="lg" /></button><div className="min-w-0 flex-1"><span className="inline-flex rounded bg-[#c5a059] px-2 py-1 text-[10px] font-bold uppercase text-[#120817]">{activeEdition.format}</span><h2 className="mt-3 line-clamp-2 font-serif text-2xl font-bold text-[#f4efe6] sm:text-4xl">{book.work.title}</h2><p className="mt-1 text-sm italic text-stone-400">by {book.work.author}</p><p className="mt-2 text-xs text-[#b9aaba]">Metadata: <strong className="text-[#e5c158]">{metadataLabel}</strong></p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setCoverManagerOpen(true)} className="quiet-shelf-secondary-action"><ImagePlus className="h-4 w-4" /> Cover</button><button type="button" onClick={() => void syncBookMetadata()} disabled={isSyncingBook} className="quiet-shelf-secondary-action"><RefreshCw className={`h-4 w-4 ${isSyncingBook ? 'animate-spin' : ''}`} /> Sync Metadata</button><button type="button" onClick={() => setDeleteConfirmOpen(true)} className="quiet-shelf-secondary-action text-rose-300"><Trash2 className="h-4 w-4" /> Delete</button></div>{syncMessage && <p className="mt-2 text-xs text-[#b9aaba]">{syncMessage}</p>}</div></div>
        </header>
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#3d2448] bg-[#120817] px-3 py-2 text-xs font-semibold">{tabs.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`min-h-11 whitespace-nowrap rounded-xl px-4 ${activeTab === tab.id ? 'bg-[#c5a059] font-bold text-[#120817]' : 'text-stone-400 hover:bg-[#25132f]'}`}>{tab.label}</button>)}</nav>
        <div className="flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6">
          {activeTab === 'details' && <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-[#f4efe6]">Title<input value={title} onChange={(e) => setTitle(e.target.value)} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Author<input value={author} onChange={(e) => setAuthor(e.target.value)} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Series<input value={seriesName} onChange={(e) => setSeriesName(e.target.value)} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Series #<input type="number" min={0} step="0.5" value={seriesOrder} onChange={(e) => setSeriesOrder(e.target.value)} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Status<select value={book.status} onChange={(e) => updateStatus(e.target.value as ReadingStatus)} className="inkbound-select mt-2 w-full"><option value="currently-reading">Currently Reading</option><option value="tbr">TBR</option><option value="finished">Finished</option><option value="paused">Paused</option><option value="dnf">Did Not Finish</option><option value="wishlist">Wishlist</option></select></label><label className="text-xs font-bold text-[#f4efe6]">Ownership<select value={book.ownership} onChange={(e) => updateBook({ ownership: e.target.value as OwnershipStatus })} className="inkbound-select mt-2 w-full"><option value="owned">Owned</option><option value="borrowed-library">Library</option><option value="borrowed-person">Borrowed</option><option value="subscription">Subscription</option><option value="wishlist">Wishlist</option><option value="none">None</option></select></label><label className="text-xs font-bold text-[#f4efe6]">Priority<select value={book.priority} onChange={(e) => updateBook({ priority: e.target.value as Priority })} className="inkbound-select mt-2 w-full"><option value="top">Top</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label className="text-xs font-bold text-[#f4efe6]">Date Added<input type="date" value={book.dateAdded} onChange={(e) => updateBook({ dateAdded: e.target.value })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Date Started<input type="date" value={book.dateStarted ?? ''} onChange={(e) => updateBook({ dateStarted: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Date Finished<input type="date" value={book.dateFinished ?? ''} onChange={(e) => updateBook({ dateFinished: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label></div><label className="block text-xs font-bold text-[#f4efe6]">Tags<input value={tags} onChange={(e) => setTags(e.target.value)} className="inkbound-select mt-2 w-full" /></label><label className="block text-xs font-bold text-[#f4efe6]">Collections<input value={collections} onChange={(e) => setCollections(e.target.value)} className="inkbound-select mt-2 w-full" /></label><button type="button" onClick={saveDetails} className="quiet-shelf-primary-action"><Save className="h-4 w-4" /> Save Book Details</button></div>}
          {activeTab === 'summary' && <div className="space-y-5"><label className="block text-xs font-bold text-[#f4efe6]">My Summary<textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} className="mt-2 w-full rounded-xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6]" /></label><label className="block text-xs font-bold text-[#f4efe6]">Publisher Summary<textarea rows={6} value={publisherSummary} onChange={(e) => setPublisherSummary(e.target.value)} className="mt-2 w-full rounded-xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6]" /></label><label className="block text-xs font-bold text-[#f4efe6]">Review<textarea rows={5} value={review} onChange={(e) => setReview(e.target.value)} className="mt-2 w-full rounded-xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6]" /></label><label className="block text-xs font-bold text-[#f4efe6]">Private Notes<textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-2 w-full rounded-xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6]" /></label><button type="button" onClick={saveSummary} className="quiet-shelf-primary-action"><Save className="h-4 w-4" /> Save Summary & Notes</button></div>}
          {activeTab === 'reading' && <div className="space-y-5"><section className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-stone-400">Reading Progress</p><p className="mt-1 font-serif text-4xl font-bold text-[#f4efe6]">{book.progressPercentage}%</p></div><BookOpen className="h-9 w-9 text-[#c5a059]" /></div></section><div className="grid gap-4 sm:grid-cols-3"><label className="text-xs font-bold text-[#f4efe6]">Pages Read<input min={0} type="number" value={book.progressPages} onChange={(e) => onCorrectProgress(book.id, { progressPages: Math.max(0, Number(e.target.value) || 0) })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Minutes Listened<input min={0} type="number" value={book.progressMinutes} onChange={(e) => onCorrectProgress(book.id, { progressMinutes: Math.max(0, Number(e.target.value) || 0) })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Progress %<input min={0} max={100} type="number" value={book.progressPercentage} onChange={(e) => correctProgressPercentage(Number(e.target.value) || 0)} className="inkbound-select mt-2 w-full" /></label></div>{book.status === 'finished' && <p className="rounded-xl border border-[#c5a059]/25 bg-[#25132f] p-3 text-xs leading-5 text-stone-300">Finished by mistake? Change the status, current page/minute, or edition length. Inkbound will recalculate progress and correct the latest session that established the current endpoint.</p>}<div><p className="mb-2 text-xs font-bold text-[#f4efe6]">Rating</p><div className="flex flex-wrap gap-2">{[1,2,3,4,5].map((rating) => <button key={rating} type="button" onClick={() => updateBook({ rating })} className="grid h-11 w-11 place-items-center rounded-xl border border-[#3d2448] bg-[#120817]"><Star className={`h-5 w-5 ${(book.rating ?? 0) >= rating ? 'fill-[#e5c158] text-[#e5c158]' : 'text-stone-600'}`} /></button>)}<button type="button" onClick={() => updateBook({ rating: undefined })} className="quiet-shelf-secondary-action">Clear</button></div></div><button type="button" onClick={() => onStartSession(book)} className="quiet-shelf-primary-action"><Play className="h-4 w-4 fill-current" /> Start Reading Session</button></div>}
          {activeTab === 'sessions' && <div className="space-y-3">{bookSessions.length === 0 ? <div className="rounded-2xl border border-dashed border-[#3d2448] p-8 text-center text-sm text-stone-400">No reading sessions logged for this book yet.</div> : bookSessions.map((session) => {
            const durationMinutes = getSessionDurationMinutes(session);
            const pagesRead = getSessionPagesRead(session);
            const minutesListened = getSessionListeningMinutes(session);
            return <article key={session.id} className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-4"><div className="flex justify-between gap-2"><strong className="text-[#f4efe6]">{session.date}</strong><span className="text-xs text-[#e5c158]">{durationMinutes} min</span></div><p className="mt-2 text-xs text-stone-400">{session.startTime}–{session.endTime}{pagesRead > 0 ? ` · ${pagesRead} pages` : ''}{minutesListened > 0 ? ` · ${minutesListened} min listened` : ''}</p>{session.notes && <p className="mt-3 text-sm text-stone-300">{session.notes}</p>}</article>;
          })}</div>}
          {activeTab === 'editions' && <div className="space-y-5"><div className="grid gap-4 lg:grid-cols-[220px_1fr]"><div className="space-y-3">{book.editions.map((edition) => <button key={edition.id} type="button" onClick={() => onUpdateBook({ ...book, activeEditionId: edition.id })} className={`w-full rounded-xl border p-3 text-left ${edition.id === book.activeEditionId ? 'border-[#c5a059] bg-[#c5a059]/10' : 'border-[#3d2448] bg-[#25132f]'}`}><strong className="capitalize text-[#f4efe6]">{edition.format}</strong>{edition.id === book.activeEditionId && <span className="ml-2 text-xs text-[#e5c158]">Active</span>}</button>)}</div><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-[#f4efe6]">Format<select value={activeEdition.format} onChange={(e) => updateActiveEdition({ format: e.target.value as Format })} className="inkbound-select mt-2 w-full"><option value="hardcover">Hardcover</option><option value="paperback">Paperback</option><option value="ebook">Ebook</option><option value="audiobook">Audiobook</option></select></label><label className="text-xs font-bold text-[#f4efe6]">ISBN<input value={activeEdition.isbn ?? activeEdition.isbn13 ?? activeEdition.isbn10 ?? ''} onChange={(e) => updateActiveEdition({ isbn: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Page Count<input min={0} type="number" value={activeEdition.pageCount ?? ''} onChange={(e) => { stopAutomaticEnrichmentForBook(book.id); onCorrectProgress(book.id, { pageCount: e.target.value ? Math.max(0, Number(e.target.value)) : 0 }); }} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Audiobook Minutes<input min={0} type="number" value={activeEdition.audiobookDurationMins ?? ''} onChange={(e) => { stopAutomaticEnrichmentForBook(book.id); onCorrectProgress(book.id, { audiobookDurationMins: e.target.value ? Math.max(0, Number(e.target.value)) : 0 }); }} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Publisher<input value={activeEdition.publisher ?? ''} onChange={(e) => updateActiveEdition({ publisher: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Publication Date<input type="date" value={activeEdition.publicationDate?.slice(0,10) ?? ''} onChange={(e) => updateActiveEdition({ publicationDate: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Language<input value={activeEdition.language ?? ''} onChange={(e) => updateActiveEdition({ language: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label><label className="text-xs font-bold text-[#f4efe6]">Edition Name<input value={activeEdition.editionName ?? ''} onChange={(e) => updateActiveEdition({ editionName: e.target.value || undefined })} className="inkbound-select mt-2 w-full" /></label></div></div><section className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-4"><div className="flex gap-3"><select value={newEditionFormat} onChange={(e) => setNewEditionFormat(e.target.value as Format)} className="inkbound-select"><option value="hardcover">Hardcover</option><option value="paperback">Paperback</option><option value="ebook">Ebook</option><option value="audiobook">Audiobook</option></select><button type="button" onClick={addEdition} className="quiet-shelf-primary-action"><Plus className="h-4 w-4" /> Add Edition</button></div></section></div>}
        </div>
      </section>
      {coverManagerOpen && <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setCoverManagerOpen(false)}><section className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-[#c5a059]/40 bg-[#17101b] p-5 sm:rounded-3xl sm:p-7" onClick={(e) => e.stopPropagation()}><div className="flex justify-between"><h2 className="font-serif text-3xl text-[#f4efe6]">Manage Cover</h2><button type="button" onClick={() => setCoverManagerOpen(false)}><X className="h-5 w-5" /></button></div>{coverMode === 'choices' ? <div className="mt-6 grid gap-4 sm:grid-cols-3"><button type="button" onClick={() => setCoverMode('search')} className="rounded-2xl border border-[#c5a059]/25 bg-[#25132f] p-5 text-left"><Search className="h-6 w-6 text-[#e5c158]" /><h3 className="mt-3 font-serif text-xl text-[#f4efe6]">Search Online</h3></button><label className="cursor-pointer rounded-2xl border border-[#c5a059]/25 bg-[#25132f] p-5"><Upload className="h-6 w-6 text-[#e5c158]" /><h3 className="mt-3 font-serif text-xl text-[#f4efe6]">Upload Your Own</h3><input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadCover} className="sr-only" /></label><button type="button" onClick={() => { updateActiveEdition({ coverUrl: undefined }); setCoverManagerOpen(false); }} className="rounded-2xl border border-rose-500/25 bg-[#25132f] p-5 text-left"><Trash2 className="h-6 w-6 text-rose-300" /><h3 className="mt-3 font-serif text-xl text-[#f4efe6]">Remove Cover</h3></button></div> : <div className="mt-6 space-y-4"><button type="button" onClick={() => setCoverMode('choices')} className="text-xs font-bold text-[#e5c158]">← Back</button><form onSubmit={searchCovers} className="flex gap-3"><input value={coverQuery} onChange={(e) => setCoverQuery(e.target.value)} className="inkbound-select min-w-0 flex-1" /><button type="submit" className="quiet-shelf-primary-action" disabled={coverSearching}>{coverSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search</button></form>{coverError && <p className="text-sm text-rose-300">{coverError}</p>}<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{coverResults.flatMap((group) => group.editions.filter((edition) => edition.coverUrl).map((edition) => ({ group, edition }))).map(({ group, edition }) => <button key={`${group.key}-${edition.externalEditionId}`} type="button" onClick={() => chooseOnlineCover(edition)} className="rounded-xl border border-[#3d2448] bg-[#25132f] p-3 text-left"><img src={edition.coverUrl} alt={`Cover for ${group.title}`} className="aspect-[2/3] w-full rounded-lg object-cover" /><p className="mt-2 line-clamp-2 text-xs text-[#f4efe6]">{group.title}</p></button>)}</div></div>}</section></div>}
      {deleteConfirmOpen && <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/80 p-4" onClick={() => setDeleteConfirmOpen(false)}><section className="w-full max-w-md rounded-3xl border border-rose-500/35 bg-[#17101b] p-6" onClick={(e) => e.stopPropagation()}><h2 className="font-serif text-2xl text-[#f4efe6]">Delete this book?</h2><p className="mt-2 text-sm text-stone-400">“{book.work.title}” and its reading sessions will be removed.</p><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setDeleteConfirmOpen(false)} className="quiet-shelf-secondary-action">Cancel</button><button type="button" onClick={() => onDeleteBook(book)} className="quiet-shelf-secondary-action text-rose-300"><Trash2 className="h-4 w-4" /> Delete Book</button></div></section></div>}
    </div>
  );
};
