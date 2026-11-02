import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CalendarDays, ImagePlus, MapPin, Search, Trash2, Undo2, X } from 'lucide-react';
import { UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { PhotoMemoryRecord } from '../features/memories/photoMemoryStore';
import { usePhotoMemories } from '../features/memories/usePhotoMemories';

export type PhotoMemory = PhotoMemoryRecord;

interface PhotoMemoriesScreenProps {
  books: UserBookRecord[];
  onSelectBook: (book: UserBookRecord) => void;
}

interface DeletedPhotoMemory {
  memory: PhotoMemory;
  index: number;
}

const PHOTO_FILTER_KEY = 'inkbound_photo_memory_filter';
const PHOTO_MEMORIES_BACKGROUND_URL = '/assets/photos-memories/cozy-photo-background.png';
const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
const UNDO_DELETE_MS = 7000;

const localDateKey = (value = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('The image could not be prepared.'));
      image.onload = () => {
        const maxDimension = 1080;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Image processing is unavailable on this device.'));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const PhotoMemoriesScreen: React.FC<PhotoMemoriesScreenProps> = ({ books, onSelectBook }) => {
  const [memories, setMemories] = usePhotoMemories();
  const [filter, setFilter] = usePersistentState<'all' | 'linked' | 'unlinked'>(PHOTO_FILTER_KEY, 'all');
  const [search, setSearch] = useState('');
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState<PhotoMemory | null>(null);
  const [imageData, setImageData] = useState('');
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(localDateKey);
  const [bookId, setBookId] = useState('');
  const [relatedBookSearch, setRelatedBookSearch] = useState('');
  const [error, setError] = useState('');
  const [deletedMemory, setDeletedMemory] = useState<DeletedPhotoMemory | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!deletedMemory) return undefined;
    const timer = window.setTimeout(() => setDeletedMemory(null), UNDO_DELETE_MS);
    return () => window.clearTimeout(timer);
  }, [deletedMemory]);

  useEffect(() => {
    if (!selectedMemory) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedMemory(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMemory]);

  const matchingRelatedBooks = useMemo(() => {
    const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
    const query = normalize(relatedBookSearch);
    return books.filter(book => !query || [book.work.title, book.work.author, book.work.seriesName ?? ''].some(value => normalize(value).includes(query)))
      .sort((a, b) => a.work.title.localeCompare(b.work.title, undefined, { sensitivity: 'base', numeric: true }));
  }, [books, relatedBookSearch]);

  const bookById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books]);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleMemories = memories
    .filter((memory) => filter === 'all' || (filter === 'linked' ? Boolean(memory.bookId) : !memory.bookId))
    .filter((memory) => {
      if (!normalizedSearch) return true;
      const book = memory.bookId ? bookById.get(memory.bookId) : undefined;
      return [memory.caption, memory.location, book?.work.title, book?.work.author]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const resetComposer = () => {
    setImageData('');
    setCaption('');
    setLocation('');
    setDate(localDateKey());
    setBookId('');
    setRelatedBookSearch('');
    setError('');
    setIsComposerOpen(false);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose a photo file.');
      return;
    }
    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      setError('Choose a photo smaller than 12 MB. Large camera originals should be reduced before adding them to Inkbound.');
      event.target.value = '';
      return;
    }
    try {
      setError('');
      setImageData(await resizeImage(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The photo could not be prepared.');
    } finally {
      event.target.value = '';
    }
  };

  const saveMemory = () => {
    if (!imageData) {
      setError('Add a photo before saving this memory.');
      return;
    }
    const memory: PhotoMemory = {
      id: crypto.randomUUID(), imageData, caption: caption.trim(), date,
      location: location.trim(), bookId: bookId || undefined, createdAt: new Date().toISOString(),
    };
    setMemories((current) => [memory, ...current]);
    resetComposer();
  };

  const deleteMemory = (id: string) => {
    const index = memories.findIndex((memory) => memory.id === id);
    if (index < 0) return;
    setDeletedMemory({ memory: memories[index], index });
    setMemories((current) => current.filter((memory) => memory.id !== id));
  };

  const undoDeleteMemory = () => {
    if (!deletedMemory) return;
    setMemories((current) => {
      if (current.some((memory) => memory.id === deletedMemory.memory.id)) return current;
      const next = [...current];
      next.splice(Math.min(deletedMemory.index, next.length), 0, deletedMemory.memory);
      return next;
    });
    setDeletedMemory(null);
  };

  return (
    <section className="space-y-6 pb-12">
      <header
        className="inkbound-artwork-hero inkbound-panel relative overflow-hidden rounded-3xl p-6 sm:p-8"
        style={{
          backgroundImage: `linear-gradient(90deg, rgba(12,8,15,.86) 0%, rgba(12,8,15,.62) 42%, rgba(12,8,15,.22) 76%, rgba(12,8,15,.12) 100%), url("${PHOTO_MEMORIES_BACKGROUND_URL}")`,
          backgroundPosition: 'center center',
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div className="relative z-10 flex min-h-[190px] flex-col justify-end gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl rounded-2xl border border-white/10 bg-black/20 p-5 backdrop-blur-[2px]" style={{ textShadow: '0 2px 10px rgba(0,0,0,.72)' }}>
            <span className="text-xs font-bold uppercase tracking-[0.22em] text-white/75">Private visual journal</span>
            <h2 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Photo Memories</h2>
            <p className="mt-3 text-sm leading-7 text-white/80 sm:text-base">
              Preserve reading nooks, annotated pages, bookstore visits, vacations, and the everyday moments surrounding a book.
            </p>
          </div>
          <button type="button" className="quiet-shelf-primary-action justify-center" onClick={() => setIsComposerOpen(true)}>
            <ImagePlus /> Add Photo Memory
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {(['all', 'linked', 'unlinked'] as const).map((value) => (
            <button key={value} type="button" onClick={() => setFilter(value)} className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold capitalize ${filter === value ? 'border-[var(--ink-gold)] bg-[var(--ink-surface-raised)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)]'}`}>
              {value === 'linked' ? 'Linked to books' : value === 'unlinked' ? 'Life moments' : 'All memories'}
            </button>
          ))}
        </div>
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4">
          <Search className="h-4 w-4 text-[var(--ink-muted)]" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search memories..." className="w-full bg-transparent text-sm text-[var(--ink-ivory)] outline-none md:w-56" />
        </label>
      </div>

      {visibleMemories.length === 0 ? (
        <div className="inkbound-panel rounded-3xl px-6 py-16 text-center">
          <Camera className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
          <h3 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">Your visual reading journal starts here</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--ink-muted)]">Add a photo of your reading nook, a favorite annotation, a bookstore trip, or any moment you want to remember.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visibleMemories.map((memory) => {
            const book = memory.bookId ? bookById.get(memory.bookId) : undefined;
            return (
              <article key={memory.id} className="inkbound-panel min-w-0 overflow-hidden rounded-3xl">
                <button type="button" onClick={() => setSelectedMemory(memory)} className="group block aspect-[4/3] w-full overflow-hidden bg-[var(--ink-surface-soft)] text-left" aria-label={`Open ${memory.caption || 'photo memory'} full size`}>
                  <img src={memory.imageData} alt={memory.caption || 'Reading memory'} className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]" />
                </button>
                <div className="space-y-3 p-4 sm:p-5">
                  {memory.caption && <p className="line-clamp-3 font-serif text-lg leading-6 text-[var(--ink-ivory)]">{memory.caption}</p>}
                  <div className="flex flex-wrap gap-3 text-xs text-[var(--ink-muted)]">
                    <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{new Date(`${memory.date}T12:00:00`).toLocaleDateString()}</span>
                    {memory.location && <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{memory.location}</span></span>}
                  </div>
                  {book && <button type="button" onClick={() => onSelectBook(book)} className="block min-h-11 max-w-full truncate py-2 text-left text-sm font-semibold text-[var(--ink-gold-bright)] hover:underline">{book.work.title} · {book.work.author}</button>}
                  <button type="button" onClick={() => deleteMemory(memory.id)} className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-[var(--ink-muted)] hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /> Delete memory</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selectedMemory && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label={selectedMemory.caption || 'Photo memory'} onClick={() => setSelectedMemory(null)}>
          <button type="button" onClick={() => setSelectedMemory(null)} className="quiet-shelf-icon-button absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-10 h-11 w-11 bg-black/55 text-white" aria-label="Close full photo"><X /></button>
          <div className="flex max-h-[calc(100dvh-2rem)] max-w-[min(96vw,1200px)] flex-col items-center gap-3" onClick={(event) => event.stopPropagation()}>
            <img src={selectedMemory.imageData} alt={selectedMemory.caption || 'Reading memory'} className="max-h-[calc(100dvh-7rem)] max-w-full rounded-2xl object-contain shadow-2xl" />
            {(selectedMemory.caption || selectedMemory.location) && <div className="max-w-3xl rounded-2xl bg-black/55 px-4 py-3 text-center backdrop-blur-sm">{selectedMemory.caption && <p className="font-serif text-base text-white sm:text-lg">{selectedMemory.caption}</p>}{selectedMemory.location && <p className="mt-1 text-xs text-white/70">{selectedMemory.location}</p>}</div>}
          </div>
        </div>
      )}

      {isComposerOpen && (
        <div className="fixed inset-0 z-[160] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={resetComposer}>
          <section className="inkbound-panel max-h-[100dvh] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-t-3xl px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:max-h-[92dvh] sm:rounded-3xl sm:p-7" role="dialog" aria-modal="true" aria-label="Add photo memory" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-4"><div><span className="inkbound-eyebrow">New scrapbook entry</span><h3 className="mt-1 font-serif text-2xl text-[var(--ink-ivory)]">Add a Photo Memory</h3></div><button type="button" className="quiet-shelf-icon-button h-11 w-11 shrink-0" onClick={resetComposer} aria-label="Close photo memory composer"><X /></button></div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-5 flex min-h-56 w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[var(--ink-border)] bg-[var(--ink-surface-soft)]">{imageData ? <img src={imageData} alt="Photo preview" className="max-h-96 w-full object-contain" /> : <span className="flex flex-col items-center gap-3 text-sm font-semibold text-[var(--ink-muted)]"><ImagePlus className="h-9 w-9 text-[var(--ink-gold)]" />Choose a photo</span>}</button>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">Caption</span><textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={3} placeholder="What do you want to remember?" className="w-full rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-ivory)] outline-none" /></label>
              <label><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">Date</span><input type="date" max={localDateKey()} value={date} onChange={(event) => setDate(event.target.value)} className="min-h-11 w-full rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]" /></label>
              <label><span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">Location</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Home, library, vacation..." className="min-h-11 w-full rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)] outline-none" /></label>
              <div className="sm:col-span-2"><label htmlFor="photo-memory-book-search" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">Related book (optional)</label><input id="photo-memory-book-search" type="search" value={relatedBookSearch} onChange={event => setRelatedBookSearch(event.target.value)} placeholder="Search title, author, or series..." className="mb-2 min-h-11 w-full rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--ink-gold)]" /><select aria-label="Related book" value={bookId} onChange={event => { setBookId(event.target.value); setRelatedBookSearch(''); }} className="min-h-11 w-full rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)]"><option value="">Not linked to a book</option>{bookId && !matchingRelatedBooks.some(book => book.id === bookId) && books.filter(book => book.id === bookId).map(book => <option key={book.id} value={book.id}>{book.work.title} — {book.work.author}</option>)}{matchingRelatedBooks.slice(0, relatedBookSearch.trim() ? 100 : 30).map(book => <option key={book.id} value={book.id}>{book.work.title} — {book.work.author}</option>)}</select><p className="mt-1 text-xs text-[var(--ink-muted)]">{relatedBookSearch.trim() ? `${matchingRelatedBooks.length.toLocaleString()} matching books` : 'Type to search your library; showing the first 30 books.'}</p></div>
            </div>
            {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={resetComposer} className="quiet-shelf-secondary-action w-full justify-center sm:w-auto">Cancel</button><button type="button" onClick={saveMemory} className="quiet-shelf-primary-action w-full justify-center sm:w-auto"><Camera />Save Memory</button></div>
          </section>
        </div>
      )}

      {deletedMemory && (
        <div className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[220] mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-4 py-3 shadow-2xl sm:bottom-6" role="status" aria-live="polite">
          <span className="min-w-0 text-sm font-semibold text-[var(--ink-ivory)]">Photo memory deleted.</span>
          <button type="button" onClick={undoDeleteMemory} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[var(--ink-gold-bright)]"><Undo2 className="h-4 w-4" /> Undo</button>
        </div>
      )}
    </section>
  );
};