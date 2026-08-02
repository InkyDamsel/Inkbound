import React, { useState } from 'react';
import { Format, OwnershipStatus, Priority, ReadingStatus, UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { AlertCircle, BookOpen, ListPlus, Lock, Search, Sparkles, X } from 'lucide-react';

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

  const [isbnListText, setIsbnListText] = useState('');
  const [bulkStatus, setBulkStatus] = useState<ReadingStatus>('tbr');
  const [bulkFormat, setBulkFormat] = useState<Format>('paperback');
  const [bulkOwnership, setBulkOwnership] = useState<OwnershipStatus>('owned');
  const [bulkTag, setBulkTag] = useState('bulk-imported');

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
        (book) =>
          book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          book.author.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : mockCatalog;

  const [selectedCatalogIndex] = useState<number[]>([]);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [summary, setSummary] = useState('');
  const [seriesName] = useState('');
  const [seriesOrder] = useState('1');
  const [genres] = useState('Fiction, Mystery');
  const [status, setStatus] = useState<ReadingStatus>('tbr');
  const [ownership] = useState<OwnershipStatus>('owned');
  const [format, setFormat] = useState<Format>('hardcover');
  const [priority] = useState<Priority>('medium');
  const [pageCount] = useState('380');

  const isAtLimit = userPlan === 'free' && !canAddBook(currentBookCount);

  const handleAddSingleCatalog = (item: (typeof mockCatalog)[0]) => {
    if (isAtLimit) {
      openUpgradeModal(`Free accounts are limited to ${freeBookLimit} books. Upgrade to Premium for unlimited books.`);
      return;
    }

    const recId = `book-${Date.now()}`;
    const edId = `ed-${Date.now()}`;
    const newBook: UserBookRecord = {
      id: recId,
      work: {
        id: `work-${Date.now()}`,
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

    const bookWorkId = `work-${Date.now()}`;
    const edId = `ed-${Date.now()}`;
    const recId = `book-${Date.now()}`;

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
        genres: genres.split(',').map((genre) => genre.trim()).filter(Boolean),
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
      openUpgradeModal('Adding multiple books at once is an Inkbound Premium feature.');
      return;
    }

    const lines = isbnListText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0 && selectedCatalogIndex.length === 0) return;

    const newBooks: UserBookRecord[] = [];

    selectedCatalogIndex.forEach((index) => {
      const item = mockCatalog[index];
      if (!item) return;
      const recId = `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const edId = `ed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      newBooks.push({
        id: recId,
        work: {
          id: `work-${Date.now()}`,
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

    lines.forEach((line) => {
      const parts = line.split(',');
      const titleStr = parts[0]?.trim() || line;
      const authorStr = parts[1]?.trim() || 'Unknown Author';
      const recId = `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const edId = `ed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      newBooks.push({
        id: recId,
        work: {
          id: `work-${Date.now()}`,
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
      newBooks.forEach((book) => onAddBook(book));
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section
        className="relative max-h-[100dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-book-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-black/30 p-2 text-stone-400 transition hover:bg-black/50 hover:text-white"
          aria-label="Close add book dialog"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="space-y-5">
          <div className="space-y-1 pr-10 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-[#e5c158]" />
            <h3 id="add-book-title" className="font-serif text-2xl font-bold text-[#f4efe6]">
              Add Book to Library
            </h3>

            {userPlan === 'free' ? (
              <div className="flex items-center justify-center gap-2 pt-1">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                    isAtLimit
                      ? 'border-amber-500/40 bg-amber-950/80 text-amber-300'
                      : 'border-[#3d2448] bg-[#120817] text-[#e5c158]'
                  }`}
                >
                  {currentBookCount} of {freeBookLimit} books used
                </span>
              </div>
            ) : (
              <p className="flex items-center justify-center gap-1 text-xs font-bold text-[#e5c158]">
                <Sparkles className="h-3.5 w-3.5" /> Premium Tier — Unlimited Catalog
              </p>
            )}
          </div>

          {isAtLimit && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-950/40 p-3.5">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div className="space-y-1 text-xs">
                <p className="font-bold text-amber-300">
                  Library Limit Reached ({freeBookLimit}/{freeBookLimit})
                </p>
                <p className="text-stone-300">
                  You have used all {freeBookLimit} free book slots. All existing books remain fully accessible.
                </p>
                <button
                  type="button"
                  onClick={() => openUpgradeModal('Upgrade to Premium to add unlimited books')}
                  className="mt-1 flex items-center gap-1 font-bold text-[#e5c158] hover:underline"
                >
                  <Sparkles className="h-3 w-3" /> Upgrade to Premium for Unlimited Books
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-1 rounded-xl border border-[#3d2448] bg-[#120817] p-1 text-[10px] font-semibold sm:text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('single')}
              className={`min-h-10 rounded-lg px-2 transition ${
                activeTab === 'single'
                  ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] font-bold text-[#120817] shadow'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              Catalog Search
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('manual')}
              className={`min-h-10 rounded-lg px-2 transition ${
                activeTab === 'manual'
                  ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] font-bold text-[#120817] shadow'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => {
                if (userPlan === 'free') {
                  openUpgradeModal('Adding multiple books at once is a Premium feature.');
                } else {
                  setActiveTab('multi');
                }
              }}
              className={`flex min-h-10 items-center justify-center gap-1 rounded-lg px-1 transition ${
                activeTab === 'multi'
                  ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] font-bold text-[#120817] shadow'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <ListPlus className="h-3.5 w-3.5 shrink-0" />
              <span>Multiple</span>
              {userPlan === 'free' && <Lock className="h-3 w-3 shrink-0 text-stone-400" />}
            </button>
          </div>

          {activeTab === 'single' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  type="search"
                  placeholder="Search by title, author, or ISBN..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full rounded-xl border border-[#3d2448] bg-[#120817] py-2.5 pl-9 pr-3 text-xs text-[#f4efe6] focus:border-[#c5a059] focus:outline-none"
                />
              </div>

              <div className="max-h-[45dvh] space-y-2 overflow-y-auto pr-1 sm:max-h-60">
                {filteredCatalog.map((item) => (
                  <article
                    key={`${item.title}-${item.author}`}
                    className="flex flex-col gap-3 rounded-xl border border-[#3d2448] bg-[#25132f] p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-serif text-sm font-bold text-[#f4efe6]">{item.title}</p>
                      <p className="text-[11px] text-stone-400">
                        by {item.author} • <span className="uppercase">{item.format}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddSingleCatalog(item)}
                      disabled={isAtLimit}
                      className="min-h-10 rounded-lg bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-4 text-xs font-bold text-[#120817] shadow transition hover:opacity-95 disabled:opacity-50 sm:min-h-0 sm:py-1.5"
                    >
                      + Add
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'manual' && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="font-bold text-[#f4efe6]">
                  Book Title *
                  <input
                    type="text"
                    placeholder="The Alchemist's Cipher"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#3d2448] bg-[#120817] p-2.5 text-[#f4efe6] focus:border-[#c5a059] focus:outline-none"
                  />
                </label>
                <label className="font-bold text-[#f4efe6]">
                  Author *
                  <input
                    type="text"
                    placeholder="Author Name"
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#3d2448] bg-[#120817] p-2.5 text-[#f4efe6] focus:border-[#c5a059] focus:outline-none"
                  />
                </label>
              </div>

              <label className="block font-bold text-[#f4efe6]">
                Summary
                <textarea
                  rows={3}
                  placeholder="Brief summary..."
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  className="mt-1 w-full resize-y rounded-lg border border-[#3d2448] bg-[#120817] p-2.5 text-[#f4efe6] focus:border-[#c5a059] focus:outline-none"
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="font-bold text-[#f4efe6]">
                  Status
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as ReadingStatus)}
                    className="mt-1 w-full rounded-lg border border-[#3d2448] bg-[#120817] p-2.5 text-[#f4efe6] focus:outline-none"
                  >
                    <option value="tbr">TBR Queue</option>
                    <option value="currently-reading">Currently Reading</option>
                    <option value="finished">Finished</option>
                  </select>
                </label>

                <label className="font-bold text-[#f4efe6]">
                  Format
                  <select
                    value={format}
                    onChange={(event) => setFormat(event.target.value as Format)}
                    className="mt-1 w-full rounded-lg border border-[#3d2448] bg-[#120817] p-2.5 text-[#f4efe6] focus:outline-none"
                  >
                    <option value="hardcover">Hardcover</option>
                    <option value="paperback">Paperback</option>
                    <option value="ebook">Ebook</option>
                    <option value="audiobook">Audiobook</option>
                  </select>
                </label>
              </div>

              <button
                type="button"
                onClick={handleManualAdd}
                disabled={!title.trim() || !author.trim() || isAtLimit}
                className="min-h-11 w-full rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-xs font-bold text-[#120817] shadow hover:opacity-95 disabled:opacity-50"
              >
                Add Single Title
              </button>
            </div>
          )}

          {activeTab === 'multi' && (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-[#c5a059]/30 bg-[#c5a059]/15 p-3">
                <span className="mb-1 block font-bold text-[#e5c158]">Multiple-Book Add Flow (Premium)</span>
                <p className="text-stone-300">
                  Paste multiple ISBNs or Title, Author pairs, one per line.
                </p>
              </div>

              <label className="block font-bold text-[#f4efe6]">
                Paste ISBNs or Titles
                <textarea
                  rows={5}
                  placeholder={'9780143127741\n9780345806789, E.L. James\nThe Hobbit, J.R.R. Tolkien'}
                  value={isbnListText}
                  onChange={(event) => setIsbnListText(event.target.value)}
                  className="mt-1 w-full resize-y rounded-lg border border-[#3d2448] bg-[#120817] p-2.5 font-mono text-[11px] text-[#f4efe6] focus:border-[#c5a059] focus:outline-none"
                />
              </label>

              <div className="space-y-2 border-t border-[#3d2448] pt-3">
                <span className="block font-bold text-[#f4efe6]">Shared defaults</span>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="text-[10px] text-stone-400">
                    Status
                    <select
                      value={bulkStatus}
                      onChange={(event) => setBulkStatus(event.target.value as ReadingStatus)}
                      className="mt-1 w-full rounded border border-[#3d2448] bg-[#120817] p-2.5 text-xs text-[#f4efe6]"
                    >
                      <option value="tbr">TBR</option>
                      <option value="currently-reading">Reading</option>
                      <option value="finished">Finished</option>
                    </select>
                  </label>
                  <label className="text-[10px] text-stone-400">
                    Format
                    <select
                      value={bulkFormat}
                      onChange={(event) => setBulkFormat(event.target.value as Format)}
                      className="mt-1 w-full rounded border border-[#3d2448] bg-[#120817] p-2.5 text-xs text-[#f4efe6]"
                    >
                      <option value="paperback">Paperback</option>
                      <option value="hardcover">Hardcover</option>
                      <option value="ebook">Ebook</option>
                      <option value="audiobook">Audiobook</option>
                    </select>
                  </label>
                  <label className="text-[10px] text-stone-400">
                    Ownership
                    <select
                      value={bulkOwnership}
                      onChange={(event) => setBulkOwnership(event.target.value as OwnershipStatus)}
                      className="mt-1 w-full rounded border border-[#3d2448] bg-[#120817] p-2.5 text-xs text-[#f4efe6]"
                    >
                      <option value="owned">Owned</option>
                      <option value="borrowed-library">Library</option>
                      <option value="subscription">Subscription</option>
                    </select>
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={handleBatchAddMultiple}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-xs font-bold text-[#120817] shadow transition hover:opacity-95"
              >
                <Sparkles className="h-4 w-4" />
                Add Multiple Books
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
