import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Image, Loader2, RefreshCw } from 'lucide-react';
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

function coverAlreadyLinked(asset: StoredManualCover, books: UserBookRecord[]) {
  return books.some((book) => book.editions.some((edition) => edition.coverUrl?.includes(asset.name)));
}

export const ManualCoverRecoveryPanel: React.FC<ManualCoverRecoveryPanelProps> = ({ books }) => {
  const [assets, setAssets] = useState<StoredManualCover[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAssetPath, setSelectedAssetPath] = useState('');
  const [selectedBookId, setSelectedBookId] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoredMessage, setRestoredMessage] = useState<string | null>(null);
  const [showLinked, setShowLinked] = useState(false);

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
      console.error('Inkbound manual cover recovery listing failed.', caught);
      setError('Inkbound could not load the manual cover folder. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAssets();
  }, []);

  const missingCoverBooks = useMemo(
    () => books
      .filter((book) => !activeEditionFor(book)?.coverUrl)
      .sort((a, b) => a.work.title.localeCompare(b.work.title)),
    [books],
  );

  const visibleAssets = useMemo(
    () => assets.filter((asset) => showLinked || !coverAlreadyLinked(asset, books)),
    [assets, books, showLinked],
  );

  const selectedAsset = assets.find((asset) => asset.fullPath === selectedAssetPath) ?? null;
  const selectedBook = books.find((book) => book.id === selectedBookId) ?? null;

  const restoreCover = () => {
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

      // A recovered manual cover is user-authored data. Remove this book from
      // automatic enrichment immediately so a pending background pass cannot
      // touch the edition again before React/cloud state catches up.
      writeImportEnrichmentQueue(
        readImportEnrichmentQueue().filter((item) => item.targetBookId !== selectedBook.id),
      );

      // App.tsx already treats this event as the canonical signal to reload the
      // book collection. The local-storage write above also signals the cloud
      // persistence bridge, so the restored URL is synced back to the account.
      notifyCloudDataUpdated([BOOKS_STORAGE_KEY]);

      setRestoredMessage(`Restored the manual cover for “${selectedBook.work.title}”.`);
      setSelectedAssetPath('');
      setSelectedBookId('');
    } catch (caught) {
      console.error('Inkbound manual cover recovery failed.', caught);
      setError('Inkbound could not reconnect that cover. Nothing was deleted; try again.');
    } finally {
      setRestoring(false);
    }
  };

  if (!auth?.currentUser || !storage) return null;

  return (
    <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="inkbound-kicker">Recovery</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Recover manually uploaded covers</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            These are the original cover files already stored in your Inkbound account. Reconnect a file to a book without uploading it again. Restored covers are marked manual and excluded from metadata retry.
          </p>
        </div>
        <button type="button" onClick={() => void loadAssets()} disabled={loading} className="quiet-shelf-secondary-action shrink-0 justify-center disabled:opacity-40">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh Covers
        </button>
      </div>

      {error && <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-sm text-rose-200">{error}</p>}
      {restoredMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3 text-sm text-emerald-200" role="status">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{restoredMessage}</span>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[var(--ink-muted)]">
          {assets.length.toLocaleString()} stored manual cover{assets.length === 1 ? '' : 's'} · {missingCoverBooks.length.toLocaleString()} book{missingCoverBooks.length === 1 ? '' : 's'} currently missing a cover
        </p>
        <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <input type="checkbox" checked={showLinked} onChange={(event) => setShowLinked(event.target.checked)} />
          Show covers already linked to a book
        </label>
      </div>

      {loading && assets.length === 0 ? (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-5 text-sm text-[var(--ink-muted)]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-gold)]" /> Loading your stored manual covers…
        </div>
      ) : visibleAssets.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--ink-border)] p-7 text-center text-sm text-[var(--ink-muted)]">
          No unlinked manual cover files were found.
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid max-h-[620px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {visibleAssets.map((asset) => {
              const selected = selectedAssetPath === asset.fullPath;
              const linked = coverAlreadyLinked(asset, books);
              return (
                <button
                  key={asset.fullPath}
                  type="button"
                  onClick={() => setSelectedAssetPath(asset.fullPath)}
                  className={`min-w-0 rounded-2xl border p-2 text-left transition ${selected ? 'border-[var(--ink-gold)] bg-[var(--ink-gold)]/10' : 'border-[var(--ink-border)] bg-[var(--ink-surface-soft)]'}`}
                >
                  <img src={asset.url} alt="Stored manual book cover" className="aspect-[2/3] w-full rounded-xl object-cover" loading="lazy" />
                  <p className="mt-2 truncate text-[10px] text-[var(--ink-muted)]">{asset.name}</p>
                  <p className="mt-1 text-[10px] font-bold text-[var(--ink-gold)]">
                    {linked ? 'Already linked' : asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : 'Stored cover'}
                  </p>
                </button>
              );
            })}
          </div>

          <aside className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
            <div className="flex items-center gap-2">
              <Image className="h-5 w-5 text-[var(--ink-gold)]" />
              <h3 className="font-serif text-lg font-bold text-[var(--ink-ivory)]">Reconnect selected cover</h3>
            </div>

            {selectedAsset ? (
              <img src={selectedAsset.url} alt="Selected stored manual cover" className="mx-auto mt-4 max-h-72 rounded-xl object-contain" />
            ) : (
              <div className="mt-4 grid h-56 place-items-center rounded-xl border border-dashed border-[var(--ink-border)] text-center text-xs text-[var(--ink-muted)]">
                Select a cover thumbnail first.
              </div>
            )}

            <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]" htmlFor="manual-cover-recovery-book">
              Book missing this cover
            </label>
            <select
              id="manual-cover-recovery-book"
              value={selectedBookId}
              onChange={(event) => setSelectedBookId(event.target.value)}
              className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] px-3 text-sm text-[var(--ink-ivory)] outline-none"
            >
              <option value="">Choose a book…</option>
              {missingCoverBooks.map((book) => (
                <option key={book.id} value={book.id}>{book.work.title} — {book.work.author}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={restoreCover}
              disabled={!selectedAsset || !selectedBook || restoring}
              className="quiet-shelf-primary-action mt-4 min-h-11 w-full justify-center disabled:opacity-40"
            >
              {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {restoring ? 'Restoring…' : 'Restore This Cover'}
            </button>

            <p className="mt-3 text-xs leading-5 text-[var(--ink-muted)]">
              This only reconnects the existing Storage file. It does not upload another copy or change your title, author, rating, status, notes, or reading history.
            </p>
          </aside>
        </div>
      )}
    </section>
  );
};