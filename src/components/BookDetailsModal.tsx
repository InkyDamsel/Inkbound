import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  Headphones,
  Layers,
  Play,
  Plus,
  Quote,
  Save,
  Star,
  X,
} from 'lucide-react';
import {
  Edition,
  FavoriteQuote,
  Format,
  OwnershipStatus,
  ReadingStatus,
  UserBookRecord,
} from '../types';
import { BookCover } from './BookCover';

interface BookDetailsModalProps {
  book: UserBookRecord | null;
  onClose: () => void;
  onUpdateBook: (updatedBook: UserBookRecord) => void;
  onStartSession: (book: UserBookRecord) => void;
}

type DetailsTab = 'summary' | 'reading' | 'thoughts' | 'editions';

export const BookDetailsModal: React.FC<BookDetailsModalProps> = ({
  book,
  onClose,
  onUpdateBook,
  onStartSession,
}) => {
  const [activeTab, setActiveTab] = useState<DetailsTab>('summary');
  const [summary, setSummary] = useState(book?.work.personalSummary ?? book?.work.summary ?? '');
  const [whyAdded, setWhyAdded] = useState(book?.whyIAddedThis ?? '');
  const [notes, setNotes] = useState(book?.personalNotes ?? '');
  const [review, setReview] = useState(book?.review ?? '');
  const [quoteText, setQuoteText] = useState('');
  const [quoteLocation, setQuoteLocation] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newEditionFormat, setNewEditionFormat] = useState<Format>('audiobook');
  const [newEditionNarrator, setNewEditionNarrator] = useState('');

  useEffect(() => {
    setActiveTab('summary');
    setSummary(book?.work.personalSummary ?? book?.work.summary ?? '');
    setWhyAdded(book?.whyIAddedThis ?? '');
    setNotes(book?.personalNotes ?? '');
    setReview(book?.review ?? '');
    setQuoteText('');
    setQuoteLocation('');
    setNewTag('');
  }, [book?.id]);

  const activeEdition = useMemo(
    () =>
      book?.editions.find((edition) => edition.id === book.activeEditionId) ??
      book?.editions[0],
    [book],
  );

  if (!book) return null;

  const updateBook = (changes: Partial<UserBookRecord>) => {
    onUpdateBook({ ...book, ...changes });
  };

  const updateStatus = (status: ReadingStatus) => {
    updateBook({
      status,
      progressPercentage: status === 'finished' ? 100 : book.progressPercentage,
      dateFinished:
        status === 'finished'
          ? book.dateFinished ?? new Date().toISOString().split('T')[0]
          : book.dateFinished,
    });
  };

  const saveSummary = () => {
    onUpdateBook({
      ...book,
      whyIAddedThis: whyAdded.trim() || undefined,
      work: {
        ...book.work,
        personalSummary: summary.trim() || undefined,
        summary: summary.trim() || book.work.publisherSummary || book.work.summary,
      },
    });
  };

  const saveThoughts = () => {
    updateBook({
      personalNotes: notes.trim() || undefined,
      review: review.trim() || undefined,
    });
  };

  const addQuote = () => {
    if (!quoteText.trim()) return;
    const quote: FavoriteQuote = {
      id: `quote-${Date.now()}`,
      quote: quoteText.trim(),
      pageOrChapter: quoteLocation.trim() || undefined,
    };
    updateBook({ favoriteQuotes: [...(book.favoriteQuotes ?? []), quote] });
    setQuoteText('');
    setQuoteLocation('');
  };

  const addTag = () => {
    const normalizedTag = newTag.trim().toLowerCase();
    if (!normalizedTag || book.privateTags.includes(normalizedTag)) return;
    updateBook({ privateTags: [...book.privateTags, normalizedTag] });
    setNewTag('');
  };

  const addEdition = () => {
    const edition: Edition = {
      id: `edition-${Date.now()}`,
      format: newEditionFormat,
      narrator:
        newEditionFormat === 'audiobook' ? newEditionNarrator.trim() || undefined : undefined,
      audiobookDurationMins: newEditionFormat === 'audiobook' ? 600 : undefined,
      pageCount: newEditionFormat === 'audiobook' ? undefined : 350,
      coverGradient:
        newEditionFormat === 'audiobook'
          ? 'from-[#361539] to-purple-950'
          : 'from-stone-900 to-amber-950',
    };
    onUpdateBook({
      ...book,
      activeEditionId: edition.id,
      editions: [...book.editions, edition],
    });
    setNewEditionNarrator('');
  };

  const removeQuote = (quoteId: string) => {
    updateBook({
      favoriteQuotes: (book.favoriteQuotes ?? []).filter((quote) => quote.id !== quoteId),
    });
  };

  const tabs: Array<{ id: DetailsTab; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'reading', label: 'Reading' },
    { id: 'thoughts', label: 'Notes & Quotes' },
    { id: 'editions', label: `Editions (${book.editions.length})` },
  ];

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="flex max-h-[96dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] shadow-2xl sm:max-h-[92vh] sm:max-w-3xl sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Book details for ${book.work.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="relative border-b border-[#3d2448] bg-gradient-to-r from-[#281333] via-[#1d0e26] to-[#140a1a] p-4 sm:p-6">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-black/30 text-stone-300 transition hover:bg-black/50 hover:text-white"
            aria-label="Close book details"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex items-start gap-3 pr-10 sm:gap-5">
            <div className="shrink-0 scale-75 origin-top-left sm:scale-100">
              <BookCover work={book.work} edition={activeEdition} size="lg" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="inline-flex rounded bg-[#c5a059] px-2 py-0.5 text-[10px] font-bold uppercase text-[#120817]">
                {activeEdition?.format ?? 'book'}
              </span>
              <h2 className="mt-2 line-clamp-2 font-serif text-xl font-bold leading-tight text-[#f4efe6] sm:text-3xl">
                {book.work.title}
              </h2>
              <p className="mt-1 truncate font-serif text-sm italic text-stone-400">
                by {book.work.author}
              </p>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <select
                  value={book.status}
                  onChange={(event) => updateStatus(event.target.value as ReadingStatus)}
                  className="min-h-10 rounded-lg border border-[#c5a059]/30 bg-[#120817] px-3 text-xs text-[#e5c158]"
                  aria-label="Reading status"
                >
                  <option value="currently-reading">Currently Reading</option>
                  <option value="tbr">TBR</option>
                  <option value="finished">Finished</option>
                  <option value="paused">Paused</option>
                  <option value="dnf">Did Not Finish</option>
                </select>

                <select
                  value={book.ownership}
                  onChange={(event) =>
                    updateBook({ ownership: event.target.value as OwnershipStatus })
                  }
                  className="min-h-10 rounded-lg border border-[#3d2448] bg-[#120817] px-3 text-xs text-stone-300"
                  aria-label="Ownership status"
                >
                  <option value="owned">Owned</option>
                  <option value="borrowed-library">Library</option>
                  <option value="borrowed-person">Borrowed</option>
                  <option value="subscription">Subscription</option>
                  <option value="wishlist">Wishlist</option>
                </select>
              </div>
            </div>
          </div>
        </header>

        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#3d2448] bg-[#120817] px-3 py-2 text-xs font-semibold">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-10 whitespace-nowrap rounded-lg px-3 transition ${
                activeTab === tab.id
                  ? 'bg-[#c5a059] font-bold text-[#120817]'
                  : 'text-stone-400 hover:bg-[#25132f] hover:text-stone-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6">
          {activeTab === 'summary' && (
            <div className="space-y-5">
              <section className="space-y-2 rounded-2xl border border-[#3d2448] bg-[#25132f] p-4">
                <label className="text-xs font-bold uppercase tracking-wider text-[#e5c158]">
                  Why I Added This
                </label>
                <input
                  value={whyAdded}
                  onChange={(event) => setWhyAdded(event.target.value)}
                  placeholder="Recommended by a friend, beautiful cover, book club pick..."
                  className="min-h-11 w-full rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-sm text-[#f4efe6] outline-none focus:border-[#c5a059]"
                />
              </section>

              <section className="space-y-2">
                <label className="font-serif text-lg font-bold text-[#f4efe6]">My Summary</label>
                <textarea
                  rows={7}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="Write a personal summary or keep the catalog summary..."
                  className="w-full rounded-2xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6] outline-none focus:border-[#c5a059]"
                />
              </section>

              <button type="button" onClick={saveSummary} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#c5a059] px-5 text-xs font-bold text-[#120817] sm:w-auto">
                <Save className="h-4 w-4" /> Save Summary
              </button>
            </div>
          )}

          {activeTab === 'reading' && (
            <div className="space-y-5">
              <section className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Reading Progress</p>
                    <p className="mt-1 font-serif text-3xl font-bold text-[#f4efe6]">{book.progressPercentage}%</p>
                  </div>
                  <BookOpen className="h-8 w-8 text-[#c5a059]" />
                </div>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[#120817]">
                  <div className="h-full rounded-full bg-[#c5a059]" style={{ width: `${book.progressPercentage}%` }} />
                </div>
              </section>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-[#f4efe6]">
                  <span className="mb-1 block">Pages Read</span>
                  <input
                    type="number"
                    value={book.progressPages}
                    onChange={(event) => updateBook({ progressPages: Number(event.target.value) || 0 })}
                    className="min-h-11 w-full rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-stone-200"
                  />
                </label>
                <label className="text-xs font-bold text-[#f4efe6]">
                  <span className="mb-1 block">Minutes Listened</span>
                  <input
                    type="number"
                    value={book.progressMinutes}
                    onChange={(event) => updateBook({ progressMinutes: Number(event.target.value) || 0 })}
                    className="min-h-11 w-full rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-stone-200"
                  />
                </label>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold text-[#f4efe6]">Rating</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      onClick={() => updateBook({ rating })}
                      className="grid h-11 w-11 place-items-center rounded-xl border border-[#3d2448] bg-[#120817]"
                      aria-label={`Rate ${rating} stars`}
                    >
                      <Star className={`h-5 w-5 ${(book.rating ?? 0) >= rating ? 'fill-[#e5c158] text-[#e5c158]' : 'text-stone-600'}`} />
                    </button>
                  ))}
                </div>
              </div>

              <button type="button" onClick={() => onStartSession(book)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#c5a059] px-5 text-sm font-bold text-[#120817] sm:w-auto">
                <Play className="h-4 w-4 fill-current" /> Start Reading Session
              </button>
            </div>
          )}

          {activeTab === 'thoughts' && (
            <div className="space-y-6">
              <section className="space-y-3">
                <label className="font-serif text-lg font-bold text-[#f4efe6]">Review</label>
                <textarea rows={4} value={review} onChange={(event) => setReview(event.target.value)} className="w-full rounded-2xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6] outline-none focus:border-[#c5a059]" />
                <label className="font-serif text-lg font-bold text-[#f4efe6]">Private Notes</label>
                <textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} className="w-full rounded-2xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6] outline-none focus:border-[#c5a059]" />
                <button type="button" onClick={saveThoughts} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#c5a059] px-5 text-xs font-bold text-[#120817] sm:w-auto">
                  <Check className="h-4 w-4" /> Save Thoughts
                </button>
              </section>

              <section className="space-y-3 border-t border-[#3d2448] pt-5">
                <h3 className="flex items-center gap-2 font-serif text-lg font-bold text-[#f4efe6]"><Quote className="h-4 w-4 text-[#c5a059]" /> Favorite Quotes</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px_auto]">
                  <input value={quoteText} onChange={(event) => setQuoteText(event.target.value)} placeholder="Quote text" className="min-h-11 rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-sm text-stone-200" />
                  <input value={quoteLocation} onChange={(event) => setQuoteLocation(event.target.value)} placeholder="Page or chapter" className="min-h-11 rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-sm text-stone-200" />
                  <button type="button" onClick={addQuote} className="min-h-11 rounded-xl bg-[#25132f] px-4 text-xs font-bold text-[#e5c158]"><Plus className="mx-auto h-4 w-4" /></button>
                </div>
                <div className="space-y-2">
                  {(book.favoriteQuotes ?? []).map((quote) => (
                    <blockquote key={quote.id} className="flex items-start justify-between gap-3 rounded-xl border border-[#3d2448] bg-[#25132f] p-3 text-sm text-stone-300">
                      <div><p className="font-serif italic">“{quote.quote}”</p>{quote.pageOrChapter && <small className="mt-1 block text-stone-500">{quote.pageOrChapter}</small>}</div>
                      <button type="button" onClick={() => removeQuote(quote.id)} className="text-stone-500 hover:text-rose-300" aria-label="Remove quote"><X className="h-4 w-4" /></button>
                    </blockquote>
                  ))}
                </div>
              </section>

              <section className="space-y-3 border-t border-[#3d2448] pt-5">
                <h3 className="font-serif text-lg font-bold text-[#f4efe6]">Private Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {book.privateTags.map((tag) => <span key={tag} className="rounded-full border border-[#c5a059]/30 bg-[#c5a059]/10 px-3 py-1 text-xs text-[#e5c158]">{tag}</span>)}
                </div>
                <div className="flex gap-2">
                  <input value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="Add tag" className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-sm text-stone-200" />
                  <button type="button" onClick={addTag} className="min-h-11 rounded-xl bg-[#25132f] px-4 text-xs font-bold text-[#e5c158]">Add</button>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'editions' && (
            <div className="space-y-5">
              <div className="space-y-3">
                {book.editions.map((edition) => (
                  <button
                    key={edition.id}
                    type="button"
                    onClick={() => updateBook({ activeEditionId: edition.id })}
                    className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border p-4 text-left ${
                      edition.id === book.activeEditionId
                        ? 'border-[#c5a059] bg-[#c5a059]/10'
                        : 'border-[#3d2448] bg-[#25132f]'
                    }`}
                  >
                    {edition.format === 'audiobook' ? <Headphones className="h-5 w-5 text-[#c5a059]" /> : <Layers className="h-5 w-5 text-[#c5a059]" />}
                    <span className="flex-1"><strong className="block capitalize text-[#f4efe6]">{edition.format}</strong><small className="text-stone-400">{edition.narrator || edition.isbn || 'Inkbound edition'}</small></span>
                    {edition.id === book.activeEditionId && <Check className="h-5 w-5 text-[#e5c158]" />}
                  </button>
                ))}
              </div>

              <section className="space-y-3 rounded-2xl border border-[#3d2448] bg-[#25132f] p-4">
                <h3 className="font-serif text-lg font-bold text-[#f4efe6]">Add Another Edition</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <select value={newEditionFormat} onChange={(event) => setNewEditionFormat(event.target.value as Format)} className="min-h-11 rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-sm text-stone-200">
                    <option value="hardcover">Hardcover</option>
                    <option value="paperback">Paperback</option>
                    <option value="ebook">Ebook</option>
                    <option value="audiobook">Audiobook</option>
                  </select>
                  {newEditionFormat === 'audiobook' && <input value={newEditionNarrator} onChange={(event) => setNewEditionNarrator(event.target.value)} placeholder="Narrator" className="min-h-11 rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-sm text-stone-200" />}
                </div>
                <button type="button" onClick={addEdition} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#c5a059] px-5 text-xs font-bold text-[#120817] sm:w-auto"><Plus className="h-4 w-4" /> Add Edition</button>
              </section>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
