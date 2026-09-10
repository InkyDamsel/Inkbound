import React, { useMemo, useState } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { OWNERSHIP_OPTIONS, ownershipLabel } from '../../domain/libraryTaxonomy';
import { replaceCanonicalLibrary } from '../../features/library/libraryMutations';
import { readCustomOwnershipCategories } from '../../features/ownership/customOwnershipCategories';
import type { OwnershipStatus, UserBookRecord } from '../../types';

interface OwnershipManagerProps {
  books: UserBookRecord[];
}

const builtInOwnerships = OWNERSHIP_OPTIONS.filter((option) => option.value !== 'custom');

export const OwnershipManager: React.FC<OwnershipManagerProps> = ({ books }) => {
  const [message, setMessage] = useState('');
  const categories = readCustomOwnershipCategories();
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const usageByOwnership = useMemo(() => {
    const counts = new Map<OwnershipStatus, number>();
    books.forEach((book) => counts.set(book.ownership, (counts.get(book.ownership) ?? 0) + 1));
    return counts;
  }, [books]);

  const customGroups = useMemo(() => {
    const groups = new Map<string, { label: string; bookIds: string[] }>();
    books.filter((book) => book.ownership === 'custom').forEach((book) => {
      const key = book.customOwnershipCategoryId ?? '__unlabeled__';
      const label = book.customOwnershipCategoryId
        ? categoryNameById.get(book.customOwnershipCategoryId) ?? 'Missing custom category'
        : 'Unlabeled custom ownership';
      const current = groups.get(key) ?? { label, bookIds: [] };
      current.bookIds.push(book.id);
      groups.set(key, current);
    });
    return [...groups.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  }, [books, categoryNameById]);

  const clearCustomOwnership = (groupKey: string, label: string, bookIds: string[]) => {
    const ids = new Set(bookIds);
    const nextBooks = books.map((book) => ids.has(book.id) && book.ownership === 'custom'
      ? { ...book, ownership: 'none' as const }
      : book);
    replaceCanonicalLibrary(nextBooks);
    setMessage(`${label} was removed as an ownership value from ${bookIds.length} ${bookIds.length === 1 ? 'book' : 'books'}. Category assignments were left intact.`);
  };

  return (
    <section className="inkbound-panel rounded-3xl p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-[var(--ink-gold)]" />
        <div className="min-w-0">
          <p className="inkbound-kicker">Ownership</p>
          <h2 className="mt-1 font-serif text-2xl font-bold text-[var(--ink-ivory)]">Ownership Manager</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">Review how ownership is being used across your library. Inkbound's built-in ownership values stay fixed; any books still using Custom ownership are shown separately so stale assignments can be cleaned up safely.</p>
        </div>
      </div>

      {message && <p className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 py-3 text-sm text-[var(--ink-muted)]">{message}</p>}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {builtInOwnerships.map((option) => {
          const count = usageByOwnership.get(option.value) ?? 0;
          return (
            <article key={option.value} className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-[var(--ink-ivory)]">{ownershipLabel(option.value)}</strong>
                <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1 text-xs text-[var(--ink-muted)]">{count}</span>
              </div>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">Built in · always available</p>
            </article>
          );
        })}
      </div>

      <div className="mt-6 border-t border-[var(--ink-border-subtle)] pt-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="inkbound-kicker">Custom ownership cleanup</p>
            <h3 className="mt-1 font-serif text-xl font-bold text-[var(--ink-ivory)]">Custom ownership values</h3>
          </div>
          <span className="text-xs text-[var(--ink-muted)]">{usageByOwnership.get('custom') ?? 0} books using Custom</span>
        </div>

        {customGroups.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-[var(--ink-border)] p-6 text-center">
            <p className="font-semibold text-[var(--ink-ivory)]">No custom ownership assignments</p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Nothing to clean up here.</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {customGroups.map(([key, group]) => (
              <article key={key} className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <strong className="block truncate text-[var(--ink-ivory)]">{group.label}</strong>
                    <small className="text-[var(--ink-muted)]">Used as ownership by {group.bookIds.length} {group.bookIds.length === 1 ? 'book' : 'books'}</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => clearCustomOwnership(key, group.label, group.bookIds)}
                    className="quiet-shelf-secondary-action shrink-0 justify-center text-rose-300"
                    aria-label={`Remove ${group.label} as an ownership value`}
                  >
                    <Trash2 className="h-4 w-4" /> Clean up
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
