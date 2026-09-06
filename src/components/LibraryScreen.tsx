import React, { useMemo, useState } from 'react';
import { BookOpen, CheckSquare, FolderHeart, FolderPlus, LayoutGrid, List, Lock, Plus, Search, Sparkles, Square, Star, Trash2, X } from 'lucide-react';
import { useUserPlan } from '../context/UserPlanContext';
import { FORMAT_OPTIONS, MATERIAL_TYPE_OPTIONS, OWNERSHIP_OPTIONS, materialTypeLabel } from '../domain/libraryTaxonomy';
import { usePersistentState } from '../hooks/usePersistentState';
import type { UserBookRecord } from '../types';
import { BookCover } from './BookCover';
import { LibraryBookGrid } from './library/LibraryBookGrid';
import { SeriesLibraryPanel } from './library/SeriesLibraryPanel';

interface LibraryScreenProps {
  books: UserBookRecord[];
  selectedBookIds: string[];
  onToggleSelectBook: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onClearSelection: () => void;
  onSelectBook: (book: UserBookRecord) => void;
  onOpenBatchEdit: () => void;
  onOpenAddBook: () => void;
}

type ViewMode = 'grid' | 'list';
type SortMode = 'recent' | 'title' | 'author' | 'rating' | 'progress';
type LibrarySection = 'books' | 'series' | 'collections';
type CustomListMemberships = Record<string, string[]>;

const CUSTOM_LISTS_STORAGE_KEY = 'inkbound_library_custom_lists';
const CUSTOM_LIST_MEMBERS_STORAGE_KEY = 'inkbound_library_custom_list_members';
const LIBRARY_BANNER_ASSET = '/assets/library/cozy-library-background.png';
const customListTabId = (name: string) => `list:${name}`;
const statusTabs = [
  { id: 'all', label: 'All' },
  { id: 'currently-reading', label: 'Reading' },
  { id: 'tbr', label: 'TBR' },
  { id: 'finished', label: 'Read' },
  { id: 'paused', label: 'Paused' },
  { id: 'dnf', label: 'DNF' },
  { id: 'owned', label: 'Owned' },
  { id: 'borrowed', label: 'Borrowed' },
  { id: 'wishlist', label: 'Wishlist' },
];

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  books,
  selectedBookIds,
  onToggleSelectBook,
  onSelectAll,
  onClearSelection,
  onSelectBook,
  onOpenBatchEdit,
  onOpenAddBook,
}) => {
  const { canUseBatchEdit, openUpgradeModal } = useUserPlan();
  const [section, setSection] = useState<LibrarySection>('books');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [activeTab, setActiveTab] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [materialFilter, setMaterialFilter] = useState('all');
  const [formatFilter, setFormatFilter] = useState('all');
  const [genreFilter, setGenreFilter] = useState('all');
  const [ownershipFilter, setOwnershipFilter] = useState('all');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [sortBy, setSortBy] = useState<SortMode>('recent');
  const [customLists, setCustomLists] = usePersistentState<string[]>(CUSTOM_LISTS_STORAGE_KEY, []);
  const [customListMemberships, setCustomListMemberships] = usePersistentState<CustomListMemberships>(CUSTOM_LIST_MEMBERS_STORAGE_KEY, {});
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [listError, setListError] = useState('');

  const allGenres = useMemo(() => Array.from(new Set(books.flatMap((book) => book.work.genres))).sort(), [books]);
  const availableCustomLists = useMemo(() => {
    const names = new Map<string, string>();
    customLists.forEach((name) => names.set(name.trim().toLowerCase(), name.trim()));
    books.forEach((book) => book.collections.forEach((name) => {
      const trimmed = name.trim();
      if (trimmed) names.set(trimmed.toLowerCase(), trimmed);
    }));
    return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
  }, [books, customLists]);
  const activeCustomList = activeTab.startsWith('list:') ? activeTab.slice(5) : null;

  const filteredBooks = useMemo(() => books.filter((book) => {
    if (activeTab === 'currently-reading' && book.status !== 'currently-reading') return false;
    if (activeTab === 'tbr' && book.status !== 'tbr') return false;
    if (activeTab === 'finished' && book.status !== 'finished') return false;
    if (activeTab === 'paused' && book.status !== 'paused') return false;
    if (activeTab === 'dnf' && book.status !== 'dnf') return false;
    if (activeTab === 'owned' && book.ownership !== 'owned') return false;
    if (activeTab === 'borrowed' && !['borrowed-library', 'borrowed-person'].includes(book.ownership)) return false;
    if (activeTab === 'wishlist' && book.ownership !== 'wishlist' && book.status !== 'wishlist') return false;

    if (activeCustomList) {
      const ids = customListMemberships[activeCustomList] ?? [];
      if (!ids.includes(book.id) && !book.collections.some((collection) => collection.toLowerCase() === activeCustomList.toLowerCase())) return false;
    }

    if (searchFilter.trim()) {
      const query = searchFilter.toLowerCase();
      if (!(book.work.title.toLowerCase().includes(query)
        || book.work.author.toLowerCase().includes(query)
        || book.work.seriesName?.toLowerCase().includes(query)
        || book.privateTags.some((tag) => tag.toLowerCase().includes(query)))) return false;
    }

    if (materialFilter !== 'all' && (book.work.materialType ?? 'book') !== materialFilter) return false;
    if (formatFilter !== 'all' && !book.editions.some((edition) => edition.format === formatFilter)) return false;
    if (genreFilter !== 'all' && !book.work.genres.includes(genreFilter)) return false;
    if (ownershipFilter !== 'all' && book.ownership !== ownershipFilter) return false;
    if (ratingFilter !== 'all' && (book.rating || 0) < Number(ratingFilter)) return false;
    return true;
  }).sort((a, b) => sortBy === 'title'
    ? a.work.title.localeCompare(b.work.title)
    : sortBy === 'author'
      ? a.work.author.localeCompare(b.work.author)
      : sortBy === 'rating'
        ? (b.rating || 0) - (a.rating || 0)
        : sortBy === 'progress'
          ? b.progressPercentage - a.progressPercentage
          : new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime()), [books, activeTab, activeCustomList, customListMemberships, searchFilter, materialFilter, formatFilter, genreFilter, ownershipFilter, ratingFilter, sortBy]);

  const allFilteredSelected = filteredBooks.length > 0 && filteredBooks.every((book) => selectedBookIds.includes(book.id));
  const handleSelectAll = () => {
    if (!canUseBatchEdit) {
      openUpgradeModal('Batch selection and multi-item editing require Inkbound Premium.');
      return;
    }
    allFilteredSelected ? onClearSelection() : onSelectAll(filteredBooks.map((book) => book.id));
  };

  const openCreateList = () => {
    setNewListName('');
    setListError('');
    setIsCreateListOpen(true);
  };

  const createCustomList = () => {
    const name = newListName.trim();
    if (!name) {
      setListError('Enter a name for this list.');
      return;
    }
    if (availableCustomLists.some((item) => item.toLowerCase() === name.toLowerCase())) {
      setListError('A list with this name already exists.');
      return;
    }
    setCustomLists((current) => [...current, name]);
    if (selectedBookIds.length) {
      setCustomListMemberships((current) => ({ ...current, [name]: Array.from(new Set([...(current[name] ?? []), ...selectedBookIds])) }));
      onClearSelection();
    }
    setActiveTab(customListTabId(name));
    setSection('collections');
    setIsCreateListOpen(false);
  };

  const addSelectedToActiveList = () => {
    if (!activeCustomList || !selectedBookIds.length) return;
    setCustomListMemberships((current) => ({ ...current, [activeCustomList]: Array.from(new Set([...(current[activeCustomList] ?? []), ...selectedBookIds])) }));
    onClearSelection();
  };

  const removeSelectedFromActiveList = () => {
    if (!activeCustomList) return;
    setCustomListMemberships((current) => ({ ...current, [activeCustomList]: (current[activeCustomList] ?? []).filter((id) => !selectedBookIds.includes(id)) }));
    onClearSelection();
  };

  const deleteActiveList = () => {
    if (!activeCustomList) return;
    setCustomLists((current) => current.filter((name) => name !== activeCustomList));
    setCustomListMemberships((current) => {
      const next = { ...current };
      delete next[activeCustomList];
      return next;
    });
    setActiveTab('all');
    onClearSelection();
  };

  const switchSection = (next: LibrarySection) => {
    setSection(next);
    onClearSelection();
    if (next === 'books' && activeCustomList) setActiveTab('all');
    if (next === 'collections' && !activeCustomList && availableCustomLists[0]) setActiveTab(customListTabId(availableCustomLists[0]));
  };

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden pb-24">
      <section className="relative overflow-hidden rounded-3xl border border-[var(--ink-border-subtle)] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
        <div aria-hidden="true" className="pointer-events-none absolute -inset-3 scale-[1.035] bg-cover bg-center blur-[3px]" style={{ backgroundImage: `url("${LIBRARY_BANNER_ASSET}")` }} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(9,8,18,.88),rgba(9,8,18,.36))]" />
        <div className="relative z-10 flex min-h-[260px] flex-col justify-between gap-6 p-6 sm:p-8 xl:flex-row xl:items-end">
          <div className="max-w-2xl rounded-3xl border border-white/10 bg-black/25 p-5 backdrop-blur-[3px]"><span className="text-xs font-bold uppercase tracking-[0.22em] text-[#e0c77c]">Your personal collection</span><h1 className="mt-2 font-serif text-4xl text-white">My Library</h1><p className="mt-2 text-sm text-white/75">Browse everything you read, keep series in order, and organize personal collections.</p></div>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-3"><div className="rounded-full border border-white/15 bg-black/25 px-4 py-2 text-xs text-white/75"><b className="text-white">{books.length}</b> items</div><div className="flex items-center gap-1.5 rounded-full border border-[#c5a059]/35 bg-black/25 px-4 py-2 text-xs font-bold text-[#e2bd66]"><Sparkles className="h-3.5 w-3.5" />Unlimited Library</div><button type="button" onClick={onOpenAddBook} className="quiet-shelf-primary-action"><Plus className="h-4 w-4" />Add Reading Material</button></div>
        </div>
      </section>

      <nav className="inkbound-panel flex gap-1 overflow-x-auto p-1.5" aria-label="Library sections">
        {(['books', 'series', 'collections'] as LibrarySection[]).map((item) => <button key={item} type="button" onClick={() => switchSection(item)} className={`min-h-11 flex-1 whitespace-nowrap rounded-xl px-5 text-sm font-bold capitalize transition ${section === item ? 'bg-[#c5a059] text-[#171015]' : 'text-[#b9acba] hover:bg-white/5 hover:text-[#f4efe6]'}`}>{item}</button>)}
      </nav>

      {section === 'series' ? <SeriesLibraryPanel books={books} onSelectBook={onSelectBook} /> : <>
        <section className="inkbound-panel p-4 sm:p-5">
          {section === 'books' ? (
            <div className="flex gap-2 overflow-x-auto pb-2">{statusTabs.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold ${activeTab === tab.id ? 'border-[#d8ae54] bg-[#c5a059] text-[#171015]' : 'border-transparent bg-[#1d1422] text-[#cfc2cf]'}`}>{tab.label}</button>)}</div>
          ) : <>
            <div className="flex gap-2 overflow-x-auto pb-2">{availableCustomLists.map((name) => <button key={name} type="button" onClick={() => setActiveTab(customListTabId(name))} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold ${activeCustomList === name ? 'border-[#d8ae54] bg-[#c5a059] text-[#171015]' : 'border-[#c5a059]/15 bg-[#24172a] text-[#d2c5d2]'}`}><FolderHeart className="h-3.5 w-3.5" />{name}</button>)}<button type="button" onClick={openCreateList} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-[#c5a059]/40 px-4 py-2 text-xs font-semibold text-[#e2bd66]"><FolderPlus className="h-3.5 w-3.5" />New Collection</button></div>
            {availableCustomLists.length === 0 && <div className="py-5 text-center text-sm text-[#ad9fac]">No collections yet. Create one to group reading material however you like.</div>}
            {activeCustomList && <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-[#c5a059]/18 bg-[#120c15] p-3"><strong className="mr-auto text-sm text-[#f4efe6]">{activeCustomList}</strong>{selectedBookIds.length > 0 && <><button type="button" onClick={addSelectedToActiveList} className="quiet-shelf-secondary-action">Add selected</button><button type="button" onClick={removeSelectedFromActiveList} className="quiet-shelf-secondary-action">Remove selected</button></>}<button type="button" onClick={deleteActiveList} className="quiet-shelf-secondary-action text-rose-300"><Trash2 className="h-4 w-4" />Delete</button></div>}
          </>}

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
            <label className="relative xl:col-span-2"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#807482]" /><input type="search" placeholder="Search title, author, series, or tag" value={searchFilter} onChange={(event) => setSearchFilter(event.target.value)} className="h-11 w-full rounded-xl border border-[#c5a059]/18 bg-[#0d0910] pl-10 pr-4 text-sm text-[#f4efe6] outline-none" /></label>
            <select value={materialFilter} onChange={(event) => setMaterialFilter(event.target.value)} className="inkbound-select"><option value="all">All reading types</option>{MATERIAL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.pluralLabel ?? option.label}</option>)}</select>
            <select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)} className="inkbound-select"><option value="all">All formats</option>{FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <select value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)} className="inkbound-select"><option value="all">All genres</option>{allGenres.map((genre) => <option key={genre}>{genre}</option>)}</select>
            <select value={ownershipFilter} onChange={(event) => setOwnershipFilter(event.target.value)} className="inkbound-select"><option value="all">Any ownership</option>{OWNERSHIP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <select value={ratingFilter} onChange={(event) => setRatingFilter(event.target.value)} className="inkbound-select"><option value="all">Any rating</option><option value="5">5 stars</option><option value="4">4+ stars</option><option value="3">3+ stars</option></select>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortMode)} className="inkbound-select"><option value="recent">Recently added</option><option value="title">Title</option><option value="author">Author</option><option value="rating">Rating</option><option value="progress">Progress</option></select>
          </div>

          <div className="mt-4 flex justify-between border-t border-white/5 pt-4">
            <button type="button" onClick={handleSelectAll} className="quiet-shelf-secondary-action">{canUseBatchEdit ? (allFilteredSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />) : <Lock className="h-4 w-4" />}{canUseBatchEdit ? (allFilteredSelected ? 'Deselect all' : 'Select all') : 'Batch edit'}</button>
            <div className="flex rounded-full border border-[#c5a059]/20 bg-[#0d0910] p-1"><button type="button" onClick={() => setViewMode('grid')} className={`rounded-full p-2 ${viewMode === 'grid' ? 'bg-[#c5a059] text-[#171015]' : 'text-[#ad9fac]'}`}><LayoutGrid className="h-4 w-4" /></button><button type="button" onClick={() => setViewMode('list')} className={`rounded-full p-2 ${viewMode === 'list' ? 'bg-[#c5a059] text-[#171015]' : 'text-[#ad9fac]'}`}><List className="h-4 w-4" /></button></div>
          </div>
        </section>

        <div className="text-xs text-[#807482]">Showing {filteredBooks.length} of {books.length} items</div>

        {filteredBooks.length === 0 ? (
          <div className="inkbound-panel p-12 text-center"><BookOpen className="mx-auto h-10 w-10 text-[#c5a059]/60" /><h3 className="mt-4 font-serif text-xl text-[#f4efe6]">Nothing matches these filters</h3><p className="mt-2 text-sm text-[#ad9fac]">Try another reading type, status, format, or search.</p></div>
        ) : viewMode === 'grid' ? (
          <LibraryBookGrid books={filteredBooks} selectedBookIds={selectedBookIds} onToggleSelectBook={onToggleSelectBook} onSelectBook={onSelectBook} />
        ) : (
          <div className="space-y-3">{filteredBooks.map((book) => <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="inkbound-panel flex w-full items-center gap-4 p-4 text-left"><BookCover work={book.work} edition={book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0]} size="sm" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-serif text-lg text-[#f4efe6]">{book.work.title}</h3><span className="rounded-full border border-[#c5a059]/20 px-2 py-0.5 text-[10px] font-bold uppercase text-[#cdbbca]">{materialTypeLabel(book.work.materialType ?? 'book', true)}</span></div><p className="text-xs text-[#ad9fac]">{book.work.author}</p></div><div className="hidden text-right sm:block"><p className="text-sm font-bold text-[#e2bd66]">{book.progressPercentage}%</p>{book.rating && <p className="flex items-center justify-end gap-1 text-xs text-[#ad9fac]"><Star className="h-3 w-3 fill-[#e2bd66] text-[#e2bd66]" />{book.rating}</p>}</div></button>)}</div>
        )}
      </>}

      {selectedBookIds.length > 0 && <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#c5a059]/35 bg-[#17101b] px-5 py-3 shadow-2xl lg:bottom-6"><span className="text-xs font-bold text-[#f4efe6]">{selectedBookIds.length} selected</span><button type="button" onClick={onOpenBatchEdit} className="quiet-shelf-primary-action">Edit</button><button type="button" onClick={onClearSelection} className="grid h-10 w-10 place-items-center rounded-full text-[#ad9fac]"><X className="h-4 w-4" /></button></div>}

      {isCreateListOpen && <div className="fixed inset-0 z-[180] grid place-items-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsCreateListOpen(false); }}><div className="w-full max-w-md rounded-2xl border border-[#c5a059]/30 bg-[#17101b] p-6"><h3 className="font-serif text-2xl text-[#f4efe6]">New Collection</h3><input autoFocus value={newListName} onChange={(event) => { setNewListName(event.target.value); setListError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') createCustomList(); }} placeholder="e.g. Comfort Reads" className="inkbound-select mt-5 w-full" />{listError && <p className="mt-2 text-xs text-rose-300">{listError}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setIsCreateListOpen(false)} className="quiet-shelf-secondary-action">Cancel</button><button type="button" onClick={createCustomList} className="quiet-shelf-primary-action">Create</button></div></div></div>}
    </div>
  );
};
