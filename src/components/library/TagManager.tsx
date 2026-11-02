import { tagIdentity, uniquePrivateTags } from '../../features/library/privateTags';
import React, { useMemo, useState } from 'react';
import { Pencil, Tag, Trash2, X } from 'lucide-react';
import { replaceCanonicalLibrary } from '../../features/library/libraryMutations';
import { readRuntimeJson } from '../../platform/runtimeStorage';
import { SYNC_STORAGE_KEYS } from '../../features/sync/storageKeys';
import type { UserBookRecord } from '../../types';

interface TagManagerProps {
  books: UserBookRecord[];
}

interface TagSummary {
  name: string;
  normalized: string;
  count: number;
}

const normalizeTag = tagIdentity;
// Read the canonical working copy at click time, not a possibly stale React prop.
const currentLibrary = (fallback: UserBookRecord[]): UserBookRecord[] =>
  readRuntimeJson<UserBookRecord[]>(SYNC_STORAGE_KEYS.books, fallback);

export const TagManager: React.FC<TagManagerProps> = ({ books }) => {
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingTag, setDeletingTag] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const tags = useMemo<TagSummary[]>(() => {
    const byNormalized = new Map<string, TagSummary>();
    books.forEach((book) => {
      const seenOnBook = new Set<string>();
      (book.privateTags ?? []).forEach((rawTag) => {
        const name = rawTag.trim();
        const normalized = normalizeTag(name);
        if (!normalized || seenOnBook.has(normalized)) return;
        seenOnBook.add(normalized);
        const existing = byNormalized.get(normalized);
        if (existing) existing.count += 1;
        else byNormalized.set(normalized, { name, normalized, count: 1 });
      });
    });
    return [...byNormalized.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [books]);

  const saveRename = (oldNormalized: string) => {
    const nextName = editingName.trim();
    const nextNormalized = normalizeTag(nextName);
    if (!nextName) {
      setMessage('Tag names cannot be blank.');
      return;
    }

    const nextBooks = currentLibrary(books).map((book) => {
      const currentTags = book.privateTags ?? [];
      if (!currentTags.some((tag) => normalizeTag(tag) === oldNormalized)) return book;
      const renamed = currentTags.map((tag) => normalizeTag(tag) === oldNormalized ? nextName : tag);
      const deduped = uniquePrivateTags(renamed);
      return { ...book, privateTags: deduped };
    });

    if (!replaceCanonicalLibrary(nextBooks)) {
      setMessage('Could not save the tag rename. No changes were confirmed. Please retry.');
      return;
    }
    setEditingTag(null);
    setEditingName('');
    setMessage(nextNormalized === oldNormalized ? `Updated tag capitalization to “${nextName}”.` : `Renamed tag to “${nextName}” everywhere.`);
  };

  const confirmDelete = () => {
    if (!deletingTag) return;
    const summary = tags.find((tag) => tag.normalized === deletingTag);
    const nextBooks = currentLibrary(books).map((book) => ({
      ...book,
      privateTags: (book.privateTags ?? []).filter((tag) => normalizeTag(tag) !== deletingTag),
    }));
    if (!replaceCanonicalLibrary(nextBooks)) {
      setMessage('Could not save tag removal. No changes were confirmed. Please retry.');
      return;
    }
    setDeletingTag(null);
    setMessage(`Removed “${summary?.name ?? 'tag'}” from ${summary?.count ?? 0} ${(summary?.count ?? 0) === 1 ? 'book' : 'books'}.`);
  };

  const deletingSummary = tags.find((tag) => tag.normalized === deletingTag);

  return (
    <section className="inkbound-panel rounded-3xl p-5 sm:p-6">
      <div>
        <p className="inkbound-kicker">Tags</p>
        <h2 className="mt-1 font-serif text-2xl font-bold text-[var(--ink-ivory)]">Tag manager</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">These tags come directly from the books in your library. Rename or remove one here and Inkbound updates every book that uses it—there is no separate tag list to drift out of sync.</p>
      </div>

      {message && <p className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 py-3 text-sm text-[var(--ink-muted)]">{message}</p>}

      {tags.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[var(--ink-border)] p-7 text-center">
          <Tag className="mx-auto h-7 w-7 text-[var(--ink-gold)]" />
          <p className="mt-3 font-semibold text-[var(--ink-ivory)]">No tags yet</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Add a tag from Book Details and it will appear here automatically.</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {tags.map((tag) => {
            const editing = editingTag === tag.normalized;
            return (
              <article key={tag.normalized} className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
                {editing ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveRename(tag.normalized); } }} className="inkbound-select min-w-0 flex-1" autoFocus />
                    <button type="button" onClick={() => saveRename(tag.normalized)} className="quiet-shelf-primary-action justify-center">Save</button>
                    <button type="button" onClick={() => { setEditingTag(null); setEditingName(''); }} className="quiet-shelf-secondary-action justify-center" aria-label="Cancel rename"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0"><strong className="block truncate text-[var(--ink-ivory)]">{tag.name}</strong><small className="text-[var(--ink-muted)]">Used by {tag.count} {tag.count === 1 ? 'book' : 'books'}</small></div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => { setEditingTag(tag.normalized); setEditingName(tag.name); setMessage(''); }} className="quiet-shelf-icon-button" aria-label={`Rename ${tag.name}`}><Pencil className="h-4 w-4" /></button>
                      <button type="button" onClick={() => { setDeletingTag(tag.normalized); setMessage(''); }} className="quiet-shelf-icon-button text-rose-300" aria-label={`Delete ${tag.name}`}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {deletingSummary && (
        <div className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-950/10 p-4">
          <strong className="text-[var(--ink-ivory)]">Remove “{deletingSummary.name}”?</strong>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">This removes the tag from {deletingSummary.count} {deletingSummary.count === 1 ? 'book' : 'books'}. It does not delete or otherwise change those books.</p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setDeletingTag(null)} className="quiet-shelf-secondary-action justify-center">Cancel</button>
            <button type="button" onClick={confirmDelete} className="quiet-shelf-secondary-action justify-center text-rose-300"><Trash2 className="h-4 w-4" /> Remove tag</button>
          </div>
        </div>
      )}
    </section>
  );
};
