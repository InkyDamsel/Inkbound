import React, { useState } from 'react';
import { UserBookRecord, ReadingStatus, OwnershipStatus, Format, FavoriteQuote, Edition } from '../types';
import { BookCover } from './BookCover';
import {
  X,
  Star,
  BookOpen,
  Headphones,
  Tablet,
  Clock,
  Quote,
  Edit3,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  Check,
  Calendar,
  Layers,
  Sparkles,
  Tag
} from 'lucide-react';

interface BookDetailsModalProps {
  book: UserBookRecord | null;
  onClose: () => void;
  onUpdateBook: (updatedBook: UserBookRecord) => void;
  onStartSession: (book: UserBookRecord) => void;
}

export const BookDetailsModal: React.FC<BookDetailsModalProps> = ({
  book,
  onClose,
  onUpdateBook,
  onStartSession,
}) => {
  if (!book) return null;

  const [activeTab, setActiveTab] = useState<'summary' | 'reading' | 'thoughts' | 'info' | 'editions'>('summary');

  // Inline Editing States
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [personalSummaryText, setPersonalSummaryText] = useState(book.work.personalSummary || '');
  const [publisherSummaryText, setPublisherSummaryText] = useState(book.work.publisherSummary || book.work.summary);
  const [showSpoilers, setShowSpoilers] = useState(false);

  // Why I Added This state
  const [whyIAddedThisText, setWhyIAddedThisText] = useState(book.whyIAddedThis || '');
  const [isEditingWhy, setIsEditingWhy] = useState(false);

  const handleSaveWhy = (overrideVal?: string) => {
    const textToSave = overrideVal !== undefined ? overrideVal : whyIAddedThisText;
    onUpdateBook({
      ...book,
      whyIAddedThis: textToSave.trim() || undefined,
    });
    setWhyIAddedThisText(textToSave.trim());
    setIsEditingWhy(false);
  };

  // Quotes state
  const [newQuoteText, setNewQuoteText] = useState('');
  const [newQuotePage, setNewQuotePage] = useState('');

  // Review & Notes state
  const [reviewText, setReviewText] = useState(book.review || '');
  const [notesText, setNotesText] = useState(book.personalNotes || '');
  const [newTagInput, setNewTagInput] = useState('');

  // Edition Add State
  const [isAddingEdition, setIsAddingEdition] = useState(false);
  const [newEditionFormat, setNewEditionFormat] = useState<Format>('audiobook');
  const [newEditionNarrator, setNewEditionNarrator] = useState('');
  const [newEditionDuration, setNewEditionDuration] = useState('600');

  const activeEdition = book.editions.find((e) => e.id === book.activeEditionId) || book.editions[0];

  // Rating change
  const handleRatingChange = (newRating: number) => {
    onUpdateBook({
      ...book,
      rating: newRating,
    });
  };

  // Status change
  const handleStatusChange = (newStatus: ReadingStatus) => {
    let dateFinished = book.dateFinished;
    if (newStatus === 'finished' && !dateFinished) {
      dateFinished = new Date().toISOString().split('T')[0];
    }
    onUpdateBook({
      ...book,
      status: newStatus,
      progressPercentage: newStatus === 'finished' ? 100 : book.progressPercentage,
      dateFinished,
    });
  };

  // Ownership change
  const handleOwnershipChange = (newOwnership: OwnershipStatus) => {
    onUpdateBook({
      ...book,
      ownership: newOwnership,
    });
  };

  // Save Summaries
  const handleSaveSummary = () => {
    onUpdateBook({
      ...book,
      work: {
        ...book.work,
        publisherSummary: publisherSummaryText,
        personalSummary: personalSummaryText,
        summary: personalSummaryText || publisherSummaryText,
      },
    });
    setIsEditingSummary(false);
  };

  // Add Quote
  const handleAddQuote = () => {
    if (!newQuoteText.trim()) return;
    const quoteObj: FavoriteQuote = {
      id: 'q-' + Date.now(),
      quote: newQuoteText,
      pageOrChapter: newQuotePage ? `Page ${newQuotePage}` : undefined,
    };
    onUpdateBook({
      ...book,
      favoriteQuotes: [...(book.favoriteQuotes || []), quoteObj],
    });
    setNewQuoteText('');
    setNewQuotePage('');
  };

  // Add Tag
  const handleAddTag = () => {
    if (!newTagInput.trim()) return;
    const tag = newTagInput.trim().toLowerCase();
    if (!book.privateTags.includes(tag)) {
      onUpdateBook({
        ...book,
        privateTags: [...book.privateTags, tag],
      });
    }
    setNewTagInput('');
  };

  // Add Edition
  const handleAddEdition = () => {
    const newEd: Edition = {
      id: 'ed-' + Date.now(),
      format: newEditionFormat,
      audiobookDurationMins: newEditionFormat === 'audiobook' ? parseInt(newEditionDuration) || 600 : undefined,
      narrator: newEditionFormat === 'audiobook' ? newEditionNarrator : undefined,
      pageCount: newEditionFormat !== 'audiobook' ? 380 : undefined,
      coverGradient: newEditionFormat === 'audiobook' ? 'from-[#361539] to-purple-950' : 'from-stone-900 to-amber-950',
    };
    onUpdateBook({
      ...book,
      editions: [...book.editions, newEd],
    });
    setIsAddingEdition(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-[#1c0f24] border border-[#c5a059]/40 rounded-2xl max-w-3xl w-full my-auto shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header Bar */}
        <div className="bg-gradient-to-r from-[#281333] via-[#1d0e26] to-[#140a1a] text-[#f4efe6] p-4 sm:p-6 flex items-start justify-between relative border-b border-[#3d2448]">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-stone-400 hover:text-white p-1 rounded-full bg-black/30 hover:bg-black/50 transition"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex gap-4 items-center">
            <BookCover work={book.work} edition={activeEdition} size="lg" />

            <div className="space-y-2 min-w-0 pr-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#120817] bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-2 py-0.5 rounded">
                  {activeEdition?.format || 'hardcover'}
                </span>
                {book.work.seriesName && (
                  <span className="text-[10px] text-amber-300 bg-amber-950/80 border border-amber-500/30 px-2 py-0.5 rounded font-bold">
                    {book.work.seriesName} #{book.work.seriesOrder}
                  </span>
                )}
              </div>

              <h2 className="font-serif font-bold text-xl sm:text-2xl text-[#f4efe6] leading-tight">
                {book.work.title}
              </h2>
              <p className="text-sm text-stone-400 italic font-serif">by {book.work.author}</p>

              {/* Status & Ownership selectors */}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <select
                  value={book.status}
                  onChange={(e) => handleStatusChange(e.target.value as ReadingStatus)}
                  className="bg-[#120817] text-amber-300 border border-amber-500/30 rounded-lg px-2.5 py-1 focus:outline-none"
                >
                  <option value="currently-reading">Currently Reading</option>
                  <option value="tbr">TBR</option>
                  <option value="finished">Finished</option>
                  <option value="paused">Paused</option>
                  <option value="dnf">Did Not Finish</option>
                </select>

                <select
                  value={book.ownership}
                  onChange={(e) => handleOwnershipChange(e.target.value as OwnershipStatus)}
                  className="bg-[#120817] text-stone-300 border border-[#3d2448] rounded-lg px-2.5 py-1 focus:outline-none"
                >
                  <option value="owned">Owned Copy</option>
                  <option value="borrowed-library">Borrowed (Library)</option>
                  <option value="borrowed-person">Borrowed (Friend)</option>
                  <option value="subscription">Subscription</option>
                  <option value="wishlist">Wishlist</option>
                </select>

                {/* 5-Star Interactive Rating */}
                <div className="flex items-center gap-1 text-[#e5c158] bg-[#120817] px-2 py-1 rounded-lg border border-[#c5a059]/30">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => handleRatingChange(star)}
                      className="hover:scale-125 transition"
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          (book.rating || 0) >= star ? 'fill-current text-[#e5c158]' : 'text-stone-600'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 bg-[#120817] border-b border-[#3d2448] px-4 py-2 overflow-x-auto text-xs font-semibold">
          {[
            { id: 'summary', label: 'Summary' },
            { id: 'reading', label: 'My Reading Log' },
            { id: 'thoughts', label: 'Notes & Quotes' },
            { id: 'info', label: 'Book Details' },
            { id: 'editions', label: `Editions (${book.editions.length})` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition ${
                activeTab === t.id
                  ? 'bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold shadow-sm'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-[#25132f]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Scrollable Modal Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs sm:text-sm">
          
          {/* TAB 1: SUMMARY */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              {/* Why I Added This Callout */}
              <div className="bg-[#25132f] p-4 rounded-xl border border-[#c5a059]/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-sans uppercase tracking-wider font-bold text-[#e5c158] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#e5c158]" />
                    Why I Added This
                  </span>
                  <button
                    onClick={() => setIsEditingWhy(!isEditingWhy)}
                    className="text-xs text-[#e5c158] font-bold hover:underline flex items-center gap-1"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{isEditingWhy ? 'Done' : 'Edit Note'}</span>
                  </button>
                </div>

                {isEditingWhy ? (
                  <div className="space-y-2 pt-1">
                    <input
                      type="text"
                      value={whyIAddedThisText}
                      onChange={(e) => setWhyIAddedThisText(e.target.value)}
                      placeholder="e.g., Recommended by Sarah; Loved the author's previous series..."
                      className="w-full p-2 text-xs rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                    />
                    <div className="flex flex-wrap items-center gap-1 text-[11px] text-stone-400">
                      <span className="font-semibold text-stone-400">Quick ideas:</span>
                      {[
                        "Recommended by Sarah",
                        "BookTok recommendation",
                        "Book club pick",
                        "Loved author's previous work",
                        "Beautiful cover",
                        "Cozy autumn read"
                      ].map((idea) => (
                        <button
                          key={idea}
                          type="button"
                          onClick={() => handleSaveWhy(idea)}
                          className="px-2 py-0.5 rounded-full bg-[#120817] border border-[#3d2448] text-stone-300 hover:border-[#c5a059] hover:text-[#e5c158] transition"
                        >
                          + {idea}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => handleSaveWhy()}
                      className="px-3 py-1 rounded bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-xs"
                    >
                      Save Reason
                    </button>
                  </div>
                ) : (
                  <p className="text-xs sm:text-sm font-serif italic text-[#f4efe6]">
                    {book.whyIAddedThis ? (
                      `"${book.whyIAddedThis}"`
                    ) : (
                      <span className="text-stone-400 not-italic">
                        No personal reason added yet. Click &quot;Edit Note&quot; to save why this book caught your attention!
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <h3 className="font-serif font-bold text-lg text-[#f4efe6]">
                  Book Summary
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowSpoilers(!showSpoilers)}
                    className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200"
                  >
                    {showSpoilers ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showSpoilers ? 'Hide Spoilers' : 'Show Spoilers'}</span>
                  </button>

                  <button
                    onClick={() => setIsEditingSummary(!isEditingSummary)}
                    className="flex items-center gap-1 text-xs text-[#e5c158] font-bold hover:underline"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{isEditingSummary ? 'Cancel' : 'Edit Summary'}</span>
                  </button>
                </div>
              </div>

              {isEditingSummary ? (
                <div className="space-y-3 bg-[#25132f] p-4 rounded-xl border border-[#3d2448]">
                  <div>
                    <label className="font-bold text-xs text-[#f4efe6] block mb-1">
                      Publisher Summary
                    </label>
                    <textarea
                      rows={4}
                      value={publisherSummaryText}
                      onChange={(e) => setPublisherSummaryText(e.target.value)}
                      className="w-full p-2 text-xs rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-xs text-[#f4efe6] block mb-1">
                      Personal Summary / Synopsis
                    </label>
                    <textarea
                      rows={3}
                      value={personalSummaryText}
                      onChange={(e) => setPersonalSummaryText(e.target.value)}
                      placeholder="Write your own custom summary or reading takeaways..."
                      className="w-full p-2 text-xs rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                    />
                  </div>

                  <button
                    onClick={handleSaveSummary}
                    className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-xs"
                  >
                    Save Changes
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Publisher Summary */}
                  <div className="bg-[#25132f] p-4 rounded-xl border border-[#3d2448] font-serif leading-relaxed text-stone-200">
                    <span className="text-[10px] font-sans uppercase tracking-wider font-bold text-[#e5c158] block mb-1">
                      Catalog Summary
                    </span>
                    <p>{publisherSummaryText}</p>
                  </div>

                  {/* Personal Summary */}
                  {personalSummaryText && (
                    <div className="bg-[#25132f] p-4 rounded-xl border border-[#c5a059]/30 font-serif leading-relaxed text-stone-200">
                      <span className="text-[10px] font-sans uppercase tracking-wider font-bold text-stone-400 block mb-1">
                        Personal Summary & Notes
                      </span>
                      <p>{personalSummaryText}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MY READING */}
          {activeTab === 'reading' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-[#25132f] border border-[#3d2448] rounded-xl text-center">
                  <p className="text-[10px] text-stone-400">Progress</p>
                  <p className="text-lg font-serif font-bold text-[#e5c158]">{book.progressPercentage}%</p>
                </div>
                <div className="p-3 bg-[#25132f] border border-[#3d2448] rounded-xl text-center">
                  <p className="text-[10px] text-stone-400">Started</p>
                  <p className="text-xs font-bold text-stone-200">{book.dateStarted || 'Not set'}</p>
                </div>
                <div className="p-3 bg-[#25132f] border border-[#3d2448] rounded-xl text-center">
                  <p className="text-[10px] text-stone-400">Finished</p>
                  <p className="text-xs font-bold text-stone-200">{book.dateFinished || 'In progress'}</p>
                </div>
                <div className="p-3 bg-[#25132f] border border-[#3d2448] rounded-xl text-center">
                  <p className="text-[10px] text-stone-400">Reading Pace</p>
                  <p className="text-xs font-bold text-emerald-400">38 pgs/hr</p>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => onStartSession(book)}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-xs hover:opacity-95 flex items-center justify-center gap-2 shadow-md"
                >
                  <Clock className="w-4 h-4 text-[#120817]" />
                  <span>Start New Reading Session</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: THOUGHTS & QUOTES */}
          {activeTab === 'thoughts' && (
            <div className="space-y-6">
              {/* Review & Notes */}
              <div className="space-y-3">
                <h3 className="font-serif font-bold text-base text-[#f4efe6]">
                  Review & Personal Notes
                </h3>
                <textarea
                  rows={3}
                  value={notesText}
                  onChange={(e) => {
                    setNotesText(e.target.value);
                    onUpdateBook({ ...book, personalNotes: e.target.value });
                  }}
                  placeholder="Record private thoughts, character observations, or review..."
                  className="w-full p-3 text-xs rounded-xl bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                />
              </div>

              {/* Private Tags */}
              <div className="space-y-2">
                <h3 className="font-serif font-bold text-sm text-[#f4efe6]">
                  Private Tags
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  {book.privateTags.map((tag) => (
                    <span key={tag} className="px-2.5 py-1 rounded-full bg-[#25132f] border border-[#3d2448] text-[11px] font-semibold text-[#e5c158] flex items-center gap-1">
                      <Tag className="w-3 h-3 text-[#e5c158]" />
                      #{tag}
                    </span>
                  ))}
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      placeholder="Add tag..."
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                      className="px-2.5 py-1 rounded-full text-xs bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                    />
                    <button onClick={handleAddTag} className="p-1 text-[#e5c158] font-bold">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Quotes */}
              <div className="space-y-3 pt-2">
                <h3 className="font-serif font-bold text-base text-[#f4efe6]">
                  Favorite Quotes ({book.favoriteQuotes.length})
                </h3>

                <div className="space-y-2">
                  {(book.favoriteQuotes || []).map((q) => (
                    <div key={q.id} className="p-3 bg-[#25132f] rounded-xl border border-[#3d2448] font-serif italic text-xs text-stone-200 relative">
                      <Quote className="w-4 h-4 text-[#e5c158] mb-1" />
                      <p>&quot;{q.quote}&quot;</p>
                      {q.pageOrChapter && (
                        <p className="text-[10px] text-stone-400 not-italic mt-1 text-right font-sans">
                          — {q.pageOrChapter}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter quote..."
                    value={newQuoteText}
                    onChange={(e) => setNewQuoteText(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                  />
                  <input
                    type="text"
                    placeholder="Page / Loc"
                    value={newQuotePage}
                    onChange={(e) => setNewQuotePage(e.target.value)}
                    className="w-24 px-2 py-1.5 rounded-lg text-xs bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                  />
                  <button
                    onClick={handleAddQuote}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-xs"
                  >
                    Add Quote
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: BOOK INFO & METADATA */}
          {activeTab === 'info' && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-[#25132f] border border-[#3d2448] rounded-xl">
                  <span className="text-stone-400 font-bold block">Genres</span>
                  <span className="font-semibold text-[#f4efe6]">
                    {book.work.genres.join(', ')}
                  </span>
                </div>
                <div className="p-3 bg-[#25132f] border border-[#3d2448] rounded-xl">
                  <span className="text-stone-400 font-bold block">Tropes</span>
                  <span className="font-semibold text-[#f4efe6]">
                    {book.work.tropes?.join(', ') || 'N/A'}
                  </span>
                </div>
                <div className="p-3 bg-[#25132f] border border-[#3d2448] rounded-xl">
                  <span className="text-stone-400 font-bold block">Publication Year</span>
                  <span className="font-semibold text-[#f4efe6]">
                    {book.work.publicationYear}
                  </span>
                </div>
                <div className="p-3 bg-[#25132f] border border-[#3d2448] rounded-xl">
                  <span className="text-stone-400 font-bold block">Import Source</span>
                  <span className="font-semibold text-[#e5c158]">
                    {book.sourceOfImport || 'Manual Entry'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: EDITIONS & FORMATS */}
          {activeTab === 'editions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-serif font-bold text-base text-[#f4efe6]">
                  Tracked Editions
                </h3>
                <button
                  onClick={() => setIsAddingEdition(!isAddingEdition)}
                  className="flex items-center gap-1 text-xs text-[#e5c158] font-bold hover:underline"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Format / Edition</span>
                </button>
              </div>

              {isAddingEdition && (
                <div className="p-4 bg-[#25132f] rounded-xl border border-[#c5a059] space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-xs text-[#f4efe6] block mb-1">Format</label>
                      <select
                        value={newEditionFormat}
                        onChange={(e) => setNewEditionFormat(e.target.value as Format)}
                        className="w-full p-2 text-xs rounded-lg bg-[#120817] text-[#f4efe6] border border-[#3d2448]"
                      >
                        <option value="hardcover">Hardcover</option>
                        <option value="paperback">Paperback</option>
                        <option value="ebook">Kindle / Ebook</option>
                        <option value="audiobook">Audiobook</option>
                      </select>
                    </div>

                    {newEditionFormat === 'audiobook' && (
                      <div>
                        <label className="font-bold text-xs text-[#f4efe6] block mb-1">Narrator</label>
                        <input
                          type="text"
                          placeholder="Narrator name"
                          value={newEditionNarrator}
                          onChange={(e) => setNewEditionNarrator(e.target.value)}
                          className="w-full p-2 text-xs rounded-lg bg-[#120817] text-[#f4efe6] border border-[#3d2448]"
                        />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleAddEdition}
                    className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-xs"
                  >
                    Save Edition
                  </button>
                </div>
              )}

              <div className="space-y-2">
                {book.editions.map((ed) => {
                  const isActive = ed.id === book.activeEditionId;
                  return (
                    <div
                      key={ed.id}
                      className={`p-3 rounded-xl border flex items-center justify-between transition ${
                        isActive
                          ? 'bg-[#c5a059]/20 border-[#c5a059]'
                          : 'bg-[#25132f] border-[#3d2448]'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <span className="text-[10px] uppercase font-bold text-[#e5c158] bg-[#c5a059]/15 px-2 py-0.5 rounded border border-[#c5a059]/30">
                          {ed.format}
                        </span>
                        {ed.narrator && <p className="text-xs text-stone-400">Narrated by {ed.narrator}</p>}
                        {ed.pageCount && <p className="text-xs text-stone-400">{ed.pageCount} pages</p>}
                      </div>

                      {isActive ? (
                        <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                          <Check className="w-4 h-4" /> Active Format
                        </span>
                      ) : (
                        <button
                          onClick={() => onUpdateBook({ ...book, activeEditionId: ed.id })}
                          className="px-3 py-1 rounded-lg bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] text-xs font-bold hover:opacity-90"
                        >
                          Switch to Active
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
