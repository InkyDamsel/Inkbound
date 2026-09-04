import React, { FormEvent, useEffect, useState } from 'react';
import { BookOpen, Loader2, Search, X } from 'lucide-react';
import { searchGoogleBooks } from '../features/book-search/data/googleBooksApi';
import { createBookFromSearchEdition } from '../features/book-search/mapping/bookSearchMapper';
import type { BookSearchEdition, BookSearchWorkGroup } from '../features/book-search/model/bookSearch';
import type { Format, OwnershipStatus, Priority, ReadingStatus, UserBookRecord } from '../types';

interface AddBookModalProps {
  currentBookCount: number;
  onClose: () => void;
  onAddBook: (newBook: UserBookRecord) => void;
  onAddMultipleBooks?: (newBooks: UserBookRecord[]) => void;
}

type AddBookTab = 'search' | 'manual';
type PendingSearchEdition = { work: BookSearchWorkGroup; edition: BookSearchEdition; };

const LIST_OPTIONS: Array<{ value: ReadingStatus; label: string; description: string }> = [
  { value: 'tbr', label: 'To Be Read', description: 'Save it for later.' },
  { value: 'currently-reading', label: 'Currently Reading', description: 'Put it into your active reading list.' },
  { value: 'finished', label: 'Finished', description: 'Mark it as already read.' },
  { value: 'paused', label: 'Paused', description: 'Keep it on hold without losing your place.' },
  { value: 'dnf', label: 'Did Not Finish', description: 'Keep a record without marking it finished.' },
];

const today = () => {
  const value = new Date();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const uniqueId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const AddBookModal: React.FC<AddBookModalProps> = ({ onClose, onAddBook }) => {
  const [activeTab, setActiveTab] = useState<AddBookTab>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookSearchWorkGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [pendingSearchEdition, setPendingSearchEdition] = useState<PendingSearchEdition | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [summary, setSummary] = useState('');
  const [genres, setGenres] = useState('');
  const [pageCount, setPageCount] = useState('');
  const [format, setFormat] = useState<Format>('hardcover');
  const [status, setStatus] = useState<ReadingStatus>('tbr');
  const [ownership, setOwnership] = useState<OwnershipStatus>('owned');
  const [priority, setPriority] = useState<Priority>('medium');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pendingSearchEdition) { setPendingSearchEdition(null); return; }
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pendingSearchEdition]);

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery || isSearching) return;
    setIsSearching(true); setSearchError(null); setHasSearched(true); setPendingSearchEdition(null);
    try {
      const response = await searchGoogleBooks(trimmedQuery);
      setResults(response.groups);
    } catch (error) {
      setResults([]);
      setSearchError(error instanceof Error ? error.message : 'Book search failed. Please try again.');
    } finally { setIsSearching(false); }
  };

  const chooseSearchEdition = (work: BookSearchWorkGroup, edition: BookSearchEdition) => setPendingSearchEdition({ work, edition });
  const addSearchEditionToList = (readingStatus: ReadingStatus) => {
    if (!pendingSearchEdition) return;
    onAddBook(createBookFromSearchEdition({ work: pendingSearchEdition.work, edition: pendingSearchEdition.edition, status: readingStatus }));
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
    const isFinished = status === 'finished';
    const addedOn = today();
    const newBook: UserBookRecord = {
      id: bookId,
      work: {
        id: workId, title: title.trim(), author: author.trim(),
        summary: summary.trim() || 'No summary added yet.', publisherSummary: summary.trim() || undefined,
        genres: genres.split(',').map((genre) => genre.trim()).filter(Boolean), publicationYear: new Date().getFullYear(),
      },
      activeEditionId: editionId,
      editions: [{ id: editionId, format, pageCount: format === 'audiobook' ? undefined : validPageCount, coverGradient: 'from-[#5c3d62] via-[#35243f] to-[#171117]' }],
      status, ownership,
      progressPages: isFinished && hasKnownPrintTotal ? validPageCount! : 0,
      progressMinutes: 0, progressPercentage: isFinished && hasKnownPrintTotal ? 100 : 0,
      favoriteQuotes: [], privateTags: [], priority, moods: [], collections: [], sourceOfImport: 'Manual entry', dateAdded: addedOn,
      dateStarted: status === 'currently-reading' || isFinished ? addedOn : undefined,
      dateFinished: isFinished ? addedOn : undefined,
    };
    onAddBook(newBook); onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="relative max-h-[100dvh] w-full max-w-4xl overflow-y-auto overscroll-contain rounded-t-3xl border border-[#c5a059]/40 bg-[#17101b] px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-7" role="dialog" aria-modal="true" aria-labelledby="add-book-title">
        <button type="button" onClick={onClose} className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-black/30 text-[#ad9fac] transition hover:bg-black/50 hover:text-white" aria-label="Close add book dialog"><X className="h-5 w-5" /></button>
        <header className="pr-12"><p className="inkbound-kicker">Build your library</p><h2 id="add-book-title" className="mt-2 font-serif text-3xl text-[#f4efe6]">Add a Book</h2><p className="mt-2 text-sm text-[#ad9fac]">Search real book metadata and editions, or create a custom entry manually. Your Inkbound library is unlimited.</p></header>

        <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-[#3d2448] bg-[#0d0910] p-1">
          <button type="button" onClick={() => setActiveTab('search')} className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition ${activeTab === 'search' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac] hover:text-[#f4efe6]'}`}>Search Books</button>
          <button type="button" onClick={() => setActiveTab('manual')} className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition ${activeTab === 'manual' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817]' : 'text-[#ad9fac] hover:text-[#f4efe6]'}`}>Add Manually</button>
        </div>

        {activeTab === 'search' ? (
          <div className="mt-6 space-y-5">
            <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
              <label className="relative min-w-0 flex-1"><Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#807482]" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title, author, or ISBN" autoFocus className="h-12 w-full rounded-xl border border-[#c5a059]/20 bg-[#0d0910] pl-12 pr-4 text-sm text-[#f4efe6] outline-none placeholder:text-[#6f6570] focus:border-[#c5a059]/60" /></label>
              <button type="submit" disabled={!query.trim() || isSearching} className="quiet-shelf-primary-action min-h-12 px-6 disabled:cursor-not-allowed disabled:opacity-50">{isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{isSearching ? 'Searching…' : 'Search'}</button>
            </form>
            {searchError && <div className="rounded-xl border border-[#c97b7b]/40 bg-[#c97b7b]/10 p-4 text-sm text-[#efb6b6]">{searchError}</div>}
            {!hasSearched && <div className="rounded-2xl border border-dashed border-[#c5a059]/25 bg-[#0d0910]/45 px-6 py-12 text-center"><BookOpen className="mx-auto h-10 w-10 text-[#c5a059]/65" /><h3 className="mt-4 font-serif text-xl text-[#f4efe6]">Find the exact edition</h3><p className="mx-auto mt-2 max-w-lg text-sm text-[#ad9fac]">Search results include separate covers, ISBNs, publishers, page counts, and publication dates when available.</p></div>}
            {hasSearched && !isSearching && !searchError && results.length === 0 && <div className="rounded-2xl border border-dashed border-[#c5a059]/25 px-6 py-10 text-center"><p className="font-serif text-xl text-[#f4efe6]">No matching books found</p><p className="mt-2 text-sm text-[#ad9fac]">Try another title, author, or ISBN, or add the book manually.</p><button type="button" onClick={() => setActiveTab('manual')} className="quiet-shelf-secondary-action mt-5">Add Book Manually</button></div>}
            {results.length > 0 && <div className="space-y-4">{results.map((work) => <article key={work.key} className="rounded-2xl border border-[#c5a059]/18 bg-[#1d1422] p-4 sm:p-5"><div><h3 className="font-serif text-xl text-[#f4efe6]">{work.title}</h3>{work.subtitle && <p className="mt-1 text-sm text-[#c7bbc6]">{work.subtitle}</p>}<p className="mt-1 text-xs text-[#ad9fac]">{work.authors.join(', ')}</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{work.editions.map((edition) => <button key={edition.externalEditionId} type="button" onClick={() => chooseSearchEdition(work, edition)} className="flex min-h-36 gap-3 rounded-xl border border-white/7 bg-[#120c15] p-3 text-left transition hover:-translate-y-0.5 hover:border-[#c5a059]/45">{edition.coverUrl ? <img src={edition.coverUrl} alt="" className="h-28 w-20 shrink-0 rounded object-cover shadow-lg" /> : <span className="grid h-28 w-20 shrink-0 place-items-center rounded bg-gradient-to-br from-[#5c3d62] to-[#171117] text-[#e2bd66]"><BookOpen className="h-6 w-6" /></span>}<span className="min-w-0 text-xs text-[#ad9fac]"><strong className="block capitalize text-[#f4efe6]">{edition.format}</strong><span className="mt-1 block">{edition.publicationYear}</span>{edition.publisher && <span className="mt-1 block line-clamp-2">{edition.publisher}</span>}{edition.pageCount && <span className="mt-1 block">{edition.pageCount} pages</span>}{(edition.isbn13 || edition.isbn10) && <span className="mt-1 block break-all">ISBN {edition.isbn13 ?? edition.isbn10}</span>}<span className="mt-3 block font-bold text-[#e2bd66]">Choose this edition</span></span></button>)}</div></article>)}</div>}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Book title *"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Book title" /></Field>
              <Field label="Author *"><input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Author name" /></Field>
              <Field label="Genres"><input value={genres} onChange={(event) => setGenres(event.target.value)} placeholder="Fantasy, Romance" /></Field>
              {format !== 'audiobook' && <Field label="Page count"><input type="number" inputMode="numeric" min="1" value={pageCount} onChange={(event) => setPageCount(event.target.value)} placeholder="Optional" /></Field>}
              <Field label="Format"><select value={format} onChange={(event) => setFormat(event.target.value as Format)}><option value="hardcover">Hardcover</option><option value="paperback">Paperback</option><option value="ebook">Ebook</option><option value="audiobook">Audiobook</option></select></Field>
              <Field label="Reading status"><select value={status} onChange={(event) => setStatus(event.target.value as ReadingStatus)}><option value="tbr">To Be Read</option><option value="currently-reading">Currently Reading</option><option value="finished">Finished</option><option value="paused">Paused</option><option value="dnf">Did Not Finish</option></select></Field>
              <Field label="Ownership"><select value={ownership} onChange={(event) => setOwnership(event.target.value as OwnershipStatus)}><option value="owned">Owned</option><option value="borrowed-library">Library loan</option><option value="borrowed-person">Borrowed</option><option value="wishlist">Wishlist</option></select></Field>
              <Field label="Priority"><select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}><option value="top">Read Next</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></Field>
            </div>
            <Field label="Summary"><textarea rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Optional description or notes" /></Field>
            <button type="button" onClick={handleManualAdd} disabled={!title.trim() || !author.trim()} className="quiet-shelf-primary-action min-h-12 w-full disabled:cursor-not-allowed disabled:opacity-50">Add Book to Library</button>
          </div>
        )}

        {pendingSearchEdition && <div className="fixed inset-0 z-[220] grid place-items-center bg-black/70 p-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingSearchEdition(null); }}><section role="dialog" aria-modal="true" aria-labelledby="choose-list-title" className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-[#c5a059]/35 bg-[#17101b] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div className="flex min-w-0 gap-4">{pendingSearchEdition.edition.coverUrl ? <img src={pendingSearchEdition.edition.coverUrl} alt="" className="h-28 w-20 shrink-0 rounded object-cover shadow-lg" /> : <span className="grid h-28 w-20 shrink-0 place-items-center rounded bg-gradient-to-br from-[#5c3d62] to-[#171117] text-[#e2bd66]"><BookOpen className="h-6 w-6" /></span>}<div className="min-w-0"><p className="inkbound-kicker">Add to your library</p><h3 id="choose-list-title" className="mt-2 font-serif text-2xl text-[#f4efe6]">Which list?</h3><p className="mt-2 line-clamp-2 text-sm font-semibold text-[#f4efe6]">{pendingSearchEdition.work.title}</p><p className="mt-1 text-xs text-[#ad9fac]">{pendingSearchEdition.work.authors.join(', ')}</p></div></div><button type="button" onClick={() => setPendingSearchEdition(null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/30 text-[#ad9fac] transition hover:bg-black/50 hover:text-white" aria-label="Go back to editions"><X className="h-5 w-5" /></button></div><p className="mt-5 text-sm text-[#ad9fac]">Choose where this book belongs now. You can change its status later from Book Details.</p><div className="mt-4 grid gap-2">{LIST_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => addSearchEditionToList(option.value)} className="min-h-12 rounded-xl border border-[#c5a059]/18 bg-[#120c15] px-4 py-3 text-left transition hover:border-[#c5a059]/55 hover:bg-[#211526]"><span className="block text-sm font-bold text-[#f4efe6]">{option.label}</span><span className="mt-1 block text-xs text-[#ad9fac]">{option.description}</span></button>)}</div><button type="button" onClick={() => setPendingSearchEdition(null)} className="quiet-shelf-secondary-action mt-4 w-full">Back to editions</button></section></div>}
      </section>
    </div>
  );
};

type FieldChildProps = { className?: string; };
const Field: React.FC<{ label: string; children: React.ReactElement<FieldChildProps> }> = ({ label, children }) => (
  <label className="block text-xs font-bold text-[#d7ccd6]">{label}{React.cloneElement(children, { className: 'mt-2 min-h-11 w-full rounded-xl border border-[#c5a059]/18 bg-[#0d0910] px-3 py-2.5 text-sm text-[#f4efe6] outline-none placeholder:text-[#6f6570] focus:border-[#c5a059]/55' })}</label>
);
