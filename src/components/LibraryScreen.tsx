import React, { useState, useMemo } from 'react';
import { UserBookRecord, ReadingStatus, OwnershipStatus, Format } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { BookCover } from './BookCover';
import {
  LayoutGrid,
  List,
  Filter,
  ArrowUpDown,
  CheckSquare,
  Square,
  Search,
  Star,
  BookOpen,
  Headphones,
  Tablet,
  X,
  Plus,
  Sparkles,
  Lock
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
  const { userPlan, freeBookLimit, canAddBook, canUseBatchEdit, openUpgradeModal } = useUserPlan();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [activeTab, setActiveTab] = useState<string>('all');

  
  // Filter States
  const [searchFilter, setSearchFilter] = useState('');
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [genreFilter, setGenreFilter] = useState<string>('all');
  const [ownershipFilter, setOwnershipFilter] = useState<string>('all');
  const [ratingFilter, setRatingFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'author' | 'rating' | 'progress'>('recent');

  // Extract unique genres for dropdown
  const allGenres = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => b.work.genres.forEach((g) => set.add(g)));
    return Array.from(set).sort();
  }, [books]);

  // Filtered & Sorted books
  const filteredBooks = useMemo(() => {
    return books
      .filter((b) => {
        // Tab Status Filter
        if (activeTab === 'currently-reading' && b.status !== 'currently-reading') return false;
        if (activeTab === 'finished' && b.status !== 'finished') return false;
        if (activeTab === 'paused' && b.status !== 'paused') return false;
        if (activeTab === 'dnf' && b.status !== 'dnf') return false;
        if (activeTab === 'owned' && b.ownership !== 'owned') return false;
        if (activeTab === 'borrowed' && !['borrowed-library', 'borrowed-person'].includes(b.ownership)) return false;
        if (activeTab === 'wishlist' && b.ownership !== 'wishlist' && b.status !== 'wishlist') return false;

        // Search text
        if (searchFilter.trim()) {
          const q = searchFilter.toLowerCase();
          const matchesTitle = b.work.title.toLowerCase().includes(q);
          const matchesAuthor = b.work.author.toLowerCase().includes(q);
          const matchesSeries = b.work.seriesName?.toLowerCase().includes(q);
          const matchesTags = b.privateTags.some((t) => t.toLowerCase().includes(q));
          if (!matchesTitle && !matchesAuthor && !matchesSeries && !matchesTags) return false;
        }

        // Format Filter
        if (formatFilter !== 'all') {
          const hasFormat = b.editions.some((e) => e.format === formatFilter);
          if (!hasFormat) return false;
        }

        // Genre Filter
        if (genreFilter !== 'all' && !b.work.genres.includes(genreFilter)) return false;

        // Ownership Filter
        if (ownershipFilter !== 'all' && b.ownership !== ownershipFilter) return false;

        // Rating Filter
        if (ratingFilter !== 'all') {
          const r = parseFloat(ratingFilter);
          if ((b.rating || 0) < r) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'title') return a.work.title.localeCompare(b.work.title);
        if (sortBy === 'author') return a.work.author.localeCompare(b.work.author);
        if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0);
        if (sortBy === 'progress') return b.progressPercentage - a.progressPercentage;
        // Default recent
        return new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
      });
  }, [books, activeTab, searchFilter, formatFilter, genreFilter, ownershipFilter, ratingFilter, sortBy]);

  const allFilteredSelected = filteredBooks.length > 0 && filteredBooks.every((b) => selectedBookIds.includes(b.id));

  return (
    <div className="space-y-6 pb-20">
      {/* Header & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-serif font-bold text-[#f4efe6]">
              My Library
            </h1>
            {userPlan === 'free' ? (
              <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                books.length >= freeBookLimit
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-[#c5a059]/15 text-[#e5c158] border-[#c5a059]/30'
              }`}>
                {books.length} of {freeBookLimit} books used
              </span>
            ) : (
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-[#c5a059]/20 text-[#e5c158] border border-[#c5a059]/40 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-[#e5c158]" /> Premium (Unlimited)
              </span>
            )}
          </div>
          <p className="text-sm text-stone-400 mt-1">
            {filteredBooks.length} of {books.length} books showing in current view
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Add Book */}
          <button
            onClick={() => {
              if (userPlan === 'free' && books.length >= freeBookLimit) {
                openUpgradeModal(`You have reached the Free limit of ${freeBookLimit} books. Upgrade to Premium to add unlimited books.`);
              } else {
                onOpenAddBook();
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold shadow-md transition ${
              userPlan === 'free' && books.length >= freeBookLimit
                ? 'bg-amber-500 text-stone-900 hover:bg-amber-400'
                : 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] hover:opacity-95'
            }`}
          >
            {userPlan === 'free' && books.length >= freeBookLimit ? (
              <Lock className="w-4 h-4" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            <span>Add Book</span>
          </button>

          {/* Grid / List view toggle */}
          <div className="flex items-center bg-[#1c0f24] p-1 rounded-xl border border-[#c5a059]/25">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg text-xs transition ${
                viewMode === 'grid'
                  ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] shadow-sm font-bold'
                  : 'text-stone-400 hover:text-[#f4efe6]'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg text-xs transition ${
                viewMode === 'list'
                  ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] shadow-sm font-bold'
                  : 'text-stone-400 hover:text-[#f4efe6]'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-[#36213d]">
        {[
          { id: 'all', label: 'All Books' },
          { id: 'currently-reading', label: 'Currently Reading' },
          { id: 'finished', label: 'Finished' },
          { id: 'paused', label: 'Paused' },
          { id: 'dnf', label: 'Did Not Finish' },
          { id: 'owned', label: 'Owned Copies' },
          { id: 'borrowed', label: 'Borrowed' },
          { id: 'wishlist', label: 'Wishlist' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold shadow-md'
                : 'text-stone-300 hover:bg-[#25132f] border border-transparent hover:border-[#c5a059]/20'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Controls Bar: Search, Filters, Sort, Select All */}
      <div className="bg-[#1c0f24] border border-[#c5a059]/25 p-4 rounded-xl shadow-xl space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          
          {/* Search */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search library..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
            />
          </div>

          {/* Format */}
          <select
            value={formatFilter}
            onChange={(e) => setFormatFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
          >
            <option value="all">All Formats</option>
            <option value="hardcover">Hardcover</option>
            <option value="paperback">Paperback</option>
            <option value="ebook">Ebook</option>
            <option value="audiobook">Audiobook</option>
          </select>

          {/* Genre */}
          <select
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
          >
            <option value="all">All Genres</option>
            {allGenres.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-1.5 rounded-lg text-xs bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
          >
            <option value="recent">Sort: Recently Added</option>
            <option value="title">Sort: Title</option>
            <option value="author">Sort: Author</option>
            <option value="rating">Sort: Rating</option>
            <option value="progress">Sort: Progress</option>
          </select>

          {/* Select All Toggle */}
          <button
            onClick={() => {
              if (!canUseBatchEdit) {
                openUpgradeModal('Batch selection and multi-book editing require Reading App Premium.');
                return;
              }
              if (allFilteredSelected) {
                onClearSelection();
              } else {
                onSelectAll(filteredBooks.map((b) => b.id));
              }
            }}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#25132f] border border-[#c5a059]/30 text-[#f4efe6] hover:bg-[#32193f] transition"
          >
            {canUseBatchEdit ? (
              allFilteredSelected ? <CheckSquare className="w-4 h-4 text-[#c5a059]" /> : <Square className="w-4 h-4 text-stone-400" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-[#c5a059]" />
            )}
            <span>{canUseBatchEdit ? (allFilteredSelected ? 'Deselect All' : 'Select All') : 'Batch Selection (Premium)'}</span>
          </button>

        </div>
      </div>

      {/* Batch Action Persistent Bar Trigger if selected */}
      {selectedBookIds.length > 0 && (
        <div className="fixed bottom-16 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#361539] text-[#f8f4ed] px-5 py-3 rounded-full shadow-2xl border border-[#c5a059] flex items-center gap-4 animate-bounce-short">
          <span className="text-xs font-bold text-[#c5a059]">
            {selectedBookIds.length} book{selectedBookIds.length > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={onOpenBatchEdit}
            className="px-3.5 py-1.5 rounded-full bg-[#c5a059] text-[#1c121e] text-xs font-bold hover:bg-[#b58e45] transition"
          >
            Batch Actions
          </button>
          <button
            onClick={onClearSelection}
            className="p-1 rounded-full text-stone-300 hover:text-white"
            title="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Books Grid or List */}
      {filteredBooks.length === 0 ? (
        <div className="bg-[#1c0f24] border border-dashed border-[#3d2448] rounded-2xl p-12 text-center space-y-3 shadow-xl">
          <BookOpen className="w-12 h-12 text-[#c5a059]/60 mx-auto" />
          <h3 className="font-serif font-bold text-xl text-[#f4efe6]">
            No Books Found
          </h3>
          <p className="text-xs text-stone-400 max-w-md mx-auto">
            Try adjusting your search criteria or add new books to your catalog.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
          {filteredBooks.map((book) => {
            const isSelected = selectedBookIds.includes(book.id);
            const activeEdition = book.editions.find((e) => e.id === book.activeEditionId) || book.editions[0];

            return (
              <div
                key={book.id}
                onClick={() => onSelectBook(book)}
                className={`group flex flex-col items-center p-2.5 rounded-xl transition cursor-pointer ${
                  isSelected
                    ? 'bg-[#c5a059]/20 border border-[#c5a059] shadow-lg shadow-[#c5a059]/10'
                    : 'hover:bg-[#25132f] border border-transparent hover:border-[#c5a059]/20'
                }`}
              >
                <BookCover
                  work={book.work}
                  edition={activeEdition}
                  size="md"
                  progressPercentage={book.progressPercentage}
                  rating={book.rating}
                  isSelected={isSelected}
                  onSelectToggle={() => onToggleSelectBook(book.id)}
                />

                <div className="mt-2 text-center w-full px-1">
                  <h4 className="font-serif font-bold text-xs text-[#f4efe6] line-clamp-1 group-hover:text-[#c5a059] transition">
                    {book.work.title}
                  </h4>
                  <p className="text-[11px] text-stone-400 truncate">{book.work.author}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Detailed List View */
        <div className="bg-[#1c0f24] border border-[#c5a059]/20 rounded-xl overflow-hidden shadow-2xl divide-y divide-[#3d2448]">
          {filteredBooks.map((book) => {
            const isSelected = selectedBookIds.includes(book.id);
            const activeEdition = book.editions.find((e) => e.id === book.activeEditionId) || book.editions[0];

            return (
              <div
                key={book.id}
                onClick={() => onSelectBook(book)}
                className={`p-4 flex items-center gap-4 hover:bg-[#25132f] cursor-pointer transition ${
                  isSelected ? 'bg-[#c5a059]/15' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleSelectBook(book.id);
                  }}
                  className="w-4 h-4 rounded border-[#3d2448] text-[#c5a059] focus:ring-[#c5a059]"
                />

                <BookCover work={book.work} edition={activeEdition} size="sm" showFormatBadge={false} />

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-[#e5c158] bg-[#c5a059]/15 px-2 py-0.5 rounded border border-[#c5a059]/25">
                      {activeEdition?.format || 'hardcover'}
                    </span>
                    <span className="text-[10px] uppercase font-bold text-stone-300 bg-[#2d1838] px-2 py-0.5 rounded border border-[#3d2448]">
                      {book.status}
                    </span>
                    {book.work.seriesName && (
                      <span className="text-[10px] text-[#e5c158] font-medium">
                        {book.work.seriesName} #{book.work.seriesOrder}
                      </span>
                    )}
                  </div>

                  <h3 className="font-serif font-bold text-base text-[#f4efe6]">
                    {book.work.title}
                  </h3>
                  <p className="text-xs text-stone-400">{book.work.author}</p>
                </div>

                <div className="text-right shrink-0 space-y-1">
                  {book.rating ? (
                    <div className="flex items-center justify-end gap-1 text-[#e5c158] text-xs font-bold">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      <span>{book.rating.toFixed(1)}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-stone-500">Unrated</span>
                  )}
                  <p className="text-xs text-stone-400 font-medium">{book.progressPercentage}% complete</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
