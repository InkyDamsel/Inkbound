import React, { useState } from 'react';
import { UserBookRecord, ReadingStatus, OwnershipStatus, Format, Priority } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import {
  X,
  Search,
  BookOpen,
  Plus,
  Check,
  Sparkles,
  Barcode,
  Lock,
  ListPlus,
  Layers,
  AlertCircle
} from 'lucide-react';

interface AddBookModalProps {
  currentBookCount: number;
  onClose: () => void;
  onAddBook: (newBook: UserBookRecord) => void;
  onAddMultipleBooks?: (newBooks: UserBookRecord[]) => void;
}

export const AddBookModal: React.FC<AddBookModalProps> = ({
  currentBookCount,
  onClose,
  onAddBook,
  onAddMultipleBooks,
}) => {
  const { userPlan, freeBookLimit, canAddBook, openUpgradeModal } = useUserPlan();
  const [activeTab, setActiveTab] = useState<'single' | 'manual' | 'multi'>('single');

  // Multi-add ISBNs / titles input
  const [isbnListText, setIsbnListText] = useState('');
  const [bulkStatus, setBulkStatus] = useState<ReadingStatus>('tbr');
  const [bulkFormat, setBulkFormat] = useState<Format>('paperback');
  const [bulkOwnership, setBulkOwnership] = useState<OwnershipStatus>('owned');
  const [bulkTag, setBulkTag] = useState('bulk-imported');

  // Single Search Catalog Mock items
  const [searchQuery, setSearchQuery] = useState('');
  const mockCatalog = [
    { title: 'The Shadows of Eldoria', author: 'Evelyn Thorne', genres: ['Fantasy', 'Gothic'], format: 'hardcover' as Format },
    { title: 'Whispers in the Stacks', author: 'Julian Vance', genres: ['Mystery', 'Thriller'], format: 'paperback' as Format },
    { title: 'Chronicles of Starlight', author: 'Lyra Mercer', genres: ['Sci-Fi', 'Space Opera'], format: 'ebook' as Format },
    { title: 'The Midnight Parlor', author: 'Arthur Pendelton', genres: ['Historical Fiction'], format: 'audiobook' as Format },
    { title: 'Bespoke Cartography', author: 'Clara Oswald', genres: ['Non-Fiction', 'Art'], format: 'hardcover' as Format },
  ];

  const filteredCatalog = searchQuery.trim()
    ? mockCatalog.filter(
        (b) =>
          b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          b.author.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : mockCatalog;

  // Selected catalog items for multi-add
  const [selectedCatalogIndex, setSelectedCatalogIndex] = useState<number[]>([]);

  // Manual Single Form States
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [summary, setSummary] = useState('');
  const [seriesName, setSeriesName] = useState('');
  const [seriesOrder, setSeriesOrder] = useState('1');
  const [genres, setGenres] = useState('Fiction, Mystery');
  const [status, setStatus] = useState<ReadingStatus>('tbr');
  const [ownership, setOwnership] = useState<OwnershipStatus>('owned');
  const [format, setFormat] = useState<Format>('hardcover');
  const [priority, setPriority] = useState<Priority>('medium');
  const [pageCount, setPageCount] = useState('380');

  const isAtLimit = userPlan === 'free' && !canAddBook(currentBookCount);

  const handleAddSingleCatalog = (item: (typeof mockCatalog)[0]) => {
    if (isAtLimit) {
      openUpgradeModal(`Free accounts are limited to ${freeBookLimit} books. Upgrade to Premium for unlimited books.`);
      return;
    }

    const recId = 'book-' + Date.now();
    const edId = 'ed-' + Date.now();
    const newBook: UserBookRecord = {
      id: recId,
      work: {
        id: 'work-' + Date.now(),
        title: item.title,
        author: item.author,
        summary: `Catalog entry for ${item.title} by ${item.author}.`,
        genres: item.genres,
        publicationYear: 2024,
      },
      activeEditionId: edId,
      editions: [
        {
          id: edId,
          format: item.format,
          pageCount: 360,
          coverGradient: 'from-amber-950 via-[#361539] to-stone-900',
        },
      ],
      status: 'tbr',
      ownership: 'owned',
      progressPages: 0,
      progressMinutes: 0,
      progressPercentage: 0,
      favoriteQuotes: [],
      privateTags: ['catalog-add'],
      priority: 'medium',
      moods: ['Reflective'],
      collections: [],
      dateAdded: new Date().toISOString().split('T')[0],
    };

    onAddBook(newBook);
    onClose();
  };

  const handleManualAdd = () => {
    if (!title.trim() || !author.trim()) return;
    if (isAtLimit) {
      openUpgradeModal(`Free accounts are limited to ${freeBookLimit} books. Upgrade to Premium for unlimited books.`);
      return;
    }

    const bookWorkId = 'work-' + Date.now();
    const edId = 'ed-' + Date.now();
    const recId = 'book-' + Date.now();

    const newBook: UserBookRecord = {
      id: recId,
      work: {
        id: bookWorkId,
        title: title.trim(),
        author: author.trim(),
        summary: summary.trim() || 'No catalog summary available.',
        publisherSummary: summary.trim() || undefined,
        seriesName: seriesName.trim() || undefined,
        seriesOrder: seriesName.trim() ? parseInt(seriesOrder) || 1 : undefined,
        genres: genres.split(',').map((g) => g.trim()).filter(Boolean),
        publicationYear: new Date().getFullYear(),
      },
      activeEditionId: edId,
      editions: [
        {
          id: edId,
          format,
          pageCount: parseInt(pageCount) || 350,
          coverGradient: 'from-amber-950 via-[#361539] to-stone-900',
        },
      ],
      status,
      ownership,
      progressPages: 0,
      progressMinutes: 0,
      progressPercentage: 0,
      favoriteQuotes: [],
      privateTags: ['manual-add'],
      priority,
      moods: ['Atmospheric'],
      collections: [],
      dateAdded: new Date().toISOString().split('T')[0],
    };

    onAddBook(newBook);
    onClose();
  };

  const handleBatchAddMultiple = () => {
    if (userPlan === 'free') {
      openUpgradeModal('Adding multiple books at once is a The Quiet Shelf Premium feature.');
      return;
    }

    const lines = isbnListText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0 && selectedCatalogIndex.length === 0) return;

    const newBooks: UserBookRecord[] = [];

    // Process selected catalog items
    selectedCatalogIndex.forEach((idx) => {
      const item = mockCatalog[idx];
      if (!item) return;
      const recId = 'book-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
      const edId = 'ed-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
      newBooks.push({
        id: recId,
        work: {
          id: 'work-' + Date.now(),
          title: item.title,
          author: item.author,
          summary: `Batch added entry for ${item.title}.`,
          genres: item.genres,
          publicationYear: 2024,
        },
        activeEditionId: edId,
        editions: [
          {
            id: edId,
            format: bulkFormat,
            pageCount: 320,
            coverGradient: 'from-amber-950 via-[#361539] to-stone-900',
          },
        ],
        status: bulkStatus,
        ownership: bulkOwnership,
        progressPages: 0,
        progressMinutes: 0,
        progressPercentage: 0,
        favoriteQuotes: [],
        privateTags: bulkTag.trim() ? [bulkTag.trim()] : ['batch-added'],
        priority: 'medium',
        moods: ['Atmospheric'],
        collections: [],
        dateAdded: new Date().toISOString().split('T')[0],
      });
    });

    // Process pasted ISBN/Title list
    lines.forEach((line) => {
      const parts = line.split(',');
      const titleStr = parts[0]?.trim() || line;
      const authorStr = parts[1]?.trim() || 'Unknown Author';

      const recId = 'book-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
      const edId = 'ed-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);

      newBooks.push({
        id: recId,
        work: {
          id: 'work-' + Date.now(),
          title: titleStr,
          author: authorStr,
          summary: `Imported via bulk ISBN / title list: ${line}`,
          genres: ['General Fiction'],
          publicationYear: 2023,
        },
        activeEditionId: edId,
        editions: [
          {
            id: edId,
            format: bulkFormat,
            isbn: line.replace(/[^0-9X]/gi, '').length >= 10 ? line : undefined,
            pageCount: 300,
            coverGradient: 'from-amber-950 via-[#361539] to-stone-900',
          },
        ],
        status: bulkStatus,
        ownership: bulkOwnership,
        progressPages: 0,
        progressMinutes: 0,
        progressPercentage: 0,
        favoriteQuotes: [],
        privateTags: bulkTag.trim() ? [bulkTag.trim()] : ['isbn-list'],
        priority: 'medium',
        moods: ['Engaging'],
        collections: [],
        dateAdded: new Date().toISOString().split('T')[0],
      });
    });

    if (onAddMultipleBooks && newBooks.length > 0) {
      onAddMultipleBooks(newBooks);
    } else {
      newBooks.forEach((b) => onAddBook(b));
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#1c0f24] border border-[#c5a059]/40 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-stone-400 hover:text-white p-1 rounded-full bg-black/30 hover:bg-black/50 transition">
          <X className="w-5 h-5" />
        </button>

        <div className="text-center space-y-1">
          <BookOpen className="w-8 h-8 text-[#e5c158] mx-auto" />
          <h3 className="font-serif font-bold text-2xl text-[#f4efe6]">
            Add Book to Library
          </h3>
          
          {userPlan === 'free' ? (
            <div className="flex items-center justify-center gap-2 pt-1">
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                isAtLimit ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40' : 'bg-[#120817] text-[#e5c158] border border-[#3d2448]'
              }`}>
                {currentBookCount} of {freeBookLimit} books used
              </span>
            </div>
          ) : (
            <p className="text-xs text-[#e5c158] font-bold flex items-center justify-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> Premium Tier — Unlimited Catalog
            </p>
          )}
        </div>

        {/* Limit Alert for Free Users */}
        {isAtLimit && (
          <div className="p-3.5 bg-amber-950/40 border border-amber-500/40 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold text-amber-300">
                Library Limit Reached ({freeBookLimit}/{freeBookLimit})
              </p>
              <p className="text-stone-300">
                You have used all {freeBookLimit} free book slots. All existing books remain fully accessible.
              </p>
              <button
                onClick={() => openUpgradeModal('Upgrade to Premium to add unlimited books')}
                className="mt-1 font-bold text-[#e5c158] hover:underline flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" /> Upgrade to Premium for Unlimited Books
              </button>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex bg-[#120817] p-1 rounded-xl text-xs font-semibold border border-[#3d2448]">
          <button
            onClick={() => setActiveTab('single')}
            className={`flex-1 py-1.5 rounded-lg transition ${
              activeTab === 'single' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold shadow' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            Catalog Search
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex-1 py-1.5 rounded-lg transition ${
              activeTab === 'manual' ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold shadow' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            Single Manual
          </button>
          <button
            onClick={() => {
              if (userPlan === 'free') {
                openUpgradeModal('Adding multiple books at once is a Premium feature.');
              } else {
                setActiveTab('multi');
              }
            }}
            className={`flex-1 py-1.5 rounded-lg transition flex items-center justify-center gap-1 ${
              activeTab === 'multi'
                ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold shadow'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <ListPlus className="w-3.5 h-3.5" />
            <span>Multiple Books</span>
            {userPlan === 'free' && <Lock className="w-3 h-3 text-stone-400" />}
          </button>
        </div>

        {/* Catalog Search Tab */}
        {activeTab === 'single' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search catalog by title, author, or ISBN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#120817] border border-[#3d2448] text-xs text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
              />
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {filteredCatalog.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-xl bg-[#25132f] border border-[#3d2448]"
                >
                  <div>
                    <p className="text-xs font-bold text-[#f4efe6] font-serif">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-stone-400">
                      by {item.author} • <span className="uppercase">{item.format}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => handleAddSingleCatalog(item)}
                    disabled={isAtLimit}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] hover:opacity-95 text-xs font-bold disabled:opacity-50 transition shadow"
                  >
                    + Add
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Manual Tab */}
        {activeTab === 'manual' && (
          <div className="space-y-3 text-xs max-h-80 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-[#f4efe6] block mb-1">Book Title *</label>
                <input
                  type="text"
                  placeholder="The Alchemist's Cipher"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full p-2 rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                />
              </div>
              <div>
                <label className="font-bold text-[#f4efe6] block mb-1">Author *</label>
                <input
                  type="text"
                  placeholder="Author Name"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="w-full p-2 rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                />
              </div>
            </div>

            <div>
              <label className="font-bold text-[#f4efe6] block mb-1">Summary</label>
              <textarea
                rows={2}
                placeholder="Brief summary..."
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full p-2 rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-[#f4efe6] block mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ReadingStatus)}
                  className="w-full p-2 rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none"
                >
                  <option value="tbr">TBR Queue</option>
                  <option value="currently-reading">Currently Reading</option>
                  <option value="finished">Finished</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-[#f4efe6] block mb-1">Format</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as Format)}
                  className="w-full p-2 rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none"
                >
                  <option value="hardcover">Hardcover</option>
                  <option value="paperback">Paperback</option>
                  <option value="ebook">Ebook</option>
                  <option value="audiobook">Audiobook</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleManualAdd}
              disabled={!title.trim() || !author.trim() || isAtLimit}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-xs shadow hover:opacity-95 disabled:opacity-50"
            >
              Add Single Title
            </button>
          </div>
        )}

        {/* Multi-Add Tab (Premium Only) */}
        {activeTab === 'multi' && (
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-[#c5a059]/15 border border-[#c5a059]/30 rounded-xl">
              <span className="font-bold text-[#e5c158] block mb-1">Multiple-Book Add Flow (Premium)</span>
              <p className="text-stone-300">
                Paste multiple ISBNs or Title, Author pairs (one per line), or multi-select search results below.
              </p>
            </div>

            <div>
              <label className="font-bold text-[#f4efe6] block mb-1">
                Paste ISBNs or Titles (One per line)
              </label>
              <textarea
                rows={3}
                placeholder={"9780143127741\n9780345806789, E.L. James\nThe Hobbit, J.R.R. Tolkien"}
                value={isbnListText}
                onChange={(e) => setIsbnListText(e.target.value)}
                className="w-full p-2 rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] font-mono text-[11px] focus:outline-none focus:border-[#c5a059]"
              />
            </div>

            {/* Shared Defaults */}
            <div className="space-y-2 border-t border-[#3d2448] pt-3">
              <span className="font-bold text-[#f4efe6] block">
                Shared Default Settings for Newly Added Books:
              </span>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-stone-400 block mb-1">Status</label>
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value as ReadingStatus)}
                    className="w-full p-1.5 rounded bg-[#120817] border border-[#3d2448] text-[#f4efe6]"
                  >
                    <option value="tbr">TBR</option>
                    <option value="currently-reading">Reading</option>
                    <option value="finished">Finished</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-stone-400 block mb-1">Format</label>
                  <select
                    value={bulkFormat}
                    onChange={(e) => setBulkFormat(e.target.value as Format)}
                    className="w-full p-1.5 rounded bg-[#120817] border border-[#3d2448] text-[#f4efe6]"
                  >
                    <option value="paperback">Paperback</option>
                    <option value="hardcover">Hardcover</option>
                    <option value="ebook">Ebook</option>
                    <option value="audiobook">Audiobook</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-stone-400 block mb-1">Ownership</label>
                  <select
                    value={bulkOwnership}
                    onChange={(e) => setBulkOwnership(e.target.value as OwnershipStatus)}
                    className="w-full p-1.5 rounded bg-[#120817] border border-[#3d2448] text-[#f4efe6]"
                  >
                    <option value="owned">Owned</option>
                    <option value="borrowed-library">Library</option>
                    <option value="subscription">Subscription</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={handleBatchAddMultiple}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-xs shadow hover:opacity-95 transition flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-4 h-4 text-[#120817]" />
              Add Multiple Books
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
