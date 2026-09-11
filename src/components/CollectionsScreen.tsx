import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CheckSquare, FolderHeart, Pencil, Plus, Search, Trash2, Undo2, X } from 'lucide-react';
import { Format, ReadingStatus, UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { ResponsiveGrid } from '../layout/responsive';
import { replaceCanonicalLibrary } from '../features/library/libraryMutations';
import { getActiveEdition, getAverageBookProgress, getBookReadingState } from '../features/reading/bookReadingState';
import { ACCOUNT_DATA_STORAGE_KEYS } from '../features/sync/storageKeys';
import { prepareCollectionBannerImage } from '../platform/prepareCollectionBannerImage';
import { BookCover } from './BookCover';

type CollectionKind = 'manual' | 'smart';
type SmartField = 'status' | 'format' | 'rating' | 'tag' | 'author' | 'year';
type SortMode = 'title' | 'author' | 'rating' | 'progress' | 'recent';
interface SmartRule { field: SmartField; value: string; }
interface CollectionDefinition { id: string; name: string; description: string; emoji?: string; bannerUrl?: string; accent: string; createdAt: string; updatedAt?: string; kind?: CollectionKind; rule?: SmartRule; coverBookId?: string; }
interface CollectionsScreenProps { books: UserBookRecord[]; onUpdateBook: (book: UserBookRecord) => void; onSelectBook: (book: UserBookRecord) => void; }

const COLLECTIONS_STORAGE_KEY = ACCOUNT_DATA_STORAGE_KEYS.collectionDefinitions;
const COLLECTION_VIEW_STORAGE_KEY = 'inkbound_collection_view';
const COLLECTION_DELETE_UNDO_MS = 7000;
const starterCollections: CollectionDefinition[] = [
  { id: 'comfort-reads', name: 'Comfort Reads', description: 'Stories worth returning to whenever you need somewhere familiar.', accent: 'from-[#76586a] to-[#382b40]', createdAt: new Date().toISOString(), kind: 'manual' },
  { id: 'spooky-season', name: 'Spooky Season', description: 'Atmospheric, unsettling, and perfect for long autumn nights.', accent: 'from-[#694a58] to-[#251b2a]', createdAt: new Date().toISOString(), kind: 'manual' },
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
const booksForCollection = (collection: CollectionDefinition, books: UserBookRecord[]) => (collection.kind ?? 'manual') === 'smart' ? books.filter((book) => smartMatches(book, collection.rule)) : books.filter((book) => book.collections.includes(collection.name));

export const CollectionsScreen: React.FC<CollectionsScreenProps> = ({ books, onSelectBook }) => {
  const [collections, setCollections] = usePersistentState<CollectionDefinition[]>(COLLECTIONS_STORAGE_KEY, starterCollections);
  const [selectedCollectionId, setSelectedCollectionId] = usePersistentState<string | null>(COLLECTION_VIEW_STORAGE_KEY, null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCollectionId, setDraftCollectionId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerError, setBannerError] = useState('');
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
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { booksRef.current = books; }, [books]);
  const clearDeleteTimer = () => { if (deleteTimerRef.current !== null) { window.clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null; } };
  const removeManualMembershipEverywhere = (collectionName: string) => {
    const currentBooks = booksRef.current;
    const nextBooks = currentBooks.map((book) => book.collections.includes(collectionName)
      ? { ...book, collections: book.collections.filter((item) => item !== collectionName) }
      : book);
    if (nextBooks.some((book, index) => book !== currentBooks[index])) replaceCanonicalLibrary(nextBooks);
  };
  const commitCollectionDelete = (collection = pendingDeleteRef.current) => {
    if (!collection) return;
    clearDeleteTimer(); pendingDeleteRef.current = null; setPendingDelete(null);
    setCollections((current) => current.filter((item) => item.id !== collection.id));
    if ((collection.kind ?? 'manual') === 'manual') removeManualMembershipEverywhere(collection.name);
    setSelectedCollectionId((current) => current === collection.id ? null : current);
  };
  const requestCollectionDelete = (collection: CollectionDefinition) => { if (pendingDeleteRef.current) commitCollectionDelete(); pendingDeleteRef.current = collection; setPendingDelete(collection); if (selectedCollectionId === collection.id) setSelectedCollectionId(null); deleteTimerRef.current = window.setTimeout(() => commitCollectionDelete(collection), COLLECTION_DELETE_UNDO_MS); };
  const undoCollectionDelete = () => { clearDeleteTimer(); const collection = pendingDeleteRef.current; pendingDeleteRef.current = null; setPendingDelete(null); if (collection) setSelectedCollectionId(collection.id); };
  useEffect(() => () => { const collection = pendingDeleteRef.current; clearDeleteTimer(); pendingDeleteRef.current = null; if (!collection) return; setCollections((current) => current.filter((item) => item.id !== collection.id)); if ((collection.kind ?? 'manual') === 'manual') removeManualMembershipEverywhere(collection.name); }, [setCollections]);

  const visibleCollections = useMemo(() => pendingDelete ? collections.filter((collection) => collection.id !== pendingDelete.id) : collections, [collections, pendingDelete]);
  const selectedCollection = visibleCollections.find((collection) => collection.id === selectedCollectionId);
  const selectedBooks = selectedCollection ? booksForCollection(selectedCollection, books) : [];
  const finishedCount = selectedBooks.filter((book) => getBookReadingState(book).isFinished).length;
  const averageProgress = getAverageBookProgress(selectedBooks);
  const visibleBooks = useMemo(() => {
    const query = normalized(searchQuery);
    const source = selectedCollection && (selectedCollection.kind ?? 'manual') === 'smart' ? selectedBooks : books;
    return source.filter((book) => statusFilter === 'all' || book.status === statusFilter).filter((book) => !query || normalized(book.work.title).includes(query) || normalized(book.work.author).includes(query) || book.privateTags.some((tag) => normalized(tag).includes(query))).sort((a, b) => {
      if (sortMode === 'author') return a.work.author.localeCompare(b.work.author);
      if (sortMode === 'rating') return (b.rating ?? 0) - (a.rating ?? 0);
      if (sortMode === 'progress') return getBookReadingState(b).progressPercentage - getBookReadingState(a).progressPercentage;
      if (sortMode === 'recent') return (b.lastSessionDate ?? b.dateAdded).localeCompare(a.lastSessionDate ?? a.dateAdded);
      return a.work.title.localeCompare(b.work.title);
    });
  }, [books, searchQuery, selectedBooks, selectedCollection, sortMode, statusFilter]);

  const openNewCollection = () => { const id = makeCollectionId(); setEditingId(null); setDraftCollectionId(id); setName(''); setDescription(''); setBannerUrl(''); setBannerError(''); setKind('manual'); setSmartField('status'); setSmartValue('currently-reading'); setCoverBookId(''); setIsEditorOpen(true); };
  const openEditCollection = (collection: CollectionDefinition) => { setEditingId(collection.id); setDraftCollectionId(collection.id); setName(collection.name); setDescription(collection.description); setBannerUrl(collection.bannerUrl ?? ''); setBannerError(''); setKind(collection.kind ?? 'manual'); setSmartField(collection.rule?.field ?? 'status'); setSmartValue(collection.rule?.value ?? 'currently-reading'); setCoverBookId(collection.coverBookId ?? ''); setIsEditorOpen(true); };
  const handleBannerFile = async (file?: File) => {
    if (!file) return;
    setBannerBusy(true);
    setBannerError('');
    try {
      const nextBannerUrl = await prepareCollectionBannerImage(file, draftCollectionId || editingId || makeCollectionId());
      setBannerUrl(nextBannerUrl);
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : 'Inkbound could not prepare that banner image.');
    } finally {
      setBannerBusy(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  };
  const saveCollection = () => {
    const trimmedName = name.trim(); if (!trimmedName) return;
    if (visibleCollections.some((collection) => normalized(collection.name) === normalized(trimmedName) && collection.id !== editingId)) return;
    const now = new Date().toISOString();
    const nextRule = kind === 'smart' ? { field: smartField, value: smartValue.trim() } : undefined;
    if (editingId) {
      const previous = visibleCollections.find((collection) => collection.id === editingId);
      setCollections((current) => current.map((collection) => collection.id === editingId ? { ...collection, name: trimmedName, description: description.trim(), bannerUrl: bannerUrl || undefined, kind, rule: nextRule, coverBookId: coverBookId || undefined, updatedAt: now } : collection));
      if (previous && previous.name !== trimmedName && (previous.kind ?? 'manual') === 'manual') {
        const nextBooks = books.map((book) => book.collections.includes(previous.name)
          ? { ...book, collections: [...new Set(book.collections.map((item) => item === previous.name ? trimmedName : item))] }
          : book);
        replaceCanonicalLibrary(nextBooks);
      }
    } else {
      const newCollection: CollectionDefinition = { id: draftCollectionId || makeCollectionId(), name: trimmedName, description: description.trim(), bannerUrl: bannerUrl || undefined, accent: 'from-[#76586a] to-[#382b40]', createdAt: now, updatedAt: now, kind, rule: nextRule, coverBookId: coverBookId || undefined };
      setCollections((current) => [...current, newCollection]); setSelectedCollectionId(newCollection.id);
    }
    setIsEditorOpen(false);
  };
  const toggleBook = (book: UserBookRecord) => {
    if (!selectedCollection || (selectedCollection.kind ?? 'manual') === 'smart') return;
    const collectionName = selectedCollection.name;
    const nextBooks = books.map((current) => {
      if (current.id !== book.id) return current;
      const included = current.collections.includes(collectionName);
      return { ...current, collections: included ? current.collections.filter((item) => item !== collectionName) : [...new Set([...current.collections, collectionName])] };
    });
    replaceCanonicalLibrary(nextBooks);
  };
  const bulkMembership = (mode: 'add' | 'remove') => {
    if (!selectedCollection || (selectedCollection.kind ?? 'manual') === 'smart' || selectedBookIds.length === 0) return;
    const selectedIds = new Set(selectedBookIds);
    const collectionName = selectedCollection.name;
    const nextBooks = books.map((book) => {
      if (!selectedIds.has(book.id)) return book;
      const has = book.collections.includes(collectionName);
      if (mode === 'add' && !has) return { ...book, collections: [...new Set([...book.collections, collectionName])] };
      if (mode === 'remove' && has) return { ...book, collections: book.collections.filter((item) => item !== collectionName) };
      return book;
    });
    replaceCanonicalLibrary(nextBooks);
    setSelectedBookIds([]);
  };
  const setCollectionCover = (bookId: string) => { if (selectedCollection) setCollections((current) => current.map((collection) => collection.id === selectedCollection.id ? { ...collection, coverBookId: bookId || undefined, updatedAt: new Date().toISOString() } : collection)); };

  return <div className="space-y-7 pb-24">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><p className="inkbound-kicker">Personal Shelves</p><h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Collections</h1><p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">Build manual shelves or smart collections that update themselves as your library changes.</p><div className="mt-3"><span className="rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">{visibleCollections.length.toLocaleString()} collections · Unlimited</span></div></div><button type="button" onClick={openNewCollection} className="quiet-shelf-primary-action w-full justify-center px-5 sm:w-auto"><Plus className="h-4 w-4" /> New Collection</button></header>

    <ResponsiveGrid minItemWidth={240} maxColumns={3} gap={16}>{visibleCollections.map((collection) => { const collectionBooks = booksForCollection(collection, books); const coverBook = collection.coverBookId ? books.find((book) => book.id === collection.coverBookId) : collectionBooks[0]; const coverEdition = coverBook ? getActiveEdition(coverBook) : undefined; const fallbackCoverUrl = coverEdition?.coverUrl; return <article key={collection.id} className="inkbound-panel min-w-0 overflow-hidden rounded-3xl"><button type="button" onClick={() => { setSelectedCollectionId(collection.id); setSelectedBookIds([]); setSearchQuery(''); }} className={`relative block h-32 w-full overflow-hidden bg-gradient-to-br ${collection.accent} text-left`}>{collection.bannerUrl ? <img src={collection.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : fallbackCoverUrl ? <img src={fallbackCoverUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" /> : null}<span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2 py-1 text-[10px] font-bold uppercase text-white">{(collection.kind ?? 'manual') === 'smart' ? 'Smart' : 'Manual'}</span></button><div className="p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-serif text-xl font-bold text-[var(--ink-ivory)]">{collection.name}</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">{collectionBooks.length} {collectionBooks.length === 1 ? 'book' : 'books'}</p></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => openEditCollection(collection)} className="quiet-shelf-icon-button" aria-label={`Edit ${collection.name}`}><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => requestCollectionDelete(collection)} className="quiet-shelf-icon-button" aria-label={`Delete ${collection.name}`}><Trash2 className="h-4 w-4" /></button></div></div><p className="mt-3 line-clamp-2 text-sm text-[var(--ink-muted)]">{collection.description || 'A private Inkbound collection.'}</p></div></article>; })}</ResponsiveGrid>

    {selectedCollection && <section className="inkbound-panel rounded-3xl p-5 sm:p-7"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><p className="inkbound-kicker">Open Collection</p><h2 className="break-words font-serif text-2xl font-bold text-[var(--ink-ivory)]">{selectedCollection.name}</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">{(selectedCollection.kind ?? 'manual') === 'smart' ? 'This shelf updates automatically from its rule.' : 'Select books below to add or remove them.'}</p></div><button type="button" onClick={() => setSelectedCollectionId(null)} className="quiet-shelf-secondary-action w-full justify-center lg:w-auto">Close</button></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><p className="text-xl font-bold text-[var(--ink-ivory)]">{selectedBooks.length}</p><p className="text-xs text-[var(--ink-muted)]">Books</p></div><div className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><p className="text-xl font-bold text-[var(--ink-ivory)]">{finishedCount}</p><p className="text-xs text-[var(--ink-muted)]">Finished</p></div><div className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><p className="text-xl font-bold text-[var(--ink-ivory)]">{averageProgress}%</p><p className="text-xs text-[var(--ink-muted)]">Average progress</p></div></div>{selectedBooks.length > 0 && <div className="mt-6"><div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Shelf preview</p>{(selectedCollection.kind ?? 'manual') === 'manual' && <label className="text-xs text-[var(--ink-muted)]">Cover book<select value={selectedCollection.coverBookId ?? ''} onChange={(event) => setCollectionCover(event.target.value)} className="ml-2 min-h-10 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)]"><option value="">Automatic</option>{selectedBooks.map((book) => <option key={book.id} value={book.id}>{book.work.title}</option>)}</select></label>}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{selectedBooks.slice(0, 8).map((book) => { const readingState = getBookReadingState(book); return <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-left"><div className="flex gap-3"><BookCover work={book.work} edition={readingState.activeEdition} progressPercentage={readingState.progressPercentage} isFinished={readingState.isFinished} rating={book.rating} className="h-20 w-14 shrink-0" /><div className="min-w-0"><p className="line-clamp-2 font-serif text-sm font-bold text-[var(--ink-ivory)]">{book.work.title}</p><p className="mt-1 truncate text-[11px] text-[var(--ink-muted)]">{book.work.author}</p></div></div></button>; })}</div></div>}</section>}

    {selectedCollection && <section className="inkbound-panel rounded-3xl p-5 sm:p-7"><div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><p className="inkbound-kicker">Manage Books</p><h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">{(selectedCollection.kind ?? 'manual') === 'smart' ? 'Matching books' : 'Add or remove books'}</h2></div><div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto xl:grid-cols-[minmax(240px,1fr)_180px_180px]"><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search title, author, or tag" className="min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] pl-10 pr-3 text-sm text-[var(--ink-ivory)]" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ReadingStatus)} className="min-h-11 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]"><option value="all">All statuses</option><option value="currently-reading">Currently Reading</option><option value="tbr">TBR</option><option value="finished">Finished</option><option value="paused">Paused</option><option value="dnf">DNF</option><option value="wishlist">Wishlist</option></select><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="min-h-11 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]"><option value="title">Sort: Title</option><option value="author">Sort: Author</option><option value="rating">Sort: Rating</option><option value="progress">Sort: Progress</option><option value="recent">Sort: Recent</option></select></div></div>{selectedBookIds.length > 0 && (selectedCollection.kind ?? 'manual') === 'manual' && <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3"><span className="text-xs font-semibold text-[var(--ink-ivory)]">{selectedBookIds.length} selected</span><button type="button" onClick={() => bulkMembership('add')} className="quiet-shelf-secondary-action"><CheckSquare className="h-4 w-4" /> Add selected</button><button type="button" onClick={() => bulkMembership('remove')} className="quiet-shelf-secondary-action"><X className="h-4 w-4" /> Remove selected</button></div>}<div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visibleBooks.map((book) => { const inCollection = selectedBooks.some((item) => item.id === book.id); const selected = selectedBookIds.includes(book.id); const readingState = getBookReadingState(book); return <article key={book.id} className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><div className="flex gap-3"><button type="button" onClick={() => onSelectBook(book)} className="shrink-0"><BookCover work={book.work} edition={readingState.activeEdition} progressPercentage={readingState.progressPercentage} isFinished={readingState.isFinished} rating={book.rating} className="h-24 w-16" /></button><div className="min-w-0 flex-1"><button type="button" onClick={() => onSelectBook(book)} className="text-left"><p className="line-clamp-2 font-serif font-bold text-[var(--ink-ivory)]">{book.work.title}</p><p className="truncate text-xs text-[var(--ink-muted)]">{book.work.author}</p></button><p className="mt-2 text-[11px] text-[var(--ink-muted)]">{readingState.status.replaceAll('-', ' ')} · {readingState.progressPercentage}%</p></div></div>{(selectedCollection.kind ?? 'manual') === 'smart' ? <p className="mt-3 text-xs font-semibold text-[var(--ink-gold-bright)]">Matches this smart rule</p> : <div className="mt-3 flex items-center gap-2"><label className="inline-flex min-h-10 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-[var(--ink-border)] px-3 text-xs text-[var(--ink-muted)]"><input type="checkbox" checked={selected} onChange={() => setSelectedBookIds((current) => current.includes(book.id) ? current.filter((id) => id !== book.id) : [...current, book.id])} /> Select</label><button type="button" onClick={() => toggleBook(book)} className={`min-h-10 rounded-xl border px-3 text-xs font-semibold ${inCollection ? 'border-[var(--ink-border-strong)] text-[var(--ink-gold-bright)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>{inCollection ? 'Remove' : 'Add'}</button></div>}</article>; })}</div></section>}

    {isEditorOpen && <div className="fixed inset-0 z-[180] grid place-items-center bg-black/70 p-4"><div className="inkbound-panel max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="inkbound-kicker">Collection Builder</p><h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">{editingId ? 'Edit collection' : 'New collection'}</h2></div><button type="button" onClick={() => setIsEditorOpen(false)} className="quiet-shelf-icon-button" aria-label="Close"><X className="h-5 w-5" /></button></div><div className="mt-5 grid gap-4"><label className="text-xs font-semibold text-[var(--ink-muted)]">Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]" /></label><label className="text-xs font-semibold text-[var(--ink-muted)]">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} rows={3} className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-ivory)]" /></label><div className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold text-[var(--ink-muted)]">Custom banner</p><p className="mt-1 text-[11px] text-[var(--ink-muted)]">Inkbound crops your image to a 3:1 banner and compresses it automatically.</p></div><div className="flex gap-2"><input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void handleBannerFile(event.target.files?.[0])} /><button type="button" disabled={bannerBusy} onClick={() => bannerInputRef.current?.click()} className="quiet-shelf-secondary-action justify-center disabled:opacity-50">{bannerBusy ? 'Preparing…' : bannerUrl ? 'Replace banner' : 'Upload banner'}</button>{bannerUrl && <button type="button" disabled={bannerBusy} onClick={() => { setBannerUrl(''); setBannerError(''); }} className="quiet-shelf-secondary-action justify-center disabled:opacity-50">Remove</button>}</div></div>{bannerUrl && <div className="mt-4 overflow-hidden rounded-xl border border-[var(--ink-border)]"><img src={bannerUrl} alt="Collection banner preview" className="aspect-[3/1] w-full object-cover" /></div>}{bannerError && <p className="mt-3 text-xs text-red-300">{bannerError}</p>}</div><label className="text-xs font-semibold text-[var(--ink-muted)]">Type<select value={kind} onChange={(event) => setKind(event.target.value as CollectionKind)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]"><option value="manual">Manual</option><option value="smart">Smart</option></select></label>{kind === 'smart' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-[var(--ink-muted)]">Rule field<select value={smartField} onChange={(event) => setSmartField(event.target.value as SmartField)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]"><option value="status">Status</option><option value="format">Format</option><option value="rating">Rating at least</option><option value="tag">Tag equals</option><option value="author">Author contains</option><option value="year">Publication year</option></select></label><label className="text-xs font-semibold text-[var(--ink-muted)]">Rule value<input value={smartValue} onChange={(event) => setSmartValue(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]" /></label></div>}<label className="text-xs font-semibold text-[var(--ink-muted)]">Cover book<select value={coverBookId} onChange={(event) => setCoverBookId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]"><option value="">Automatic</option>{books.map((book) => <option key={book.id} value={book.id}>{book.work.title}</option>)}</select></label></div><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setIsEditorOpen(false)} className="quiet-shelf-secondary-action justify-center">Cancel</button><button type="button" onClick={saveCollection} disabled={!name.trim() || bannerBusy} className="quiet-shelf-primary-action justify-center disabled:opacity-40"><FolderHeart className="h-4 w-4" /> Save collection</button></div></div></div>}

    {pendingDelete && <div className="fixed bottom-24 left-1/2 z-[190] flex w-[min(92vw,520px)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-[var(--ink-border-strong)] bg-[var(--ink-surface-raised)] p-4 shadow-2xl"><Trash2 className="h-5 w-5 text-[var(--ink-gold)]" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[var(--ink-ivory)]">Collection removed</p><p className="truncate text-xs text-[var(--ink-muted)]">{pendingDelete.name}</p></div><button type="button" onClick={undoCollectionDelete} className="quiet-shelf-secondary-action"><Undo2 className="h-4 w-4" /> Undo</button></div>}
  </div>;
};