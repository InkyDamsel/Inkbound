import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CheckSquare, FolderHeart, Pencil, Plus, Search, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { Format, ReadingStatus, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { ResponsiveGrid } from '../layout/responsive';
import { useUserPlan } from '../context/UserPlanContext';
import { getActiveEdition } from '../features/reading/bookReadingState';
import { BookCover } from './BookCover';

type CollectionKind = 'manual' | 'smart';
type SmartField = 'status' | 'format' | 'rating' | 'tag' | 'author' | 'year';
type SortMode = 'title' | 'author' | 'rating' | 'progress' | 'recent';

interface SmartRule {
  field: SmartField;
  value: string;
}

interface CollectionDefinition {
  id: string;
  name: string;
  description: string;
  emoji: string;
  accent: string;
  createdAt: string;
  kind?: CollectionKind;
  rule?: SmartRule;
  coverBookId?: string;
}

interface CollectionsScreenProps {
  books: UserBookRecord[];
  onUpdateBook: (book: UserBookRecord) => void;
  onSelectBook: (book: UserBookRecord) => void;
}

const COLLECTIONS_STORAGE_KEY = 'inkbound_collection_definitions';
const COLLECTION_VIEW_STORAGE_KEY = 'inkbound_collection_view';
const FREE_COLLECTION_LIMIT = 5;
const COLLECTION_DELETE_UNDO_MS = 7000;

const starterCollections: CollectionDefinition[] = [
  { id: 'comfort-reads', name: 'Comfort Reads', description: 'Stories worth returning to whenever you need somewhere familiar.', emoji: '☕', accent: 'from-[#76586a] to-[#382b40]', createdAt: new Date().toISOString(), kind: 'manual' },
  { id: 'spooky-season', name: 'Spooky Season', description: 'Atmospheric, unsettling, and perfect for long autumn nights.', emoji: '🕯️', accent: 'from-[#694a58] to-[#251b2a]', createdAt: new Date().toISOString(), kind: 'manual' },
];

const makeCollectionId = () => `collection-${crypto.randomUUID()}`;
const normalized = (value?: string) => value?.trim().toLowerCase() ?? '';

const smartMatches = (book: UserBookRecord, rule?: SmartRule) => {
  if (!rule || !rule.value.trim()) return false;
  const value = normalized(rule.value);
  if (rule.field === 'status') return book.status === value as ReadingStatus;
  if (rule.field === 'format') return getActiveEdition(book)?.format === value as Format;
  if (rule.field === 'rating') return (book.rating ?? 0) >= Number(rule.value || 0);
  if (rule.field === 'tag') return book.privateTags.some((tag) => normalized(tag) === value);
  if (rule.field === 'author') return normalized(book.work.author).includes(value);
  if (rule.field === 'year') return book.work.publicationYear === Number(rule.value);
  return false;
};

const booksForCollection = (collection: CollectionDefinition, books: UserBookRecord[]) => {
  if ((collection.kind ?? 'manual') === 'smart') return books.filter((book) => smartMatches(book, collection.rule));
  return books.filter((book) => book.collections.includes(collection.name));
};

export const CollectionsScreen: React.FC<CollectionsScreenProps> = ({ books, onUpdateBook, onSelectBook }) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const [collections, setCollections] = usePersistentState<CollectionDefinition[]>(COLLECTIONS_STORAGE_KEY, starterCollections);
  const [selectedCollectionId, setSelectedCollectionId] = usePersistentState<string | null>(COLLECTION_VIEW_STORAGE_KEY, null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState('📚');
  const [kind, setKind] = useState<CollectionKind>('manual');
  const [smartField, setSmartField] = useState<SmartField>('status');
  const [smartValue, setSmartValue] = useState('currently-reading');
  const [coverBookId, setCoverBookId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('title');
  const [statusFilter, setStatusFilter] = useState<'all' | ReadingStatus>('all');
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<CollectionDefinition | null>(null);
  const pendingDeleteRef = useRef<CollectionDefinition | null>(null);
  const deleteTimerRef = useRef<number | null>(null);
  const booksRef = useRef(books);
  const onUpdateBookRef = useRef(onUpdateBook);

  useEffect(() => {
    booksRef.current = books;
    onUpdateBookRef.current = onUpdateBook;
  }, [books, onUpdateBook]);

  const clearDeleteTimer = () => {
    if (deleteTimerRef.current === null) return;
    window.clearTimeout(deleteTimerRef.current);
    deleteTimerRef.current = null;
  };

  const commitCollectionDelete = (collection = pendingDeleteRef.current) => {
    if (!collection) return;
    clearDeleteTimer();
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    setCollections((current) => current.filter((item) => item.id !== collection.id));
    if ((collection.kind ?? 'manual') === 'manual') {
      booksRef.current.forEach((book) => {
        if (!book.collections.includes(collection.name)) return;
        onUpdateBookRef.current({ ...book, collections: book.collections.filter((item) => item !== collection.name) });
      });
    }
    setSelectedCollectionId((current) => current === collection.id ? null : current);
  };

  const requestCollectionDelete = (collection: CollectionDefinition) => {
    if (pendingDeleteRef.current) commitCollectionDelete();
    pendingDeleteRef.current = collection;
    setPendingDelete(collection);
    if (selectedCollectionId === collection.id) setSelectedCollectionId(null);
    deleteTimerRef.current = window.setTimeout(() => commitCollectionDelete(collection), COLLECTION_DELETE_UNDO_MS);
  };

  const undoCollectionDelete = () => {
    clearDeleteTimer();
    const collection = pendingDeleteRef.current;
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    if (collection) setSelectedCollectionId(collection.id);
  };

  useEffect(() => () => {
    const collection = pendingDeleteRef.current;
    clearDeleteTimer();
    pendingDeleteRef.current = null;
    if (!collection) return;
    setCollections((current) => current.filter((item) => item.id !== collection.id));
    if ((collection.kind ?? 'manual') === 'manual') {
      booksRef.current.forEach((book) => {
        if (book.collections.includes(collection.name)) {
          onUpdateBookRef.current({ ...book, collections: book.collections.filter((item) => item !== collection.name) });
        }
      });
    }
  }, [setCollections]);

  const visibleCollections = useMemo(
    () => pendingDelete ? collections.filter((collection) => collection.id !== pendingDelete.id) : collections,
    [collections, pendingDelete],
  );

  const isPremium = userPlan === 'premium';
  const hasReachedCollectionLimit = !isPremium && visibleCollections.length >= FREE_COLLECTION_LIMIT;
  const remainingFreeCollections = Math.max(0, FREE_COLLECTION_LIMIT - visibleCollections.length);
  const selectedCollection = visibleCollections.find((collection) => collection.id === selectedCollectionId);
  const selectedBooks = selectedCollection ? booksForCollection(selectedCollection, books) : [];
  const finishedCount = selectedBooks.filter((book) => book.status === 'finished').length;
  const averageProgress = selectedBooks.length ? Math.round(selectedBooks.reduce((sum, book) => sum + book.progressPercentage, 0) / selectedBooks.length) : 0;

  const visibleBooks = useMemo(() => {
    const query = normalized(searchQuery);
    const source = selectedCollection && (selectedCollection.kind ?? 'manual') === 'smart' ? selectedBooks : books;
    return source
      .filter((book) => statusFilter === 'all' || book.status === statusFilter)
      .filter((book) => !query || normalized(book.work.title).includes(query) || normalized(book.work.author).includes(query) || book.privateTags.some((tag) => normalized(tag).includes(query)))
      .sort((a, b) => {
        if (sortMode === 'author') return a.work.author.localeCompare(b.work.author);
        if (sortMode === 'rating') return (b.rating ?? 0) - (a.rating ?? 0);
        if (sortMode === 'progress') return b.progressPercentage - a.progressPercentage;
        if (sortMode === 'recent') return (b.lastSessionDate ?? b.dateAdded).localeCompare(a.lastSessionDate ?? a.dateAdded);
        return a.work.title.localeCompare(b.work.title);
      });
  }, [books, searchQuery, selectedBooks, selectedCollection, sortMode, statusFilter]);

  const openNewCollection = () => {
    if (hasReachedCollectionLimit) {
      openUpgradeModal('Upgrade to Inkbound Premium for unlimited collections');
      return;
    }
    setEditingId(null); setName(''); setDescription(''); setEmoji('📚'); setKind('manual'); setSmartField('status'); setSmartValue('currently-reading'); setCoverBookId(''); setIsEditorOpen(true);
  };

  const openEditCollection = (collection: CollectionDefinition) => {
    setEditingId(collection.id); setName(collection.name); setDescription(collection.description); setEmoji(collection.emoji); setKind(collection.kind ?? 'manual'); setSmartField(collection.rule?.field ?? 'status'); setSmartValue(collection.rule?.value ?? 'currently-reading'); setCoverBookId(collection.coverBookId ?? ''); setIsEditorOpen(true);
  };

  const saveCollection = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const duplicate = visibleCollections.some((collection) => normalized(collection.name) === normalized(trimmedName) && collection.id !== editingId);
    if (duplicate) return;
    const nextRule = kind === 'smart' ? { field: smartField, value: smartValue.trim() } : undefined;
    if (editingId) {
      const previous = visibleCollections.find((collection) => collection.id === editingId);
      setCollections((current) => current.map((collection) => collection.id === editingId ? { ...collection, name: trimmedName, description: description.trim(), emoji, kind, rule: nextRule, coverBookId: coverBookId || undefined } : collection));
      if (previous && previous.name !== trimmedName && (previous.kind ?? 'manual') === 'manual') {
        books.forEach((book) => {
          if (!book.collections.includes(previous.name)) return;
          onUpdateBook({ ...book, collections: [...new Set(book.collections.map((item) => item === previous.name ? trimmedName : item))] });
        });
      }
    } else {
      const newCollection: CollectionDefinition = { id: makeCollectionId(), name: trimmedName, description: description.trim(), emoji, accent: 'from-[#76586a] to-[#382b40]', createdAt: new Date().toISOString(), kind, rule: nextRule, coverBookId: coverBookId || undefined };
      setCollections((current) => [...current, newCollection]);
      setSelectedCollectionId(newCollection.id);
    }
    setIsEditorOpen(false);
  };

  const toggleBook = (book: UserBookRecord) => {
    if (!selectedCollection || (selectedCollection.kind ?? 'manual') === 'smart') return;
    const isIncluded = book.collections.includes(selectedCollection.name);
    onUpdateBook({ ...book, collections: isIncluded ? book.collections.filter((item) => item !== selectedCollection.name) : [...new Set([...book.collections, selectedCollection.name])] });
  };

  const bulkMembership = (mode: 'add' | 'remove') => {
    if (!selectedCollection || (selectedCollection.kind ?? 'manual') === 'smart' || selectedBookIds.length === 0) return;
    books.filter((book) => selectedBookIds.includes(book.id)).forEach((book) => {
      const has = book.collections.includes(selectedCollection.name);
      if (mode === 'add' && !has) onUpdateBook({ ...book, collections: [...new Set([...book.collections, selectedCollection.name])] });
      if (mode === 'remove' && has) onUpdateBook({ ...book, collections: book.collections.filter((item) => item !== selectedCollection.name) });
    });
    setSelectedBookIds([]);
  };

  const setCollectionCover = (bookId: string) => {
    if (!selectedCollection) return;
    setCollections((current) => current.map((collection) => collection.id === selectedCollection.id ? { ...collection, coverBookId: bookId || undefined } : collection));
  };

  return (
    <div className="space-y-7 pb-24">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0"><p className="inkbound-kicker">Personal Shelves</p><h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Collections</h1><p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">Build manual shelves or smart collections that update themselves as your library changes.</p><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 py-1 font-semibold text-[var(--ink-muted)]">{isPremium ? `${visibleCollections.length} collections · Unlimited` : `${visibleCollections.length} of ${FREE_COLLECTION_LIMIT} free collections`}</span>{!isPremium && <span className="text-[var(--ink-faint)]">{remainingFreeCollections > 0 ? `${remainingFreeCollections} remaining` : 'Free collection limit reached'}</span>}</div></div>
        <button type="button" onClick={openNewCollection} className={`${hasReachedCollectionLimit ? 'quiet-shelf-secondary-action' : 'quiet-shelf-primary-action'} w-full justify-center px-5 sm:w-auto`}>{hasReachedCollectionLimit ? <><Sparkles className="h-4 w-4" /> Upgrade for Unlimited</> : <><Plus className="h-4 w-4" /> New Collection</>}</button>
      </header>

      <ResponsiveGrid minItemWidth={240} maxColumns={3} gap={16}>
        {visibleCollections.map((collection) => {
          const collectionBooks = booksForCollection(collection, books);
          const coverBook = collection.coverBookId ? books.find((book) => book.id === collection.coverBookId) : collectionBooks[0];
          const coverEdition = coverBook ? getActiveEdition(coverBook) : undefined;
          return <article key={collection.id} className="inkbound-panel min-w-0 overflow-hidden rounded-3xl">
            <button type="button" onClick={() => { setSelectedCollectionId(collection.id); setSelectedBookIds([]); setSearchQuery(''); }} className={`relative block h-32 w-full overflow-hidden bg-gradient-to-br ${collection.accent} p-5 text-left`}>
              {coverBook && coverEdition?.coverUrl ? <img src={coverEdition.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" /> : null}<span className="relative text-3xl" aria-hidden="true">{collection.emoji}</span><span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold uppercase text-white">{(collection.kind ?? 'manual') === 'smart' ? 'Smart' : 'Manual'}</span>
            </button>
            <div className="p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-serif text-xl font-bold text-[var(--ink-ivory)]">{collection.name}</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">{collectionBooks.length} {collectionBooks.length === 1 ? 'book' : 'books'}</p></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => openEditCollection(collection)} className="quiet-shelf-icon-button" aria-label={`Edit ${collection.name}`}><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => requestCollectionDelete(collection)} className="quiet-shelf-icon-button" aria-label={`Delete ${collection.name}`}><Trash2 className="h-4 w-4" /></button></div></div><p className="mt-3 line-clamp-2 text-sm text-[var(--ink-muted)]">{collection.description || 'A private Inkbound collection.'}</p></div>
          </article>;
        })}
      </ResponsiveGrid>

      {selectedCollection && <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><p className="inkbound-kicker">Open Collection</p><h2 className="break-words font-serif text-2xl font-bold text-[var(--ink-ivory)]">{selectedCollection.emoji} {selectedCollection.name}</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">{(selectedCollection.kind ?? 'manual') === 'smart' ? 'This shelf updates automatically from its rule.' : 'Select books below to add or remove them.'}</p></div><button type="button" onClick={() => setSelectedCollectionId(null)} className="quiet-shelf-secondary-action w-full justify-center lg:w-auto">Close</button></div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><p className="text-xl font-bold text-[var(--ink-ivory)]">{selectedBooks.length}</p><p className="text-xs text-[var(--ink-muted)]">Books</p></div><div className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><p className="text-xl font-bold text-[var(--ink-ivory)]">{finishedCount}</p><p className="text-xs text-[var(--ink-muted)]">Finished</p></div><div className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><p className="text-xl font-bold text-[var(--ink-ivory)]">{averageProgress}%</p><p className="text-xs text-[var(--ink-muted)]">Average progress</p></div></div>

        {selectedBooks.length > 0 && <div className="mt-6"><div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">On this shelf</p><select value={selectedCollection.coverBookId ?? ''} onChange={(event) => setCollectionCover(event.target.value)} className="inkbound-select w-full sm:max-w-[240px]"><option value="">Automatic cover</option>{selectedBooks.map((book) => <option key={book.id} value={book.id}>{book.work.title}</option>)}</select></div><ResponsiveGrid minItemWidth={150} maxColumns={6} gap={14}>{selectedBooks.slice(0, 18).map((book) => <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="min-w-0 text-left"><BookCover work={book.work} edition={getActiveEdition(book)} size="lg" /><p className="mt-2 line-clamp-1 text-sm font-semibold text-[var(--ink-ivory)]">{book.work.title}</p></button>)}</ResponsiveGrid>{selectedBooks.length > 18 && <p className="mt-3 text-xs text-[var(--ink-muted)]">+{selectedBooks.length - 18} more books are available in the list below.</p>}</div>}

        <div className="mt-7 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]"><label className="relative"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search title, author, or tag" className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] pl-11 pr-4 text-sm text-[var(--ink-ivory)] outline-none" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ReadingStatus)} className="inkbound-select"><option value="all">All statuses</option><option value="currently-reading">Currently Reading</option><option value="tbr">TBR</option><option value="finished">Finished</option><option value="paused">Paused</option><option value="dnf">DNF</option><option value="wishlist">Wishlist</option></select><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="inkbound-select"><option value="title">Title</option><option value="author">Author</option><option value="rating">Rating</option><option value="progress">Progress</option><option value="recent">Recent activity</option></select></div>

        {(selectedCollection.kind ?? 'manual') === 'manual' && selectedBookIds.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3"><span className="mr-auto text-sm font-semibold text-[var(--ink-ivory)]">{selectedBookIds.length} selected</span><button type="button" onClick={() => bulkMembership('add')} className="quiet-shelf-secondary-action">Add selected</button><button type="button" onClick={() => bulkMembership('remove')} className="quiet-shelf-secondary-action">Remove selected</button><button type="button" onClick={() => setSelectedBookIds([])} className="quiet-shelf-icon-button" aria-label="Clear selected books"><X className="h-4 w-4" /></button></div>}

        <div className="mt-4 max-h-[460px] space-y-2 overflow-y-auto pr-1">{visibleBooks.map((book) => {
          const included = selectedBooks.some((item) => item.id === book.id);
          const checked = selectedBookIds.includes(book.id);
          return <div key={book.id} className="flex min-h-16 items-center gap-3 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4">{(selectedCollection.kind ?? 'manual') === 'manual' && <button type="button" onClick={() => setSelectedBookIds((current) => current.includes(book.id) ? current.filter((id) => id !== book.id) : [...current, book.id])} className="quiet-shelf-icon-button shrink-0" aria-label={`Select ${book.work.title}`}><CheckSquare className={`h-4 w-4 ${checked ? 'text-[var(--ink-gold)]' : ''}`} /></button>}<button type="button" onClick={() => onSelectBook(book)} className="min-w-0 flex-1 py-2 text-left"><strong className="block truncate text-sm text-[var(--ink-ivory)]">{book.work.title}</strong><small className="block truncate text-[var(--ink-muted)]">{book.work.author} · {book.progressPercentage}%</small></button>{(selectedCollection.kind ?? 'manual') === 'manual' ? <button type="button" onClick={() => toggleBook(book)} className={`min-h-11 shrink-0 rounded-full px-3 text-xs font-bold ${included ? 'bg-[var(--ink-gold)] text-[#241722]' : 'border border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{included ? 'Added' : 'Add'}</button> : <span className="shrink-0 rounded-full border border-[var(--ink-border)] px-3 py-2 text-xs font-bold text-[var(--ink-muted)]">Matched</span>}</div>;
        })}{visibleBooks.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--ink-border)] p-8 text-center text-sm text-[var(--ink-muted)]">No books match these filters.</div>}</div>
      </section>}

      {visibleCollections.length === 0 && <div className="rounded-3xl border border-dashed border-[var(--ink-border)] p-10 text-center"><FolderHeart className="mx-auto h-10 w-10 text-[var(--ink-gold)]" /><h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">Create your first collection</h2><p className="mt-2 text-sm text-[var(--ink-muted)]">Build a manual shelf or let a smart rule maintain it for you.</p></div>}

      {isEditorOpen && <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setIsEditorOpen(false)}><section className="inkbound-panel max-h-[100dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:max-h-[92dvh] sm:rounded-3xl sm:p-7" role="dialog" aria-modal="true" aria-label="Collection editor" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="inkbound-kicker">Private Shelf</p><h2 className="break-words font-serif text-2xl font-bold text-[var(--ink-ivory)]">{editingId ? 'Edit Collection' : 'New Collection'}</h2></div><button type="button" onClick={() => setIsEditorOpen(false)} className="quiet-shelf-icon-button shrink-0" aria-label="Close editor"><X /></button></div><div className="mt-6 grid gap-4"><label className="text-sm font-semibold text-[var(--ink-ivory)]">Emoji<input value={emoji} onChange={(event) => setEmoji(event.target.value.slice(0, 4))} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]" /></label><label className="text-sm font-semibold text-[var(--ink-ivory)]">Name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]" /></label><label className="text-sm font-semibold text-[var(--ink-ivory)]">Description<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-[var(--ink-ivory)]" /></label><div className="grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => setKind('manual')} className={`min-h-11 rounded-xl border p-4 text-left ${kind === 'manual' ? 'border-[var(--ink-gold)] bg-[rgba(197,160,89,0.08)]' : 'border-[var(--ink-border)]'}`}><strong className="text-[var(--ink-ivory)]">Manual</strong><p className="mt-1 text-xs text-[var(--ink-muted)]">You choose the books.</p></button><button type="button" onClick={() => setKind('smart')} className={`min-h-11 rounded-xl border p-4 text-left ${kind === 'smart' ? 'border-[var(--ink-gold)] bg-[rgba(197,160,89,0.08)]' : 'border-[var(--ink-border)]'}`}><strong className="text-[var(--ink-ivory)]">Smart</strong><p className="mt-1 text-xs text-[var(--ink-muted)]">Books match a rule automatically.</p></button></div>{kind === 'smart' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-[var(--ink-ivory)]">Rule<select value={smartField} onChange={(event) => { const field = event.target.value as SmartField; setSmartField(field); setSmartValue(field === 'status' ? 'currently-reading' : field === 'format' ? 'ebook' : field === 'rating' ? '4' : ''); }} className="inkbound-select mt-2 w-full"><option value="status">Status is</option><option value="format">Format is</option><option value="rating">Rating at least</option><option value="tag">Has tag</option><option value="author">Author contains</option><option value="year">Publication year</option></select></label><label className="text-sm font-semibold text-[var(--ink-ivory)]">Value{smartField === 'status' ? <select value={smartValue} onChange={(event) => setSmartValue(event.target.value)} className="inkbound-select mt-2 w-full"><option value="currently-reading">Currently Reading</option><option value="tbr">TBR</option><option value="finished">Finished</option><option value="paused">Paused</option><option value="dnf">DNF</option><option value="wishlist">Wishlist</option></select> : smartField === 'format' ? <select value={smartValue} onChange={(event) => setSmartValue(event.target.value)} className="inkbound-select mt-2 w-full"><option value="hardcover">Hardcover</option><option value="paperback">Paperback</option><option value="ebook">Ebook</option><option value="audiobook">Audiobook</option></select> : <input type={smartField === 'rating' || smartField === 'year' ? 'number' : 'text'} value={smartValue} onChange={(event) => setSmartValue(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]" />}</label></div>}</div><button type="button" onClick={saveCollection} disabled={!name.trim() || (kind === 'smart' && !smartValue.trim())} className="quiet-shelf-primary-action mt-6 min-h-12 w-full justify-center disabled:opacity-50"><BookOpen className="h-4 w-4" /> Save Collection</button></section></div>}

      {pendingDelete && <div className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[220] mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-4 py-3 shadow-2xl sm:bottom-6" role="status" aria-live="polite"><span className="min-w-0 text-sm font-semibold text-[var(--ink-ivory)]">Collection deleted.</span><button type="button" onClick={undoCollectionDelete} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[var(--ink-gold-bright)]"><Undo2 className="h-4 w-4" /> Undo</button></div>}
    </div>
  );
};
