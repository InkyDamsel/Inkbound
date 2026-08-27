import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Image, LibraryBig, Loader2, RefreshCw, Search } from 'lucide-react';
import { getDownloadURL, getMetadata, listAll, ref } from 'firebase/storage';
import type { UserBookRecord } from '../types';
import { auth, storage } from '../lib/firebase';
import { getRuntimeStorage } from '../platform/runtimeStorage';
import { notifyCloudDataUpdated } from '../features/sync/cloudSyncEvents';
import { readImportEnrichmentQueue, writeImportEnrichmentQueue } from '../features/import/libraryEnrichment';

interface StoredManualCover {
  name: string;
  fullPath: string;
  url: string;
  updatedAt?: string;
}

interface ManualCoverRecoveryPanelProps {
  books: UserBookRecord[];
}

const BOOKS_STORAGE_KEY = 'inkbound_books';

function activeEditionFor(book: UserBookRecord) {
  return book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
}

function linkedBooksFor(asset: StoredManualCover, books: UserBookRecord[]) {
  return books.filter((book) => book.editions.some((edition) => edition.coverUrl?.includes(asset.name)));
}

export const ManualCoverRecoveryPanel: React.FC<ManualCoverRecoveryPanelProps> = ({ books }) => {
  const [assets, setAssets] = useState<StoredManualCover[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAssetPath, setSelectedAssetPath] = useState('');
  const [selectedBookId, setSelectedBookId] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoredMessage, setRestoredMessage] = useState<string | null>(null);
  const [showUnusedOnly, setShowUnusedOnly] = useState(false);
  const [coverQuery, setCoverQuery] = useState('');
  const [bookQuery, setBookQuery] = useState('');

  const loadAssets = async () => {
    const user = auth?.currentUser;
    if (!user || !storage) {
      setError('Sign in to the same Inkbound account that uploaded the covers, then try again.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const folder = ref(storage, `users/${user.uid}/book-covers/manual`);
      const listing = await listAll(folder);
      const loaded = await Promise.all(listing.items.map(async (itemRef) => {
        const [url, metadata] = await Promise.all([
          getDownloadURL(itemRef),
          getMetadata(itemRef).catch(() => null),
        ]);
        return {
          name: itemRef.name,
          fullPath: itemRef.fullPath,
          url,
          updatedAt: metadata?.updated ?? metadata?.timeCreated,
        } satisfies StoredManualCover;
      }));
      loaded.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
      setAssets(loaded);
    } catch (caught) {
      console.error('Inkbound manual cover library listing failed.', caught);
      setError('Inkbound could not load your Manual Cover Library. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAssets();
  }, []);

  const selectedAsset = assets.find((asset) => asset.fullPath === selectedAssetPath) ?? null;
  const selectedBook = books.find((book) => book.id === selectedBookId) ?? null;
  const selectedBookEdition = selectedBook ? activeEditionFor(selectedBook) : undefined;

  const unusedCount = useMemo(
    () => assets.filter((asset) => linkedBooksFor(asset, books).length === 0).length,
    [assets, books],
  );

  const visibleAssets = useMemo(() => {
    const normalizedQuery = coverQuery.trim().toLowerCase();
    return assets.filter((asset) => {
      const linked = linkedBooksFor(asset, books);
      if (showUnusedOnly && linked.length > 0) return false;
      if (!normalizedQuery) return true;
      return asset.name.toLowerCase().includes(normalizedQuery)
        || linked.some((book) => `${book.work.title} ${book.work.author}`.toLowerCase().includes(normalizedQuery));
    });
  }, [assets, books, coverQuery, showUnusedOnly]);

  const visibleBooks = useMemo(() => {
    const normalizedQuery = bookQuery.trim().toLowerCase();
    return [...books]
      .filter((book) => !normalizedQuery || `${book.work.title} ${book.work.author}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => a.work.title.localeCompare(b.work.title));
  }, [books, bookQuery]);

  const useCover = () => {
    if (!selectedAsset || !selectedBook || restoring) return;
    const activeEdition = activeEditionFor(selectedBook);
    if (!activeEdition) {
      setError('That book does not have an edition to attach the cover to.');
      return;
    }

    setRestoring(true);
    setError(null);
    setRestoredMessage(null);
    try {
      const updatedBooks = books.map((book) => {
        if (book.id !== selectedBook.id) return book;
        return {
          ...book,
          editions: book.editions.map((edition) => edition.id === activeEdition.id
            ? {
                ...edition,
                coverUrl: selectedAsset.url,
                externalSource: 'manual' as const,
              }
            : edition),
        };
      });

      const runtimeStorage = getRuntimeStorage();
      runtimeStorage.setItem(BOOKS_STORAGE_KEY, JSON.stringify(updatedBooks));

      writeImportEnrichmentQueue(
        readImportEnrichmentQueue().filter((item) => item.targetBookId !== selectedBook.id),
      );

      notifyCloudDataUpdated([BOOKS_STORAGE_KEY]);

      setRestoredMessage(`Using this manual cover for “${selectedBook.work.title}”.`);
      setSelectedBookId('');
      setBookQuery('');
    } catch (caught) {
      console.error('Inkbound manual cover assignment failed.', caught);
      setError('Inkbound could not attach that cover. Nothing was deleted; try again.');
    } finally {
      setRestoring(false);
    }
  };

  if (!auth?.currentUser || !storage) return null;

  return (
    <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="inkbound-kicker">Your Covers</p>
          <div className="flex items-center gap-2">
            <LibraryBig className="h-6 w-6 text-[var(--ink-gold)]" />
            <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Manual Cover Library</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Every cover you manually upload stays in your private Inkbound cover library. Reuse a previous cover, reconnect an unlinked file, or replace a book cover without uploading the image again. Manual choices are protected from metadata retry.
          </p>
        </div>
        <button type="button" onClick={() => void loadAssets()} disabled={loading} className="quiet-shelf-secondary-action shrink-0 justify-center disabled:opacity-40">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh Library
        </button>
      </div>

      {error && <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-sm text-rose-200">{error}</p>}
      {restoredMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3 text-sm text-emerald-200" role="status">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{restoredMessage}</span>
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Stored covers</p>
          <p className="mt-1 font-serif text-2xl font-bold text-[var(--ink-ivory)]">{assets.length.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Unused covers</p>
          <p className="mt-1 font-serif text-2xl font-bold text-[var(--ink-ivory)]">{unusedCount.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Books in library</p>
          <p className="mt-1 font-serif text-2xl font-bold text-[var(--ink-ivory)]">{books.length.toLocaleString()}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
          <input
            type="search"
            value={coverQuery}
            onChange={(event) => setCoverQuery(event.target.value)}
            placeholder="Search covers by linked book title or author"
            className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] pl-11 pr-4 text-sm text-[var(--ink-ivory)] outline-none"
          />
        </label>
        <label className="flex min-h-12 items-center gap-2 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-xs text-[var(--ink-muted)]">
          <input type="checkbox" checked={showUnusedOnly} onChange={(event) => setShowUnusedOnly(event.target.checked)} />
          Show unused only
        </label>
      </div>

      {loading && assets.length === 0 ? (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-5 text-sm text-[var(--ink-muted)]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-gold)]" /> Loading your Manual Cover Library…
        </div>
      ) : visibleAssets.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--ink-border)] p-7 text-center text-sm text-[var(--ink-muted)]">
          {assets.length === 0 ? 'No manual covers have been uploaded yet.' : 'No covers match this filter.'}
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid max-h-[650px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {visibleAssets.map((asset) => {
              const selected = selectedAssetPath === asset.fullPath;
              const linkedBooks = linkedBooksFor(asset, books);
              return (
                <button
                  key={asset.fullPath}
                  type="button"
                  onClick={() => setSelectedAssetPath(asset.fullPath)}
                  className={`min-w-0 rounded-2xl border p-2 text-left transition ${selected ? 'border-[var(--ink-gold)] bg-[var(--ink-gold)]/10' : 'border-[var(--ink-border)] bg-[var(--ink-surface-soft)]'}`}
                >
                  <img src={asset.url} alt="Manual book cover" className="aspect-[2/3] w-full rounded-xl object-cover" loading="lazy" />
                  <p className="mt-2 line-clamp-2 text-xs font-bold text-[var(--ink-ivory)]">
                    {linkedBooks.length > 0 ? linkedBooks.map((book) => book.work.title).join(', ') : 'Unused cover'}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-[var(--ink-muted)]">
                    {linkedBooks.length > 0 ? linkedBooks.map((book) => book.work.author).join(', ') : asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : asset.name}
                  </p>
                </button>
              );
            })}
          </div>

          <aside className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
            <div className="flex items-center gap-2">
              <Image className="h-5 w-5 text-[var(--ink-gold)]" />
              <h3 className="font-serif text-lg font-bold text-[var(--ink-ivory)]">Use selected cover</h3>
            </div>

            {selectedAsset ? (
              <div className="mt-4">
                <img src={selectedAsset.url} alt="Selected manual cover" className="mx-auto max-h-72 rounded-xl object-contain" />
                {linkedBooksFor(selectedAsset, books).length > 0 && (
                  <p className="mt-3 text-xs leading-5 text-[var(--ink-muted)]">
                    Currently used by: {linkedBooksFor(selectedAsset, books).map((book) => book.work.title).join(', ')}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4 grid h-56 place-items-center rounded-xl border border-dashed border-[var(--ink-border)] text-center text-xs text-[var(--ink-muted)]">
                Select a cover thumbnail first.
              </div>
            )}

            <label className="relative mt-4 block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                type="search"
                value={bookQuery}
                onChange={(event) => setBookQuery(event.target.value)}
                placeholder="Find a book by title or author"
                className="min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] pl-10 pr-3 text-sm text-[var(--ink-ivory)] outline-none"
              />
            </label>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Choose a book</span>
              <span className="text-[11px] text-[var(--ink-muted)]">{visibleBooks.length.toLocaleString()} of {books.length.toLocaleString()}</span>
            </div>
            <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] p-1">
              {visibleBooks.map((book) => {
                const isSelected = selectedBookId === book.id;
                const edition = activeEditionFor(book);
                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => setSelectedBookId(book.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${isSelected ? 'bg-[var(--ink-gold)]/15 text-[var(--ink-gold)]' : 'text-[var(--ink-ivory)] hover:bg-[var(--ink-surface-raised)]'}`}
                  >
                    <span className="block break-words font-semibold">{book.work.title}</span>
                    <span className="mt-0.5 block break-words text-xs text-[var(--ink-muted)]">
                      {book.work.author}{edition?.coverUrl ? ' · has cover' : ' · missing cover'}
                    </span>
                  </button>
                );
              })}
              {visibleBooks.length === 0 && (
                <p className="p-4 text-center text-xs text-[var(--ink-muted)]">No books match that search.</p>
              )}
            </div>

            {selectedBook && selectedBookEdition?.coverUrl && (
              <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-950/15 p-3 text-xs leading-5 text-amber-200">
                “{selectedBook.work.title}” already has a cover. Using this one will replace the current cover reference, but the old manual file remains safely stored in your Manual Cover Library.
              </p>
            )}

            <button
              type="button"
              onClick={useCover}
              disabled={!selectedAsset || !selectedBook || restoring}
              className="quiet-shelf-primary-action mt-4 min-h-11 w-full justify-center disabled:opacity-40"
            >
              {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {restoring ? 'Applying…' : 'Use This Cover'}
            </button>

            <p className="mt-3 text-xs leading-5 text-[var(--ink-muted)]">
              Inkbound reuses the existing Storage file rather than uploading a duplicate. Choosing a cover is treated as a manual edit, so automatic metadata retry will not overwrite it.
            </p>
          </aside>
        </div>
      )}
    </section>
  );
};