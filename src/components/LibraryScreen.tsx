import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckSquare, LayoutGrid, List, Lock, Plus, Search, Sparkles, Square, Star, X } from 'lucide-react';
import { useUserPlan } from '../context/UserPlanContext';
import { FORMAT_OPTIONS, MATERIAL_TYPE_OPTIONS, OWNERSHIP_OPTIONS, READING_STATUS_OPTIONS, materialTypeLabel } from '../domain/libraryTaxonomy';
import { replaceCanonicalBook } from '../features/library/libraryMutations';
import { bookMatchesLibrarySearch } from '../features/library/librarySearch';
import { DEFAULT_LIBRARY_SECTION, LIBRARY_SECTION_STORAGE_KEY, type LibrarySection } from '../features/library/libraryNavigation';
import {
  CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT,
  CUSTOM_OWNERSHIP_CATEGORIES_KEY,
  readCustomOwnershipCategories,
  type CustomOwnershipCategory,
} from '../features/ownership/customOwnershipCategories';
import { getCanonicalProgressPercentage } from '../features/reading/bookReadingState';
import {
  CUSTOM_READING_STATUSES_CHANGED_EVENT,
  CUSTOM_READING_STATUSES_KEY,
  readCustomReadingStatuses,
  type CustomReadingStatus,
} from '../features/reading/customReadingStatuses';
import { usePersistentState } from '../hooks/usePersistentState';
import { INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT } from '../platform/runtimeStorage';
import type { ReadingStatus, UserBookRecord } from '../types';
import { BookCover } from './BookCover';
import { CollectionsScreen } from './CollectionsScreen';
import { LibraryBookGrid } from './library/LibraryBookGrid';
import { LoansLibraryPanel } from './library/LoansLibraryPanel';
import { SeriesLibraryPanel } from './library/SeriesLibraryPanel';
import { PaginationControls } from './PaginationControls';
import { ChiliPepperIcon } from './reading/IconStepRating';

interface LibraryScreenProps {
  books: UserBookRecord[];
  selectedBookIds: string[];
  onToggleSelectBook: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onClearSelection: () => void;
  onSelectBook: (book: UserBookRecord) => void;
  onUpdateBook?: (book: UserBookRecord) => void;
  onOpenBatchEdit: () => void;
  onOpenAddBook: () => void;
}

type ViewMode = 'grid' | 'list';
type SortMode = 'recent' | 'title' | 'author' | 'rating' | 'progress';

const LIBRARY_BANNER_ASSET = '/assets/library/cozy-library-background.png';
const LIBRARY_PAGE_SIZE = 24;
const normalizeTag = (value: string) => value.trim().toLocaleLowerCase();

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  books,
  selectedBookIds,
  onToggleSelectBook,
  onSelectAll,
  onClearSelection,
  onSelectBook,
  onUpdateBook,
  onOpenBatchEdit,
  onOpenAddBook,
}) => {
  const { canUseBatchEdit, openUpgradeModal } = useUserPlan();
  const [section, setSection] = usePersistentState<LibrarySection>(LIBRARY_SECTION_STORAGE_KEY, DEFAULT_LIBRARY_SECTION);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [activeCategory, setActiveCategory] = useState('all');
  const [customOwnershipCategories, setCustomOwnershipCategories] = useState<CustomOwnershipCategory[]>(() => readCustomOwnershipCategories());
  const [customReadingStatuses, setCustomReadingStatuses] = useState<CustomReadingStatus[]>(() => readCustomReadingStatuses());
  const [searchFilter, setSearchFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [materialFilter, setMaterialFilter] = useState('all');
  const [formatFilter, setFormatFilter] = useState('all');
  const [genreFilter, setGenreFilter] = useState('all');
  const [ownershipFilter, setOwnershipFilter] = useState('all');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [sortBy, setSortBy] = useState<SortMode>('recent');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const refresh = () => setCustomOwnershipCategories(readCustomOwnershipCategories());
    const handleRuntimeRefresh = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key === CUSTOM_OWNERSHIP_CATEGORIES_KEY) refresh();
    };
    window.addEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
    window.addEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, handleRuntimeRefresh);
    return () => {
      window.removeEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
      window.removeEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, handleRuntimeRefresh);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setCustomReadingStatuses(readCustomReadingStatuses());
    const handleRuntimeRefresh = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key === CUSTOM_READING_STATUSES_KEY) refresh();
    };
    window.addEventListener(CUSTOM_READING_STATUSES_CHANGED_EVENT, refresh);
    window.addEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, handleRuntimeRefresh);
    return () => {
      window.removeEventListener(CUSTOM_READING_STATUSES_CHANGED_EVENT, refresh);
      window.removeEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, handleRuntimeRefresh);
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [activeCategory, searchFilter, tagFilter, materialFilter, formatFilter, genreFilter, ownershipFilter, ratingFilter, sortBy]);

  const updateLibraryBook = onUpdateBook ?? ((book: UserBookRecord) => replaceCanonicalBook(books, book));
  const allGenres = useMemo(() => Array.from(new Set(books.flatMap((book) => book.work.genres))).sort(), [books]);
  const allTags = useMemo(() => {
    const byNormalized = new Map<string, string>();
    books.forEach((book) => (book.privateTags ?? []).forEach((rawTag) => {
      const name = rawTag.trim();
      const normalized = normalizeTag(name);
      if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, name);
    }));
    return [...byNormalized.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [books]);

  useEffect(() => {
    if (tagFilter !== 'all' && !allTags.some(([normalized]) => normalized === tagFilter)) setTagFilter('all');
  }, [allTags, tagFilter]);

  const filteredBooks = useMemo(() => books.filter((book) => {
    if (activeCategory.startsWith('status:')) {
      const statusId = activeCategory.slice('status:'.length);
      if (book.status !== 'custom' || book.customReadingStatusId !== statusId) return false;
    } else if (activeCategory !== 'all' && book.status !== activeCategory as ReadingStatus) return false;

    if (searchFilter.trim() && !bookMatchesLibrarySearch(book, searchFilter)) return false;

    if (tagFilter !== 'all' && !(book.privateTags ?? []).some((tag) => normalizeTag(tag) === tagFilter)) return false;
    if (materialFilter !== 'all' && (book.work.materialType ?? 'book') !== materialFilter) return false;
    if (formatFilter !== 'all' && !book.editions.some((edition) => edition.format === formatFilter)) return false;
    if (genreFilter !== 'all' && !book.work.genres.includes(genreFilter)) return false;
    if (ownershipFilter.startsWith('custom:')) {
      const categoryId = ownershipFilter.slice('custom:'.length);
      if (book.ownership !== 'custom' || book.customOwnershipCategoryId !== categoryId) return false;
    } else if (ownershipFilter !== 'all' && book.ownership !== ownershipFilter) return false;
    if (ratingFilter !== 'all' && (book.rating || 0) < Number(ratingFilter)) return false;
    return true;
  }).sort((a, b) => sortBy === 'title'
    ? a.work.title.localeCompare(b.work.title)
    : sortBy === 'author'
      ? a.work.author.localeCompare(b.work.author)
      : sortBy === 'rating'
        ? (b.rating || 0) - (a.rating || 0)
        : sortBy === 'progress'
          ? getCanonicalProgressPercentage(b) - getCanonicalProgressPercentage(a)
          : ((Number.isFinite(Date.parse(b.dateAdded ?? '')) ? Date.parse(b.dateAdded) : 0)
            - (Number.isFinite(Date.parse(a.dateAdded ?? '')) ? Date.parse(a.dateAdded) : 0))
            || a.work.title.localeCompare(b.work.title, undefined, { sensitivity: 'base', numeric: true })
            || a.id.localeCompare(b.id)), [books, activeCategory, searchFilter, tagFilter, materialFilter, formatFilter, genreFilter, ownershipFilter, ratingFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredBooks.length / LIBRARY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedBooks = useMemo(
    () => filteredBooks.slice((safePage - 1) * LIBRARY_PAGE_SIZE, safePage * LIBRARY_PAGE_SIZE),
    [filteredBooks, safePage],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const allFilteredSelected = filteredBooks.length > 0 && filteredBooks.every((book) => selectedBookIds.includes(book.id));
  const handleSelectAll = () => {
    if (!canUseBatchEdit) {
      openUpgradeModal('Batch selection and multi-item editing require Inkbound Premium.');
      return;
    }
    allFilteredSelected ? onClearSelection() : onSelectAll(filteredBooks.map((book) => book.id));
  };

  const switchSection = (next: LibrarySection) => {
    setSection(next);
    onClearSelection();
  };

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden pb-24">
      <section className="inkbound-artwork-hero relative overflow-hidden rounded-3xl border border-[var(--ink-border-subtle)] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
        <div aria-hidden="true" className="pointer-events-none absolute -inset-3 scale-[1.035] bg-cover bg-center blur-[3px]" style={{ backgroundImage: `url(\"${LIBRARY_BANNER_ASSET}\")` }} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(9,8,18,.88),rgba(9,8,18,.36))]" />
        <div className="relative z-10 flex min-h-[260px] flex-col justify-between gap-6 p-6 sm:p-8 xl:flex-row xl:items-end">
          <div className="max-w-2xl rounded-3xl border border-white/10 bg-black/25 p-5 backdrop-blur-[3px]"><span className="text-xs font-bold uppercase tracking-[0.22em] text-[#e0c77c]">Your personal collection</span><h1 className="mt-2 font-serif text-4xl text-white">My Library</h1><p className="mt-2 text-sm text-white/75">Browse everything you read, keep series in order, and organize personal collections.</p></div>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-3"><div className="rounded-full border border-white/15 bg-black/25 px-4 py-2 text-xs text-white/75"><b className="text-white">{books.length}</b> items</div><div className="flex items-center gap-1.5 rounded-full border border-[#c5a059]/35 bg-black/25 px-4 py-2 text-xs font-bold text-[#e2bd66]"><Sparkles className="h-3.5 w-3.5" />Unlimited Library</div><button type="button" onClick={onOpenAddBook} className="quiet-shelf-primary-action"><Plus className="h-4 w-4" />Add Reading Material</button></div>
        </div>
      </section>

      <nav className="inkbound-panel grid grid-cols-4 gap-1 p-1.5" aria-label="Library sections">
        {(['books', 'series', 'collections', 'loans'] as LibrarySection[]).map((item) => <button key={item} type="button" onClick={() => switchSection(item)} className={`flex min-h-11 min-w-0 items-center justify-center rounded-xl px-1 text-[10px] font-bold capitalize leading-none transition min-[390px]:px-1.5 min-[390px]:text-[11px] sm:px-3 sm:text-sm ${section === item ? 'bg-[#c5a059] text-[#171015]' : 'text-[#b9acba] hover:bg-white/5 hover:text-[#f4efe6]'}`}>{item}</button>)}
      </nav>

      {section === 'series' ? (
        <SeriesLibraryPanel books={books} onSelectBook={onSelectBook} />
      ) : section === 'collections' ? (
        <CollectionsScreen books={books} onUpdateBook={updateLibraryBook} onSelectBook={onSelectBook} />
      ) : section === 'loans' ? (
        <LoansLibraryPanel books={books} onSelectBook={onSelectBook} />
      ) : <>
        <section className="inkbound-panel p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-9">
            <label className="relative xl:col-span-2"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#807482]" /><input type="search" placeholder="Search title, author, series, or tag" value={searchFilter} onChange={(event) => setSearchFilter(event.target.value)} className="h-11 w-full rounded-xl border border-[#c5a059]/18 bg-[#0d0910] pl-10 pr-4 text-sm text-[#f4efe6] outline-none" /></label>
            <select value={activeCategory} onChange={(event) => setActiveCategory(event.target.value)} className="inkbound-select" aria-label="Reading status filter">
              <option value="all">All reading statuses</option>
              {READING_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              {customReadingStatuses.length > 0 && <optgroup label="Custom statuses">{customReadingStatuses.map((status) => <option key={status.id} value={`status:${status.id}`}>{status.name}</option>)}</optgroup>}
            </select>
            <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} className="inkbound-select" aria-label="Tag filter"><option value="all">All tags</option>{allTags.map(([normalized, label]) => <option key={normalized} value={normalized}>{label}</option>)}</select>
            <select value={materialFilter} onChange={(event) => setMaterialFilter(event.target.value)} className="inkbound-select"><option value="all">All reading types</option>{MATERIAL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.pluralLabel ?? option.label}</option>)}</select>
            <select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)} className="inkbound-select"><option value="all">All formats</option>{FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <select value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)} className="inkbound-select"><option value="all">All genres</option>{allGenres.map((genre) => <option key={genre}>{genre}</option>)}</select>
            <select value={ownershipFilter} onChange={(event) => setOwnershipFilter(event.target.value)} className="inkbound-select"><option value="all">Any ownership</option><optgroup label="Ownership">{OWNERSHIP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>{customOwnershipCategories.length > 0 && <optgroup label="Custom ownership">{customOwnershipCategories.map((category) => <option key={category.id} value={`custom:${category.id}`}>{category.name}</option>)}</optgroup>}</select>
            <select value={ratingFilter} onChange={(event) => setRatingFilter(event.target.value)} className="inkbound-select"><option value="all">Any rating</option><option value="5">5 stars</option><option value="4">4+ stars</option><option value="3">3+ stars</option></select>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortMode)} className="inkbound-select"><option value="recent">Recently added</option><option value="title">Title</option><option value="author">Author</option><option value="rating">Rating</option><option value="progress">Progress</option></select>
          </div>

          <div className="mt-4 flex justify-between border-t border-white/5 pt-4">
            <button type="button" onClick={handleSelectAll} className="quiet-shelf-secondary-action">{canUseBatchEdit ? (allFilteredSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />) : <Lock className="h-4 w-4" />}{canUseBatchEdit ? (allFilteredSelected ? 'Deselect all' : 'Select all') : 'Batch edit'}</button>
            <div className="flex rounded-full border border-[#c5a059]/20 bg-[#0d0910] p-1"><button type="button" onClick={() => setViewMode('grid')} className={`rounded-full p-2 ${viewMode === 'grid' ? 'bg-[#c5a059] text-[#171015]' : 'text-[#ad9fac]'}`}><LayoutGrid className="h-4 w-4" /></button><button type="button" onClick={() => setViewMode('list')} className={`rounded-full p-2 ${viewMode === 'list' ? 'bg-[#c5a059] text-[#171015]' : 'text-[#ad9fac]'}`}><List className="h-4 w-4" /></button></div>
          </div>
        </section>

        <div className="text-xs text-[#807482]">{filteredBooks.length.toLocaleString()} matching items · {books.length.toLocaleString()} total</div>

        {filteredBooks.length === 0 ? (
          <div className="inkbound-panel p-12 text-center"><BookOpen className="mx-auto h-10 w-10 text-[#c5a059]/60" /><h3 className="mt-4 font-serif text-xl text-[#f4efe6]">Nothing matches these filters</h3><p className="mt-2 text-sm text-[#ad9fac]">Try another status, tag, reading type, format, ownership, or search.</p></div>
        ) : viewMode === 'grid' ? (
          <LibraryBookGrid books={paginatedBooks} selectedBookIds={selectedBookIds} onToggleSelectBook={onToggleSelectBook} onSelectBook={onSelectBook} />
        ) : (
          <div className="space-y-3">{paginatedBooks.map((book) => <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="inkbound-panel flex w-full items-center gap-4 p-4 text-left"><BookCover work={book.work} edition={book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0]} size="sm" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-serif text-lg text-[#f4efe6]">{book.work.title}</h3><span className="rounded-full border border-[#c5a059]/20 px-2 py-0.5 text-[10px] font-bold uppercase text-[#cdbbca]">{materialTypeLabel(book.work.materialType ?? 'book', true)}</span></div><p className="text-xs text-[#ad9fac]">{book.work.author}</p></div><div className="hidden text-right sm:block"><p className="text-sm font-bold text-[#e2bd66]">{getCanonicalProgressPercentage(book)}%</p>{book.rating && <p className="flex items-center justify-end gap-1 text-xs text-[#ad9fac]"><Star className="h-3 w-3 fill-[#e2bd66] text-[#e2bd66]" />{book.rating}</p>}{book.spiceLevel !== undefined && <p className="flex items-center justify-end gap-1 text-xs text-[#ad9fac]"><ChiliPepperIcon className="h-3 w-3 text-orange-300" />{book.spiceLevel}/5</p>}</div></button>)}</div>
        )}

        <PaginationControls page={safePage} totalItems={filteredBooks.length} pageSize={LIBRARY_PAGE_SIZE} onPageChange={setPage} itemLabel="items" />
      </>}

      {section === 'books' && selectedBookIds.length > 0 && <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#c5a059]/35 bg-[#17101b] px-5 py-3 shadow-2xl lg:bottom-6"><span className="text-xs font-bold text-[#f4efe6]">{selectedBookIds.length} selected</span><button type="button" onClick={onOpenBatchEdit} className="quiet-shelf-primary-action">Edit</button><button type="button" onClick={onClearSelection} className="grid h-10 w-10 place-items-center rounded-full text-[#ad9fac]"><X className="h-4 w-4" /></button></div>}
    </div>
  );
};