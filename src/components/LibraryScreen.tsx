import React, { useMemo, useState } from 'react';
import { UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { usePersistentState } from '../hooks/usePersistentState';
import { BookCover } from './BookCover';
import { LibraryBookGrid } from './library/LibraryBookGrid';
import {
  BookOpen,
  CheckSquare,
  FolderHeart,
  FolderPlus,
  LayoutGrid,
  List,
  Lock,
  Plus,
  Search,
  Sparkles,
  Square,
  Star,
  Trash2,
  X,
} from 'lucide-react';

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
type CustomListMemberships = Record<string, string[]>;

const CUSTOM_LISTS_STORAGE_KEY = 'inkbound_library_custom_lists';
const CUSTOM_LIST_MEMBERS_STORAGE_KEY = 'inkbound_library_custom_list_members';
const customListTabId = (name: string) => `list:${name}`;

const statusTabs = [
  { id: 'all', label: 'All Books' },
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
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [activeTab, setActiveTab] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');
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

  const allGenres = useMemo(() => {
    const genres = new Set<string>();
    books.forEach((book) => book.work.genres.forEach((genre) => genres.add(genre)));
    return Array.from(genres).sort();
  }, [books]);

  const availableCustomLists = useMemo(() => {
    const names = new Map<string, string>();
    customLists.forEach((name) => names.set(name.trim().toLowerCase(), name.trim()));
    books.forEach((book) => {
      book.collections.forEach((name) => {
        const trimmed = name.trim();
        if (trimmed) names.set(trimmed.toLowerCase(), trimmed);
      });
    });
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
      const locallyAssignedIds = customListMemberships[activeCustomList] ?? [];
      if (!locallyAssignedIds.includes(book.id) && !book.collections.some((collection) => collection.toLowerCase() === activeCustomList.toLowerCase())) return false;
    }
    if (searchFilter.trim()) {
      const query = searchFilter.toLowerCase();
      if (!(book.work.title.toLowerCase().includes(query) || book.work.author.toLowerCase().includes(query) || book.work.seriesName?.toLowerCase().includes(query) || book.privateTags.some((tag) => tag.toLowerCase().includes(query)))) return false;
    }
    if (formatFilter !== 'all' && !book.editions.some((edition) => edition.format === formatFilter)) return false;
    if (genreFilter !== 'all' && !book.work.genres.includes(genreFilter)) return false;
    if (ownershipFilter !== 'all' && book.ownership !== ownershipFilter) return false;
    if (ratingFilter !== 'all' && (book.rating || 0) < Number(ratingFilter)) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'title') return a.work.title.localeCompare(b.work.title);
    if (sortBy === 'author') return a.work.author.localeCompare(b.work.author);
    if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0);
    if (sortBy === 'progress') return b.progressPercentage - a.progressPercentage;
    return new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
  }), [books, activeTab, activeCustomList, customListMemberships, searchFilter, formatFilter, genreFilter, ownershipFilter, ratingFilter, sortBy]);

  const allFilteredSelected = filteredBooks.length > 0 && filteredBooks.every((book) => selectedBookIds.includes(book.id));

  const handleSelectAll = () => {
    if (!canUseBatchEdit) {
      openUpgradeModal('Batch selection and multi-book editing require Inkbound Premium.');
      return;
    }
    allFilteredSelected ? onClearSelection() : onSelectAll(filteredBooks.map((book) => book.id));
  };

  const openCreateList = () => { setNewListName(''); setListError(''); setIsCreateListOpen(true); };
  const createCustomList = () => {
    const trimmedName = newListName.trim();
    if (!trimmedName) { setListError('Enter a name for this list.'); return; }
    const existingName = availableCustomLists.find((name) => name.toLowerCase() === trimmedName.toLowerCase());
    if (existingName) { setListError('A list with this name already exists.'); return; }
    setCustomLists((current) => [...current, trimmedName]);
    if (selectedBookIds.length > 0) {
      setCustomListMemberships((current) => ({ ...current, [trimmedName]: Array.from(new Set([...(current[trimmedName] ?? []), ...selectedBookIds])) }));
      onClearSelection();
    }
    setActiveTab(customListTabId(trimmedName)); setIsCreateListOpen(false); setNewListName('');
  };
  const addSelectedToActiveList = () => {
    if (!activeCustomList || selectedBookIds.length === 0) return;
    setCustomListMemberships((current) => ({ ...current, [activeCustomList]: Array.from(new Set([...(current[activeCustomList] ?? []), ...selectedBookIds])) }));
    onClearSelection();
  };
  const removeSelectedFromActiveList = () => {
    if (!activeCustomList || selectedBookIds.length === 0) return;
    setCustomListMemberships((current) => ({ ...current, [activeCustomList]: (current[activeCustomList] ?? []).filter((bookId) => !selectedBookIds.includes(bookId)) }));
    onClearSelection();
  };
  const deleteActiveList = () => {
    if (!activeCustomList) return;
    setCustomLists((current) => current.filter((name) => name !== activeCustomList));
    setCustomListMemberships((current) => { const next = { ...current }; delete next[activeCustomList]; return next; });
    setActiveTab('all'); onClearSelection();
  };

  return (
    <div className="space-y-6 pb-24">
      <section className="inkbound-panel overflow-hidden p-6 sm:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl"><span className="inkbound-kicker">Your personal collection</span><h1 className="inkbound-page-title mt-2">My Library</h1><p className="inkbound-page-copy mt-2">Browse every book you own, borrow, love, pause, or plan to return to.</p></div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-[#c5a059]/25 bg-[#c5a059]/8 px-4 py-2 text-xs text-[#d9ced9]"><span className="font-bold text-[#f4efe6]">{filteredBooks.length}</span> shown<span className="mx-2 text-[#807482]">of</span><span className="font-bold text-[#f4efe6]">{books.length}</span> books</div>
            <div className="flex items-center gap-1.5 rounded-full border border-[#c5a059]/35 bg-[#c5a059]/10 px-4 py-2 text-xs font-bold text-[#e2bd66]"><Sparkles className="h-3.5 w-3.5" /> Unlimited Library</div>
            <button type="button" onClick={onOpenAddBook} className="quiet-shelf-primary-action"><Plus className="h-4 w-4" /><span>Add Book</span></button>
          </div>
        </div>
      </section>

      <section className="inkbound-panel p-4 sm:p-5">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {statusTabs.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold transition ${activeTab === tab.id ? 'border-[#d8ae54] bg-[#c5a059] text-[#171015]' : 'border-transparent bg-[#1d1422] text-[#cfc2cf] hover:border-[#c5a059]/25 hover:text-[#f4efe6]'}`}>{tab.label}</button>)}
          {availableCustomLists.map((listName) => <button key={listName} type="button" onClick={() => setActiveTab(customListTabId(listName))} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold transition ${activeTab === customListTabId(listName) ? 'border-[#d8ae54] bg-[#c5a059] text-[#171015]' : 'border-[#c5a059]/15 bg-[#24172a] text-[#d2c5d2] hover:border-[#c5a059]/35 hover:text-[#f4efe6]'}`}><FolderHeart className="h-3.5 w-3.5" />{listName}</button>)}
          <button type="button" onClick={openCreateList} className="inline-flex whitespace-nowrap items-center gap-1.5 rounded-full border border-dashed border-[#c5a059]/40 px-4 py-2 text-xs font-semibold text-[#e2bd66] transition hover:bg-[#c5a059]/10"><FolderPlus className="h-3.5 w-3.5" /> New List</button>
        </div>
        {activeCustomList && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#c5a059]/18 bg-[#120c15] p-3"><span className="mr-auto text-xs text-[#ad9fac]"><strong className="text-[#f4efe6]">{activeCustomList}</strong> is separate from reading status.</span>{selectedBookIds.length > 0 && <><button type="button" onClick={addSelectedToActiveList} className="quiet-shelf-secondary-action"><Plus className="h-4 w-4" /> Add selected</button><button type="button" onClick={removeSelectedFromActiveList} className="quiet-shelf-secondary-action"><X className="h-4 w-4" /> Remove selected</button></>}<button type="button" onClick={deleteActiveList} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-500/25 px-3 text-xs font-semibold text-rose-300 hover:bg-rose-950/20"><Trash2 className="h-4 w-4" /> Delete list</button></div>}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <label className="relative xl:col-span-2"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#807482]" /><input type="search" placeholder="Search title, author, series, or tag" value={searchFilter} onChange={(event) => setSearchFilter(event.target.value)} className="h-11 w-full rounded-xl border border-[#c5a059]/18 bg-[#0d0910] pl-10 pr-4 text-sm text-[#f4efe6] outline-none transition placeholder:text-[#6f6570] focus:border-[#c5a059]/55" /></label>
          <select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)} className="inkbound-select"><option value="all">All formats</option><option value="hardcover">Hardcover</option><option value="paperback">Paperback</option><option value="ebook">Ebook</option><option value="audiobook">Audiobook</option></select>
          <select value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)} className="inkbound-select"><option value="all">All genres</option>{allGenres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}</select>
          <select value={ownershipFilter} onChange={(event) => setOwnershipFilter(event.target.value)} className="inkbound-select"><option value="all">Any ownership</option><option value="owned">Owned</option><option value="borrowed-library">Library loan</option><option value="borrowed-person">Borrowed</option><option value="wishlist">Wishlist</option></select>
          <select value={ratingFilter} onChange={(event) => setRatingFilter(event.target.value)} className="inkbound-select"><option value="all">Any rating</option><option value="5">5 stars</option><option value="4">4+ stars</option><option value="3">3+ stars</option></select>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortMode)} className="inkbound-select"><option value="recent">Recently added</option><option value="title">Title</option><option value="author">Author</option><option value="rating">Rating</option><option value="progress">Progress</option></select>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4"><button type="button" onClick={handleSelectAll} className="quiet-shelf-secondary-action">{canUseBatchEdit ? (allFilteredSelected ? <CheckSquare className="h-4 w-4 text-[#e2bd66]" /> : <Square className="h-4 w-4" />) : <Lock className="h-4 w-4 text-[#c5a059]" />}<span>{canUseBatchEdit ? (allFilteredSelected ? 'Deselect all' : 'Select all') : 'Batch edit'}</span></button><div className="flex items-center rounded-full border border-[#c5a059]/20 bg-[#0d0910] p-1"><button type="button" onClick={() => setViewMode('grid')} className={`rounded-full p-2 transition ${viewMode === 'grid' ? 'bg-[#c5a059] text-[#171015]' : 'text-[#9e919f] hover:text-[#f4efe6]'}`} aria-label="Grid view"><LayoutGrid className="h-4 w-4" /></button><button type="button" onClick={() => setViewMode('list')} className={`rounded-full p-2 transition ${viewMode === 'list' ? 'bg-[#c5a059] text-[#171015]' : 'text-[#9e919f] hover:text-[#f4efe6]'}`} aria-label="List view"><List className="h-4 w-4" /></button></div></div>
      </section>

      {filteredBooks.length === 0 ? <section className="inkbound-panel border-dashed p-12 text-center"><BookOpen className="mx-auto h-12 w-12 text-[#c5a059]/55" /><h2 className="mt-4 font-serif text-2xl font-bold text-[#f4efe6]">{activeCustomList ? `${activeCustomList} is empty` : 'No books found'}</h2><p className="mx-auto mt-2 max-w-md text-sm text-[#ad9fac]">{activeCustomList ? 'Select books from another library view, then add them to this list.' : 'Adjust the current filters or add a new title to your library.'}</p></section> : viewMode === 'grid' ? <LibraryBookGrid books={filteredBooks} selectedBookIds={selectedBookIds} onSelectBook={onSelectBook} onToggleSelectBook={onToggleSelectBook} /> : <section className="inkbound-panel overflow-hidden p-0"><div className="divide-y divide-white/5">{filteredBooks.map((book) => { const isSelected = selectedBookIds.includes(book.id); const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) || book.editions[0]; return <article key={book.id} onClick={() => onSelectBook(book)} className={`flex cursor-pointer items-center gap-4 p-4 transition hover:bg-[#1d1422] ${isSelected ? 'bg-[#c5a059]/10' : ''}`}><button type="button" onClick={(event) => { event.stopPropagation(); onToggleSelectBook(book.id); }} className="text-[#c5a059]" aria-label={isSelected ? 'Deselect book' : 'Select book'}>{isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5 text-[#6f6570]" />}</button><BookCover work={book.work} edition={activeEdition} size="sm" showFormatBadge={false} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.12em]"><span className="rounded-full border border-[#c5a059]/20 bg-[#c5a059]/8 px-2.5 py-1 text-[#e2bd66]">{activeEdition?.format || 'book'}</span><span className="rounded-full bg-[#24172a] px-2.5 py-1 text-[#b9acba]">{book.status.replaceAll('-', ' ')}</span></div><h3 className="mt-2 truncate font-serif text-lg font-bold text-[#f4efe6]">{book.work.title}</h3><p className="truncate text-xs text-[#ad9fac]">{book.work.author}</p></div><div className="hidden text-right sm:block">{book.rating ? <p className="flex items-center justify-end gap-1 text-sm font-bold text-[#e2bd66]"><Star className="h-3.5 w-3.5 fill-current" />{book.rating.toFixed(1)}</p> : <p className="text-xs text-[#807482]">Unrated</p>}<p className="mt-1 text-xs text-[#ad9fac]">{book.progressPercentage}% complete</p></div></article>; })}</div></section>}

      {selectedBookIds.length > 0 && <div className="fixed bottom-20 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#c5a059]/55 bg-[#17101b]/95 px-4 py-3 shadow-2xl backdrop-blur md:bottom-6 md:ml-[116px]"><span className="whitespace-nowrap text-xs font-bold text-[#e2bd66]">{selectedBookIds.length} selected</span>{activeCustomList && <button type="button" onClick={addSelectedToActiveList} className="rounded-full border border-[#c5a059]/30 px-4 py-2 text-xs font-bold text-[#e2bd66]">Add to list</button>}<button type="button" onClick={onOpenBatchEdit} className="rounded-full bg-[#c5a059] px-4 py-2 text-xs font-bold text-[#171015]">Batch Actions</button><button type="button" onClick={onClearSelection} className="rounded-full p-2 text-[#ad9fac] hover:text-white" aria-label="Clear selection"><X className="h-4 w-4" /></button></div>}

      {isCreateListOpen && <div className="fixed inset-0 z-[210] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsCreateListOpen(false); }}><section className="w-full max-w-md rounded-3xl border border-[#c5a059]/35 bg-[#17101b] p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="create-list-title"><div className="flex items-start justify-between gap-4"><div><p className="inkbound-kicker">Personal organization</p><h2 id="create-list-title" className="mt-2 font-serif text-3xl text-[#f4efe6]">Create a List</h2></div><button type="button" onClick={() => setIsCreateListOpen(false)} className="rounded-full p-2 text-[#ad9fac] hover:bg-white/5 hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button></div><p className="mt-3 text-sm text-[#ad9fac]">Lists do not replace TBR, Read, DNF, or other reading statuses. A book can belong to several lists.</p><label className="mt-5 block text-sm font-semibold text-[#f4efe6]">List name<input autoFocus value={newListName} onChange={(event) => { setNewListName(event.target.value); setListError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') createCustomList(); }} placeholder="Comfort Reads" className="mt-2 h-12 w-full rounded-xl border border-[#c5a059]/25 bg-[#0d0910] px-4 text-[#f4efe6] outline-none placeholder:text-[#6f6570] focus:border-[#c5a059]/60" /></label>{selectedBookIds.length > 0 && <p className="mt-3 rounded-xl border border-[#c5a059]/18 bg-[#c5a059]/8 p-3 text-xs text-[#d9ced9]">The {selectedBookIds.length} currently selected book{selectedBookIds.length === 1 ? '' : 's'} will be added automatically.</p>}{listError && <p className="mt-3 text-sm text-rose-300">{listError}</p>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setIsCreateListOpen(false)} className="quiet-shelf-secondary-action">Cancel</button><button type="button" onClick={createCustomList} className="quiet-shelf-primary-action"><FolderPlus className="h-4 w-4" />Create List</button></div></section></div>}
    </div>
  );
};
