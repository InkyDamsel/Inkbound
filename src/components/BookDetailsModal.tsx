import React, { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  ImagePlus,
  Loader2,
  Play,
  Plus,
  Quote,
  Save,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { searchGoogleBooks } from '../features/book-search/data/googleBooksApi';
import type { BookSearchEdition, BookSearchWorkGroup } from '../features/book-search/model/bookSearch';
import type {
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
type CoverMode = 'choices' | 'search' | 'upload';

const MAX_COVER_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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
  const [newEditionFormat, setNewEditionFormat] = useState<Format>('paperback');
  const [coverManagerOpen, setCoverManagerOpen] = useState(false);
  const [coverMode, setCoverMode] = useState<CoverMode>('choices');
  const [coverQuery, setCoverQuery] = useState('');
  const [coverResults, setCoverResults] = useState<BookSearchWorkGroup[]>([]);
  const [coverSearching, setCoverSearching] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab('summary');
    setSummary(book?.work.personalSummary ?? book?.work.summary ?? '');
    setWhyAdded(book?.whyIAddedThis ?? '');
    setNotes(book?.personalNotes ?? '');
    setReview(book?.review ?? '');
    setQuoteText('');
    setQuoteLocation('');
    setCoverManagerOpen(false);
    setCoverMode('choices');
    setCoverQuery(book ? `${book.work.title} ${book.work.author}` : '');
    setCoverResults([]);
    setCoverError(null);
  }, [book?.id]);

  const activeEdition = useMemo(
    () => book?.editions.find((edition) => edition.id === book.activeEditionId) ?? book?.editions[0],
    [book],
  );

  if (!book || !activeEdition) return null;

  const updateBook = (changes: Partial<UserBookRecord>) => {
    onUpdateBook({ ...book, ...changes });
  };

  const updateActiveEdition = (changes: Partial<Edition>) => {
    onUpdateBook({
      ...book,
      editions: book.editions.map((edition) =>
        edition.id === activeEdition.id ? { ...edition, ...changes } : edition,
      ),
    });
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
    updateBook({ personalNotes: notes.trim() || undefined, review: review.trim() || undefined });
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

  const removeQuote = (quoteId: string) => {
    updateBook({ favoriteQuotes: (book.favoriteQuotes ?? []).filter((quote) => quote.id !== quoteId) });
  };

  const addEdition = () => {
    const edition: Edition = {
      id: `edition-${Date.now()}`,
      format: newEditionFormat,
      pageCount: newEditionFormat === 'audiobook' ? undefined : 350,
      audiobookDurationMins: newEditionFormat === 'audiobook' ? 600 : undefined,
      coverGradient: 'from-[#5c3d62] via-[#35243f] to-[#171117]',
    };
    onUpdateBook({ ...book, activeEditionId: edition.id, editions: [...book.editions, edition] });
  };

  const searchCovers = async (event: FormEvent) => {
    event.preventDefault();
    if (!coverQuery.trim() || coverSearching) return;
    setCoverSearching(true);
    setCoverError(null);
    try {
      const response = await searchGoogleBooks(coverQuery.trim());
      setCoverResults(response.groups.filter((group) => group.editions.some((edition) => edition.coverUrl)));
    } catch (error) {
      setCoverResults([]);
      setCoverError(error instanceof Error ? error.message : 'Cover search failed. Please try again.');
    } finally {
      setCoverSearching(false);
    }
  };

  const chooseOnlineCover = (edition: BookSearchEdition) => {
    if (!edition.coverUrl) return;
    updateActiveEdition({ coverUrl: edition.coverUrl });
    setCoverManagerOpen(false);
  };

  const uploadCover = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ACCEPTED_COVER_TYPES.includes(file.type)) {
      setCoverError('Please choose a JPG, PNG, or WEBP image.');
      return;
    }
    if (file.size > MAX_COVER_FILE_BYTES) {
      setCoverError('Please choose an image smaller than 5 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => setCoverError('Inkbound could not read that image. Please try another file.');
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      updateActiveEdition({ coverUrl: reader.result });
      setCoverManagerOpen(false);
    };
    reader.readAsDataURL(file);
  };

  const removeCover = () => {
    updateActiveEdition({ coverUrl: undefined });
    setCoverManagerOpen(false);
  };

  const tabs: Array<{ id: DetailsTab; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'reading', label: 'Reading' },
    { id: 'thoughts', label: 'Notes & Quotes' },
    { id: 'editions', label: `Editions (${book.editions.length})` },
  ];

  return (
    <div className="fixed inset-0 z-[130] flex items-end bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <section className="flex max-h-[96dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] shadow-2xl sm:max-h-[92vh] sm:max-w-4xl sm:rounded-3xl" role="dialog" aria-modal="true" aria-label={`Book details for ${book.work.title}`} onClick={(event) => event.stopPropagation()}>
        <header className="relative border-b border-[#3d2448] bg-gradient-to-r from-[#281333] via-[#1d0e26] to-[#140a1a] p-4 sm:p-6">
          <button type="button" onClick={onClose} className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-black/30 text-stone-300 hover:bg-black/50 hover:text-white" aria-label="Close book details"><X className="h-5 w-5" /></button>

          <div className="flex items-start gap-4 pr-10 sm:gap-6">
            <button type="button" onClick={() => { setCoverManagerOpen(true); setCoverMode('choices'); setCoverError(null); }} className="group relative shrink-0 text-left" aria-label="Change book cover">
              <BookCover work={book.work} edition={activeEdition} size="lg" />
              <span className="absolute inset-x-2 bottom-2 flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-black/80 px-2 text-[11px] font-bold text-[#f4efe6] opacity-0 backdrop-blur transition group-hover:opacity-100 group-focus-visible:opacity-100"><ImagePlus className="h-3.5 w-3.5" /> Change Cover</span>
            </button>

            <div className="min-w-0 flex-1">
              <span className="inline-flex rounded bg-[#c5a059] px-2 py-1 text-[10px] font-bold uppercase text-[#120817]">{activeEdition.format}</span>
              <h2 className="mt-3 line-clamp-2 font-serif text-2xl font-bold leading-tight text-[#f4efe6] sm:text-4xl">{book.work.title}</h2>
              <p className="mt-1 truncate font-serif text-sm italic text-stone-400">by {book.work.author}</p>
              <button type="button" onClick={() => setCoverManagerOpen(true)} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-full border border-[#c5a059]/30 bg-[#25132f] px-4 text-xs font-bold text-[#e5c158] hover:border-[#c5a059]/60"><ImagePlus className="h-4 w-4" /> Manage Cover</button>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <select value={book.status} onChange={(event) => updateStatus(event.target.value as ReadingStatus)} className="min-h-11 rounded-xl border border-[#c5a059]/30 bg-[#120817] px-4 text-sm text-[#e5c158]">
                  <option value="currently-reading">Currently Reading</option><option value="tbr">TBR</option><option value="finished">Finished</option><option value="paused">Paused</option><option value="dnf">Did Not Finish</option>
                </select>
                <select value={book.ownership} onChange={(event) => updateBook({ ownership: event.target.value as OwnershipStatus })} className="min-h-11 rounded-xl border border-[#3d2448] bg-[#120817] px-4 text-sm text-stone-300">
                  <option value="owned">Owned</option><option value="borrowed-library">Library</option><option value="borrowed-person">Borrowed</option><option value="subscription">Subscription</option><option value="wishlist">Wishlist</option>
                </select>
              </div>
            </div>
          </div>
        </header>

        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#3d2448] bg-[#120817] px-3 py-2 text-xs font-semibold">
          {tabs.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`min-h-11 whitespace-nowrap rounded-xl px-4 transition ${activeTab === tab.id ? 'bg-[#c5a059] font-bold text-[#120817]' : 'text-stone-400 hover:bg-[#25132f] hover:text-stone-200'}`}>{tab.label}</button>)}
        </nav>

        <div className="flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6">
          {activeTab === 'summary' && <div className="space-y-5">
            <section className="space-y-2 rounded-2xl border border-[#3d2448] bg-[#25132f] p-4"><label className="text-xs font-bold uppercase tracking-wider text-[#e5c158]">Why I Added This</label><input value={whyAdded} onChange={(event) => setWhyAdded(event.target.value)} placeholder="Recommended by a friend, beautiful cover, book club pick..." className="min-h-12 w-full rounded-xl border border-[#3d2448] bg-[#120817] px-4 text-sm text-[#f4efe6] outline-none focus:border-[#c5a059]" /></section>
            <section className="space-y-2"><label className="font-serif text-xl font-bold text-[#f4efe6]">My Summary</label><textarea rows={8} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Write a personal summary or keep the catalog summary..." className="w-full rounded-2xl border border-[#3d2448] bg-[#120817] p-4 text-sm leading-6 text-[#f4efe6] outline-none focus:border-[#c5a059]" /></section>
            <button type="button" onClick={saveSummary} className="quiet-shelf-primary-action min-h-11"><Save className="h-4 w-4" /> Save Summary</button>
          </div>}

          {activeTab === 'reading' && <div className="space-y-5">
            <section className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-stone-400">Reading Progress</p><p className="mt-1 font-serif text-4xl font-bold text-[#f4efe6]">{book.progressPercentage}%</p></div><BookOpen className="h-9 w-9 text-[#c5a059]" /></div><div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[#120817]"><div className="h-full rounded-full bg-[#c5a059]" style={{ width: `${book.progressPercentage}%` }} /></div></section>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-[#f4efe6]">Pages Read<input type="number" value={book.progressPages} onChange={(event) => updateBook({ progressPages: Number(event.target.value) || 0 })} className="mt-2 min-h-11 w-full rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-stone-200" /></label><label className="text-xs font-bold text-[#f4efe6]">Minutes Listened<input type="number" value={book.progressMinutes} onChange={(event) => updateBook({ progressMinutes: Number(event.target.value) || 0 })} className="mt-2 min-h-11 w-full rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-stone-200" /></label></div>
            <div><p className="mb-2 text-xs font-bold text-[#f4efe6]">Rating</p><div className="flex gap-2">{[1,2,3,4,5].map((rating) => <button key={rating} type="button" onClick={() => updateBook({ rating })} className="grid h-11 w-11 place-items-center rounded-xl border border-[#3d2448] bg-[#120817]"><Star className={`h-5 w-5 ${(book.rating ?? 0) >= rating ? 'fill-[#e5c158] text-[#e5c158]' : 'text-stone-600'}`} /></button>)}</div></div>
            <button type="button" onClick={() => onStartSession(book)} className="quiet-shelf-primary-action min-h-12"><Play className="h-4 w-4 fill-current" /> Start Reading Session</button>
          </div>}

          {activeTab === 'thoughts' && <div className="space-y-6">
            <section className="space-y-3"><label className="font-serif text-xl font-bold text-[#f4efe6]">Review</label><textarea rows={5} value={review} onChange={(event) => setReview(event.target.value)} className="w-full rounded-2xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6]" /><label className="font-serif text-xl font-bold text-[#f4efe6]">Private Notes</label><textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} className="w-full rounded-2xl border border-[#3d2448] bg-[#120817] p-4 text-sm text-[#f4efe6]" /><button type="button" onClick={saveThoughts} className="quiet-shelf-primary-action"><Save className="h-4 w-4" /> Save Notes</button></section>
            <section className="space-y-3 border-t border-[#3d2448] pt-5"><h3 className="font-serif text-xl font-bold text-[#f4efe6]">Favorite Quotes</h3><textarea rows={3} value={quoteText} onChange={(event) => setQuoteText(event.target.value)} placeholder="Add a quote..." className="w-full rounded-xl border border-[#3d2448] bg-[#120817] p-3 text-sm text-[#f4efe6]" /><input value={quoteLocation} onChange={(event) => setQuoteLocation(event.target.value)} placeholder="Page or chapter (optional)" className="min-h-11 w-full rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-sm text-[#f4efe6]" /><button type="button" onClick={addQuote} className="quiet-shelf-secondary-action"><Quote className="h-4 w-4" /> Add Quote</button>{(book.favoriteQuotes ?? []).map((quote) => <article key={quote.id} className="flex gap-3 rounded-xl border border-[#3d2448] bg-[#25132f] p-4"><Quote className="h-5 w-5 shrink-0 text-[#c5a059]" /><div className="min-w-0 flex-1"><p className="font-serif italic text-[#f4efe6]">“{quote.quote}”</p>{quote.pageOrChapter && <p className="mt-1 text-xs text-stone-400">{quote.pageOrChapter}</p>}</div><button type="button" onClick={() => removeQuote(quote.id)} className="text-stone-500 hover:text-red-300"><Trash2 className="h-4 w-4" /></button></article>)}</section>
          </div>}

          {activeTab === 'editions' && <div className="space-y-5">
            <section className="grid gap-4 sm:grid-cols-2">{book.editions.map((edition) => <button key={edition.id} type="button" onClick={() => onUpdateBook({ ...book, activeEditionId: edition.id })} className={`flex gap-4 rounded-2xl border p-4 text-left ${edition.id === book.activeEditionId ? 'border-[#c5a059] bg-[#c5a059]/10' : 'border-[#3d2448] bg-[#25132f]'}`}><BookCover work={book.work} edition={edition} size="sm" /><span className="min-w-0 flex-1"><strong className="block capitalize text-[#f4efe6]">{edition.format}</strong>{edition.publisher && <span className="mt-1 block text-xs text-stone-400">{edition.publisher}</span>}{edition.isbn && <span className="mt-1 block text-xs text-stone-500">ISBN {edition.isbn}</span>}{edition.id === book.activeEditionId && <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#e5c158]"><Check className="h-3.5 w-3.5" /> Active edition</span>}</span></button>)}</section>
            <section className="rounded-2xl border border-[#3d2448] bg-[#25132f] p-4"><h3 className="font-serif text-xl font-bold text-[#f4efe6]">Add another edition</h3><div className="mt-3 flex flex-col gap-3 sm:flex-row"><select value={newEditionFormat} onChange={(event) => setNewEditionFormat(event.target.value as Format)} className="inkbound-select"><option value="hardcover">Hardcover</option><option value="paperback">Paperback</option><option value="ebook">Ebook</option><option value="audiobook">Audiobook</option></select><button type="button" onClick={addEdition} className="quiet-shelf-primary-action shrink-0"><Plus className="h-4 w-4" /> Add Edition</button></div></section>
          </div>}
        </div>
      </section>

      {coverManagerOpen && <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setCoverManagerOpen(false)}>
        <section className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-[#c5a059]/40 bg-[#17101b] p-5 shadow-2xl sm:rounded-3xl sm:p-7" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Manage book cover">
          <div className="flex items-start justify-between gap-4"><div><p className="inkbound-kicker">Edition cover</p><h2 className="mt-2 font-serif text-3xl text-[#f4efe6]">Manage Cover</h2><p className="mt-2 text-sm text-[#ad9fac]">Changes apply to this {activeEdition.format} edition everywhere in Inkbound.</p></div><button type="button" onClick={() => setCoverManagerOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-black/30 text-stone-300"><X className="h-5 w-5" /></button></div>

          {coverMode === 'choices' && <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <button type="button" onClick={() => setCoverMode('search')} className="rounded-2xl border border-[#c5a059]/25 bg-[#25132f] p-5 text-left hover:border-[#c5a059]/60"><Search className="h-6 w-6 text-[#e5c158]" /><h3 className="mt-4 font-serif text-xl text-[#f4efe6]">Search Online</h3><p className="mt-2 text-sm text-[#ad9fac]">Find covers and editions through Google Books.</p></button>
            <label className="cursor-pointer rounded-2xl border border-[#c5a059]/25 bg-[#25132f] p-5 hover:border-[#c5a059]/60"><Upload className="h-6 w-6 text-[#e5c158]" /><h3 className="mt-4 font-serif text-xl text-[#f4efe6]">Upload Your Own</h3><p className="mt-2 text-sm text-[#ad9fac]">Use a JPG, PNG, or WEBP image up to 5 MB.</p><input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadCover} className="sr-only" /></label>
            <button type="button" onClick={removeCover} disabled={!activeEdition.coverUrl} className="rounded-2xl border border-[#c97b7b]/25 bg-[#25132f] p-5 text-left hover:border-[#c97b7b]/60 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-6 w-6 text-[#d99191]" /><h3 className="mt-4 font-serif text-xl text-[#f4efe6]">Remove Cover</h3><p className="mt-2 text-sm text-[#ad9fac]">Return this edition to Inkbound’s generated cover.</p></button>
          </div>}

          {coverMode === 'search' && <div className="mt-6 space-y-5"><button type="button" onClick={() => setCoverMode('choices')} className="text-xs font-bold text-[#e5c158]">← Back to cover options</button><form onSubmit={searchCovers} className="flex flex-col gap-3 sm:flex-row"><input value={coverQuery} onChange={(event) => setCoverQuery(event.target.value)} className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#c5a059]/25 bg-[#0d0910] px-4 text-sm text-[#f4efe6]" placeholder="Title, author, or ISBN" /><button type="submit" disabled={!coverQuery.trim() || coverSearching} className="quiet-shelf-primary-action min-h-12 px-6 disabled:opacity-50">{coverSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{coverSearching ? 'Searching…' : 'Search Covers'}</button></form>{coverError && <p className="rounded-xl border border-[#c97b7b]/35 bg-[#c97b7b]/10 p-3 text-sm text-[#efb6b6]">{coverError}</p>}<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">{coverResults.flatMap((group) => group.editions.filter((edition) => edition.coverUrl).map((edition) => ({ group, edition }))).map(({ group, edition }) => <button key={`${group.key}-${edition.externalEditionId}`} type="button" onClick={() => chooseOnlineCover(edition)} className="group rounded-xl border border-[#3d2448] bg-[#25132f] p-3 text-left hover:border-[#c5a059]/60"><img src={edition.coverUrl} alt={`Cover for ${group.title}`} className="mx-auto aspect-[2/3] w-full rounded-lg object-cover shadow-lg" /><p className="mt-3 line-clamp-2 font-serif text-sm text-[#f4efe6]">{group.title}</p><p className="mt-1 text-[11px] capitalize text-[#ad9fac]">{edition.format} · {edition.publicationYear}</p></button>)}</div>{!coverSearching && coverResults.length === 0 && !coverError && <p className="rounded-xl border border-dashed border-[#c5a059]/25 p-8 text-center text-sm text-[#ad9fac]">Search for the title, author, or ISBN to find matching covers.</p>}</div>}

          {coverMode === 'upload' && null}
          {coverError && coverMode === 'choices' && <p className="mt-5 rounded-xl border border-[#c97b7b]/35 bg-[#c97b7b]/10 p-3 text-sm text-[#efb6b6]">{coverError}</p>}
        </section>
      </div>}
    </div>
  );
};
