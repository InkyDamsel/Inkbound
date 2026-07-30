import React, { useState, useMemo } from 'react';
import { UserBookRecord, Priority } from '../types';
import { BookCover } from './BookCover';
import {
  Sparkles,
  Bookmark,
  Shuffle,
  Filter,
  Layers,
  List,
  LayoutGrid,
  Check,
  X,
  Play,
  ArrowRight,
  Star
} from 'lucide-react';

interface TBRScreenProps {
  books: UserBookRecord[];
  onSelectBook: (book: UserBookRecord) => void;
  onUpdateStatus: (bookId: string, status: any) => void;
  onUpdatePriority: (bookId: string, priority: Priority) => void;
}

export const TBRScreen: React.FC<TBRScreenProps> = ({
  books,
  onSelectBook,
  onUpdateStatus,
  onUpdatePriority,
}) => {
  const [tbrView, setTbrView] = useState<'grid' | 'queue' | 'series' | 'genre'>('grid');
  
  // Random Picker Modal State
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerMood, setPickerMood] = useState<string>('all');
  const [pickerGenre, setPickerGenre] = useState<string>('all');
  const [pickerFormat, setPickerFormat] = useState<string>('all');
  const [pickerLength, setPickerLength] = useState<string>('all');
  const [pickerOwnedOnly, setPickerOwnedOnly] = useState(false);
  
  const [recommendedBook, setRecommendedBook] = useState<UserBookRecord | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);

  // Filter only TBR books
  const tbrBooks = useMemo(() => books.filter((b) => b.status === 'tbr'), [books]);

  // Priority queue sort
  const priorityBooks = useMemo(() => {
    const order: Record<Priority, number> = { top: 1, high: 2, medium: 3, low: 4 };
    return [...tbrBooks].sort((a, b) => order[a.priority] - order[b.priority]);
  }, [tbrBooks]);

  // Series Grouping
  const seriesGroups = useMemo(() => {
    const groups: Record<string, UserBookRecord[]> = {};
    tbrBooks.forEach((b) => {
      const name = b.work.seriesName || 'Standalone Titles';
      if (!groups[name]) groups[name] = [];
      groups[name].push(b);
    });
    return groups;
  }, [tbrBooks]);

  // Genre Grouping
  const genreGroups = useMemo(() => {
    const groups: Record<string, UserBookRecord[]> = {};
    tbrBooks.forEach((b) => {
      const g = b.work.genres[0] || 'General Fiction';
      if (!groups[g]) groups[g] = [];
      groups[g].push(b);
    });
    return groups;
  }, [tbrBooks]);

  // Random Picker Handler
  const handleChooseNextRead = () => {
    setIsSpinning(true);
    setRecommendedBook(null);

    // Candidates matching picker filters
    const candidates = tbrBooks.filter((b) => {
      if (pickerMood !== 'all' && !b.moods.includes(pickerMood)) return false;
      if (pickerGenre !== 'all' && !b.work.genres.includes(pickerGenre)) return false;
      if (pickerFormat !== 'all' && !b.editions.some((e) => e.format === pickerFormat)) return false;
      if (pickerOwnedOnly && b.ownership !== 'owned') return false;

      const pageCount = b.editions[0]?.pageCount || 350;
      if (pickerLength === 'short' && pageCount > 300) return false;
      if (pickerLength === 'medium' && (pageCount < 300 || pageCount > 500)) return false;
      if (pickerLength === 'long' && pageCount < 500) return false;

      return true;
    });

    setTimeout(() => {
      setIsSpinning(false);
      if (candidates.length > 0) {
        const randomChoice = candidates[Math.floor(Math.random() * candidates.length)];
        setRecommendedBook(randomChoice);
      } else {
        setRecommendedBook(null);
      }
    }, 600);
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header Banner & Pick Button */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[#281333] via-[#1d0e26] to-[#140a1a] text-[#f4efe6] p-6 rounded-2xl shadow-2xl border border-[#c5a059]/30">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 text-xs text-[#e5c158] font-bold uppercase tracking-wider bg-[#c5a059]/15 px-3 py-1 rounded-full border border-[#c5a059]/30">
            <Bookmark className="w-4 h-4 text-[#e5c158]" />
            <span>To Be Read Stack</span>
          </div>
          <h1 className="text-3xl font-serif font-bold text-[#f4efe6]">Your Reading Queue</h1>
          <p className="text-xs text-stone-300">
            {tbrBooks.length} titles waiting for your next literary escape.
          </p>
        </div>

        {/* Big "Choose My Next Read" Button */}
        <button
          onClick={() => {
            setIsPickerOpen(true);
            setRecommendedBook(null);
          }}
          className="flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] hover:from-[#d4af37] hover:to-[#e5c158] text-[#120817] font-bold text-sm shadow-xl shadow-[#c5a059]/15 transition transform hover:scale-[1.02] shrink-0"
        >
          <Sparkles className="w-5 h-5 fill-current" />
          <span>Choose My Next Read</span>
        </button>
      </div>

      {/* Sub Views Navigation */}
      <div className="flex items-center justify-between border-b border-[#36213d] pb-2">
        <div className="flex items-center gap-2 overflow-x-auto">
          {[
            { id: 'grid', label: 'Cover Grid', icon: LayoutGrid },
            { id: 'queue', label: 'Priority Queue', icon: List },
            { id: 'series', label: 'Series Collections', icon: Layers },
            { id: 'genre', label: 'Genre Shelves', icon: Filter },
          ].map((v) => {
            const Icon = v.icon;
            const isActive = tbrView === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setTbrView(v.id as any)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                  isActive
                    ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold shadow-md'
                    : 'text-stone-300 hover:bg-[#25132f] border border-transparent hover:border-[#c5a059]/20'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{v.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* View 1: Cover Grid */}
      {tbrView === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
          {tbrBooks.map((book) => (
            <div
              key={book.id}
              onClick={() => onSelectBook(book)}
              className="book-card-glow group flex flex-col items-center p-2.5 rounded-xl bg-[#1c0f24] cursor-pointer transition"
            >
              <BookCover work={book.work} edition={book.editions[0]} size="md" />
              <div className="mt-2 text-center w-full px-1">
                <span className="text-[9px] uppercase font-bold text-amber-300 bg-amber-950/80 border border-amber-500/30 px-1.5 py-0.5 rounded">
                  {book.priority} Priority
                </span>
                <h4 className="font-serif font-bold text-xs text-[#f4efe6] line-clamp-1 mt-1 group-hover:text-[#c5a059]">
                  {book.title || book.work.title}
                </h4>
                <p className="text-[11px] text-stone-400 truncate">{book.work.author}</p>
                {book.whyIAddedThis && (
                  <p className="text-[10px] text-[#e5c158] italic line-clamp-1 mt-0.5 font-serif">
                    Why: &quot;{book.whyIAddedThis}&quot;
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View 2: Priority Queue */}
      {tbrView === 'queue' && (
        <div className="space-y-4">
          {(['top', 'high', 'medium', 'low'] as Priority[]).map((p) => {
            const list = priorityBooks.filter((b) => b.priority === p);
            if (list.length === 0) return null;

            return (
              <div key={p} className="bg-[#1c0f24] border border-[#c5a059]/20 rounded-xl p-5 shadow-xl space-y-3">
                <div className="flex items-center justify-between border-b border-[#3d2448] pb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#e5c158] bg-[#c5a059]/15 border border-[#c5a059]/30 px-2.5 py-1 rounded-md">
                    {p} Priority Queue ({list.length})
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {list.map((book) => (
                    <div
                      key={book.id}
                      onClick={() => onSelectBook(book)}
                      className="p-3 bg-[#25132f] rounded-lg flex items-center justify-between hover:bg-[#321a3e] cursor-pointer transition border border-[#3d2448]"
                    >
                      <div className="flex items-center gap-3">
                        <BookCover work={book.work} edition={book.editions[0]} size="sm" />
                        <div>
                          <h4 className="font-serif font-bold text-sm text-[#f4efe6]">
                            {book.work.title}
                          </h4>
                          <p className="text-xs text-stone-400">{book.work.author}</p>
                          {book.whyIAddedThis && (
                            <p className="text-[11px] text-[#e5c158] italic line-clamp-1 mt-0.5 font-serif">
                              Why: &quot;{book.whyIAddedThis}&quot;
                            </p>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateStatus(book.id, 'currently-reading');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] text-xs font-bold hover:opacity-90"
                      >
                        Start
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* View 3: Series Collections */}
      {tbrView === 'series' && (
        <div className="space-y-6">
          {(Object.entries(seriesGroups) as [string, UserBookRecord[]][]).map(([seriesName, groupBooks]) => (
            <div key={seriesName} className="bg-[#1c0f24] border border-[#c5a059]/20 rounded-xl p-5 space-y-3">
              <h3 className="font-serif font-bold text-lg text-[#f4efe6]">
                {seriesName}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {groupBooks.map((book) => (
                  <div key={book.id} onClick={() => onSelectBook(book)} className="cursor-pointer">
                    <BookCover work={book.work} edition={book.editions[0]} size="md" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View 4: Genre Shelves */}
      {tbrView === 'genre' && (
        <div className="space-y-6">
          {(Object.entries(genreGroups) as [string, UserBookRecord[]][]).map(([genre, groupBooks]) => (
            <div key={genre} className="bg-[#1c0f24] border border-[#c5a059]/20 rounded-xl p-5 space-y-3">
              <h3 className="font-serif font-bold text-lg text-[#f4efe6]">
                {genre} ({groupBooks.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                {groupBooks.map((book) => (
                  <div key={book.id} onClick={() => onSelectBook(book)} className="cursor-pointer">
                    <BookCover work={book.work} edition={book.editions[0]} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* "Choose My Next Read" Recommendation Modal */}
      {isPickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1c0f24] border border-[#c5a059]/40 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 relative animate-in fade-in zoom-in-95 duration-200">
            
            <button
              onClick={() => setIsPickerOpen(false)}
              className="absolute top-4 right-4 text-stone-400 hover:text-[#f4efe6]"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center space-y-1">
              <Sparkles className="w-8 h-8 text-[#e5c158] mx-auto" />
              <h3 className="font-serif font-bold text-2xl text-[#f4efe6]">
                Choose My Next Read
              </h3>
              <p className="text-xs text-stone-400">
                Filter by your current mood and let Reading App pick the perfect book.
              </p>
            </div>

            {/* Filters */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-[#f4efe6] block mb-1">
                  Mood
                </label>
                <select
                  value={pickerMood}
                  onChange={(e) => setPickerMood(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                >
                  <option value="all">Any Mood</option>
                  <option value="Cozy">Cozy</option>
                  <option value="Dark">Dark & Atmospheric</option>
                  <option value="Fast-paced">Fast-paced</option>
                  <option value="Mind-bending">Mind-bending</option>
                  <option value="Emotional">Emotional</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-[#f4efe6] block mb-1">
                    Format
                  </label>
                  <select
                    value={pickerFormat}
                    onChange={(e) => setPickerFormat(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-xs bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                  >
                    <option value="all">Any Format</option>
                    <option value="hardcover">Hardcover</option>
                    <option value="paperback">Paperback</option>
                    <option value="ebook">Ebook</option>
                    <option value="audiobook">Audiobook</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-[#f4efe6] block mb-1">
                    Length
                  </label>
                  <select
                    value={pickerLength}
                    onChange={(e) => setPickerLength(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-xs bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                  >
                    <option value="all">Any Length</option>
                    <option value="short">Short (&lt;300 pgs)</option>
                    <option value="medium">Medium (300-500 pgs)</option>
                    <option value="long">Long (&gt;500 pgs)</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-stone-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={pickerOwnedOnly}
                  onChange={(e) => setPickerOwnedOnly(e.target.checked)}
                  className="rounded text-[#c5a059] focus:ring-[#c5a059]"
                />
                <span>Only recommend books I currently own</span>
              </label>
            </div>

            {/* Recommendation Result Display */}
            {isSpinning ? (
              <div className="py-8 text-center space-y-2">
                <Shuffle className="w-8 h-8 text-[#e5c158] animate-spin mx-auto" />
                <p className="text-xs font-serif italic text-stone-400">Consulting your TBR stacks...</p>
              </div>
            ) : recommendedBook ? (
              <div className="p-4 bg-[#25132f] rounded-xl border border-[#c5a059]/40 space-y-3">
                <div className="flex gap-4 items-center">
                  <BookCover work={recommendedBook.work} edition={recommendedBook.editions[0]} size="md" />
                  <div className="space-y-1 min-w-0">
                    <span className="text-[9px] uppercase font-bold text-amber-300 bg-amber-950/80 border border-amber-500/30 px-2 py-0.5 rounded">
                      Match Recommendation
                    </span>
                    <h4 className="font-serif font-bold text-base text-[#f4efe6] leading-tight">
                      {recommendedBook.work.title}
                    </h4>
                    <p className="text-xs text-stone-400">{recommendedBook.work.author}</p>
                    <p className="text-xs text-stone-300 line-clamp-2 italic font-serif mt-1">
                      &quot;{recommendedBook.work.summary}&quot;
                    </p>
                  </div>
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    onClick={() => {
                      onUpdateStatus(recommendedBook.id, 'currently-reading');
                      setIsPickerOpen(false);
                    }}
                    className="flex-1 py-2 rounded-lg bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] text-xs font-bold hover:opacity-90"
                  >
                    Start Reading Now
                  </button>
                  <button
                    onClick={() => onSelectBook(recommendedBook)}
                    className="py-2 px-3 rounded-lg border border-[#3d2448] text-xs font-semibold text-[#f4efe6] hover:border-[#c5a059]/40"
                  >
                    View Details
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleChooseNextRead}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
              >
                <Shuffle className="w-4 h-4" />
                <span>Spin Recommendation Engine</span>
              </button>
            )}

          </div>
        </div>
      )}
    </div>
  );
};
