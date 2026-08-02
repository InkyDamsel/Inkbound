import React, { useMemo, useState } from 'react';
import { BookOpen, FolderHeart, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { UserBookRecord } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { ResponsiveGrid } from '../layout/responsive';
import { BookCover } from './BookCover';

interface CollectionDefinition {
  id: string;
  name: string;
  description: string;
  emoji: string;
  accent: string;
  createdAt: string;
}

interface CollectionsScreenProps {
  books: UserBookRecord[];
  onUpdateBook: (book: UserBookRecord) => void;
  onSelectBook: (book: UserBookRecord) => void;
}

const COLLECTIONS_STORAGE_KEY = 'inkbound_collection_definitions';
const COLLECTION_VIEW_STORAGE_KEY = 'inkbound_collection_view';

const starterCollections: CollectionDefinition[] = [
  {
    id: 'comfort-reads',
    name: 'Comfort Reads',
    description: 'Stories worth returning to whenever you need somewhere familiar.',
    emoji: '☕',
    accent: 'from-[#76586a] to-[#382b40]',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'spooky-season',
    name: 'Spooky Season',
    description: 'Atmospheric, unsettling, and perfect for long autumn nights.',
    emoji: '🕯️',
    accent: 'from-[#694a58] to-[#251b2a]',
    createdAt: new Date().toISOString(),
  },
];

const makeCollectionId = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}`;

export const CollectionsScreen: React.FC<CollectionsScreenProps> = ({
  books,
  onUpdateBook,
  onSelectBook,
}) => {
  const [collections, setCollections] = usePersistentState<CollectionDefinition[]>(
    COLLECTIONS_STORAGE_KEY,
    starterCollections,
  );
  const [selectedCollectionId, setSelectedCollectionId] = usePersistentState<string | null>(
    COLLECTION_VIEW_STORAGE_KEY,
    null,
  );
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState('📚');
  const [searchQuery, setSearchQuery] = useState('');

  const selectedCollection = collections.find((collection) => collection.id === selectedCollectionId);
  const selectedBooks = selectedCollection
    ? books.filter((book) => book.collections.includes(selectedCollection.name))
    : [];

  const filteredBooks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return books;
    return books.filter(
      (book) =>
        book.work.title.toLowerCase().includes(query) ||
        book.work.author.toLowerCase().includes(query),
    );
  }, [books, searchQuery]);

  const openNewCollection = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setEmoji('📚');
    setIsEditorOpen(true);
  };

  const openEditCollection = (collection: CollectionDefinition) => {
    setEditingId(collection.id);
    setName(collection.name);
    setDescription(collection.description);
    setEmoji(collection.emoji);
    setIsEditorOpen(true);
  };

  const saveCollection = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    if (editingId) {
      const previous = collections.find((collection) => collection.id === editingId);
      setCollections((current) =>
        current.map((collection) =>
          collection.id === editingId
            ? { ...collection, name: trimmedName, description: description.trim(), emoji }
            : collection,
        ),
      );
      if (previous && previous.name !== trimmedName) {
        books.forEach((book) => {
          if (!book.collections.includes(previous.name)) return;
          onUpdateBook({
            ...book,
            collections: book.collections.map((item) => (item === previous.name ? trimmedName : item)),
          });
        });
      }
    } else {
      const newCollection: CollectionDefinition = {
        id: makeCollectionId(trimmedName),
        name: trimmedName,
        description: description.trim(),
        emoji,
        accent: 'from-[#76586a] to-[#382b40]',
        createdAt: new Date().toISOString(),
      };
      setCollections((current) => [...current, newCollection]);
      setSelectedCollectionId(newCollection.id);
    }

    setIsEditorOpen(false);
  };

  const deleteCollection = (collection: CollectionDefinition) => {
    if (!window.confirm(`Delete “${collection.name}”? Books will remain in your library.`)) return;
    setCollections((current) => current.filter((item) => item.id !== collection.id));
    books.forEach((book) => {
      if (!book.collections.includes(collection.name)) return;
      onUpdateBook({
        ...book,
        collections: book.collections.filter((item) => item !== collection.name),
      });
    });
    if (selectedCollectionId === collection.id) setSelectedCollectionId(null);
  };

  const toggleBook = (book: UserBookRecord) => {
    if (!selectedCollection) return;
    const isIncluded = book.collections.includes(selectedCollection.name);
    onUpdateBook({
      ...book,
      collections: isIncluded
        ? book.collections.filter((item) => item !== selectedCollection.name)
        : [...book.collections, selectedCollection.name],
    });
  };

  return (
    <div className="space-y-7 pb-24">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inkbound-kicker">Personal Shelves</p>
          <h1 className="font-serif text-3xl font-bold text-[var(--ink-ivory)]">Collections</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">
            Build private shelves around moods, seasons, favorites, or any reading life you want to remember.
          </p>
        </div>
        <button type="button" onClick={openNewCollection} className="quiet-shelf-primary-action px-5">
          <Plus className="h-4 w-4" /> New Collection
        </button>
      </header>

      <ResponsiveGrid minItemWidth={240} maxColumns={3} gap={16}>
        {collections.map((collection) => {
          const count = books.filter((book) => book.collections.includes(collection.name)).length;
          return (
            <article key={collection.id} className="inkbound-panel overflow-hidden rounded-3xl">
              <button
                type="button"
                onClick={() => setSelectedCollectionId(collection.id)}
                className={`block h-28 w-full bg-gradient-to-br ${collection.accent} p-5 text-left`}
              >
                <span className="text-3xl" aria-hidden="true">{collection.emoji}</span>
              </button>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-xl font-bold text-[var(--ink-ivory)]">{collection.name}</h2>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">{count} {count === 1 ? 'book' : 'books'}</p>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => openEditCollection(collection)} className="quiet-shelf-icon-button" aria-label={`Edit ${collection.name}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => deleteCollection(collection)} className="quiet-shelf-icon-button" aria-label={`Delete ${collection.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-[var(--ink-muted)]">{collection.description || 'A private Inkbound collection.'}</p>
              </div>
            </article>
          );
        })}
      </ResponsiveGrid>

      {selectedCollection && (
        <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="inkbound-kicker">Open Collection</p>
              <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">
                {selectedCollection.emoji} {selectedCollection.name}
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Select books below to add or remove them.</p>
            </div>
            <button type="button" onClick={() => setSelectedCollectionId(null)} className="quiet-shelf-secondary-action">
              Close
            </button>
          </div>

          {selectedBooks.length > 0 && (
            <div className="mt-6">
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">On this shelf</p>
              <ResponsiveGrid minItemWidth={150} maxColumns={6} gap={14}>
                {selectedBooks.map((book) => {
                  const edition = book.editions.find((item) => item.id === book.activeEditionId) || book.editions[0];
                  return (
                    <button key={book.id} type="button" onClick={() => onSelectBook(book)} className="text-left">
                      <BookCover work={book.work} edition={edition} size="lg" />
                      <p className="mt-2 line-clamp-1 text-sm font-semibold text-[var(--ink-ivory)]">{book.work.title}</p>
                    </button>
                  );
                })}
              </ResponsiveGrid>
            </div>
          )}

          <div className="relative mt-7">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Find a book to add"
              className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] pl-11 pr-4 text-sm text-[var(--ink-ivory)] outline-none"
            />
          </div>

          <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {filteredBooks.map((book) => {
              const included = book.collections.includes(selectedCollection.name);
              return (
                <button
                  key={book.id}
                  type="button"
                  onClick={() => toggleBook(book)}
                  className="flex min-h-14 w-full items-center justify-between gap-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 text-left"
                >
                  <span className="min-w-0">
                    <strong className="block truncate text-sm text-[var(--ink-ivory)]">{book.work.title}</strong>
                    <small className="text-[var(--ink-muted)]">{book.work.author}</small>
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${included ? 'bg-[var(--ink-gold)] text-[#241722]' : 'border border-[var(--ink-border)] text-[var(--ink-muted)]'}`}>
                    {included ? 'Added' : 'Add'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {collections.length === 0 && (
        <div className="rounded-3xl border border-dashed border-[var(--ink-border)] p-10 text-center">
          <FolderHeart className="mx-auto h-10 w-10 text-[var(--ink-gold)]" />
          <h2 className="mt-4 font-serif text-2xl text-[var(--ink-ivory)]">Create your first collection</h2>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Every collection stays private and personal.</p>
        </div>
      )}

      {isEditorOpen && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <section className="inkbound-panel w-full max-w-lg rounded-t-3xl p-5 sm:rounded-3xl sm:p-7" role="dialog" aria-modal="true" aria-label="Collection editor">
            <div className="flex items-center justify-between">
              <div>
                <p className="inkbound-kicker">Private Shelf</p>
                <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">{editingId ? 'Edit Collection' : 'New Collection'}</h2>
              </div>
              <button type="button" onClick={() => setIsEditorOpen(false)} className="quiet-shelf-icon-button" aria-label="Close editor"><X /></button>
            </div>
            <div className="mt-6 grid gap-4">
              <label className="text-sm font-semibold text-[var(--ink-ivory)]">Emoji
                <input value={emoji} onChange={(event) => setEmoji(event.target.value.slice(0, 4))} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]" />
              </label>
              <label className="text-sm font-semibold text-[var(--ink-ivory)]">Name
                <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-[var(--ink-ivory)]" />
              </label>
              <label className="text-sm font-semibold text-[var(--ink-ivory)]">Description
                <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-[var(--ink-ivory)]" />
              </label>
            </div>
            <button type="button" onClick={saveCollection} disabled={!name.trim()} className="quiet-shelf-primary-action mt-6 min-h-12 w-full justify-center disabled:opacity-50">
              <BookOpen className="h-4 w-4" /> Save Collection
            </button>
          </section>
        </div>
      )}
    </div>
  );
};
