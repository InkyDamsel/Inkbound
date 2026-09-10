import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import type { UserBookRecord } from '../../types';
import {
  CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT,
  CUSTOM_OWNERSHIP_CATEGORIES_KEY,
  createCustomOwnershipCategory,
  deleteCustomOwnershipCategory,
  readCustomOwnershipCategories,
  renameCustomOwnershipCategory,
  type CustomOwnershipCategory,
} from '../../features/ownership/customOwnershipCategories';
import { INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT } from '../../platform/runtimeStorage';

interface CustomOwnershipCategoryManagerProps {
  books: UserBookRecord[];
}

export const CustomOwnershipCategoryManager: React.FC<CustomOwnershipCategoryManagerProps> = ({ books }) => {
  const [categories, setCategories] = useState<CustomOwnershipCategory[]>(() => readCustomOwnershipCategories());
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const refresh = () => setCategories(readCustomOwnershipCategories());

  useEffect(() => {
    const handleRuntimeRefresh = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key === CUSTOM_OWNERSHIP_CATEGORIES_KEY) refresh();
    };
    window.addEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
    window.addEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, handleRuntimeRefresh);
    return () => {
      window.removeEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
      window.removeEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, handleRuntimeRefresh);
    };
  }, []);

  const usageById = useMemo(() => {
    const counts = new Map<string, number>();
    books.forEach((book) => {
      if (!book.customOwnershipCategoryId) return;
      counts.set(book.customOwnershipCategoryId, (counts.get(book.customOwnershipCategoryId) ?? 0) + 1);
    });
    return counts;
  }, [books]);

  const addCategory = () => {
    const category = createCustomOwnershipCategory(newName);
    if (!category) return;
    setNewName('');
    refresh();
    setMessage(`Created “${category.name}”.`);
  };

  const saveRename = (id: string) => {
    if (!renameCustomOwnershipCategory(id, editingName)) {
      setMessage('That category name is blank or already exists.');
      return;
    }
    setEditingId(null);
    setEditingName('');
    refresh();
    setMessage('Category renamed everywhere.');
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    const category = categories.find((item) => item.id === deleteId);
    const result = deleteCustomOwnershipCategory(deleteId, books);
    if (!result.deleted) {
      setMessage('Inkbound could not remove that category.');
      return;
    }
    setDeleteId(null);
    refresh();
    setMessage(result.affectedBooks > 0
      ? `Removed “${category?.name ?? 'category'}” from ${result.affectedBooks} ${result.affectedBooks === 1 ? 'book' : 'books'}. The books themselves were kept.`
      : `Removed “${category?.name ?? 'category'}”.`);
  };

  const deletingCategory = categories.find((category) => category.id === deleteId);
  const deletingUsage = deleteId ? usageById.get(deleteId) ?? 0 : 0;

  return (
    <section className="inkbound-panel rounded-3xl p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="inkbound-kicker">Categories</p>
          <h2 className="mt-1 font-serif text-2xl font-bold text-[var(--ink-ivory)]">Category Manager</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">Manage reader-defined library categories such as Kids Books, Classroom, Family Library, or anything else that helps organize your shelves. These categories are independent from reading status and ownership.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCategory(); } }}
            placeholder="New category"
            className="inkbound-select min-w-0 sm:w-64"
          />
          <button type="button" onClick={addCategory} disabled={!newName.trim()} className="quiet-shelf-primary-action justify-center disabled:opacity-50"><Plus className="h-4 w-4" /> Add category</button>
        </div>
      </div>

      {message && <p className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 py-3 text-sm text-[var(--ink-muted)]">{message}</p>}

      {categories.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[var(--ink-border)] p-7 text-center">
          <Tag className="mx-auto h-7 w-7 text-[var(--ink-gold)]" />
          <p className="mt-3 font-semibold text-[var(--ink-ivory)]">No custom categories yet</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Create one here or from Book Details. It will stay available until you remove it.</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {categories.map((category) => {
            const usage = usageById.get(category.id) ?? 0;
            const editing = editingId === category.id;
            return (
              <article key={category.id} className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
                {editing ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input value={editingName} onChange={(event) => setEditingName(event.target.value)} className="inkbound-select min-w-0 flex-1" autoFocus />
                    <button type="button" onClick={() => saveRename(category.id)} className="quiet-shelf-primary-action justify-center">Save</button>
                    <button type="button" onClick={() => { setEditingId(null); setEditingName(''); }} className="quiet-shelf-secondary-action justify-center"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <strong className="block truncate text-[var(--ink-ivory)]">{category.name}</strong>
                      <small className="text-[var(--ink-muted)]">Used by {usage} {usage === 1 ? 'book' : 'books'}{usage === 0 ? ' · unused' : ''}</small>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => { setEditingId(category.id); setEditingName(category.name); setMessage(''); }} className="quiet-shelf-icon-button" aria-label={`Rename ${category.name}`}><Pencil className="h-4 w-4" /></button>
                      <button type="button" onClick={() => { setDeleteId(category.id); setMessage(''); }} className="quiet-shelf-icon-button text-rose-300" aria-label={`Delete ${category.name}`}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {deletingCategory && (
        <div className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-950/10 p-4">
          <strong className="text-[var(--ink-ivory)]">Remove “{deletingCategory.name}”?</strong>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{deletingUsage > 0 ? `${deletingUsage} ${deletingUsage === 1 ? 'book uses' : 'books use'} this category. Removing it clears only the category assignment; the books remain in your library.` : 'This category is unused and can be removed safely.'}</p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setDeleteId(null)} className="quiet-shelf-secondary-action justify-center">Cancel</button>
            <button type="button" onClick={confirmDelete} className="quiet-shelf-secondary-action justify-center text-rose-300"><Trash2 className="h-4 w-4" /> Remove category</button>
          </div>
        </div>
      )}
    </section>
  );
};
