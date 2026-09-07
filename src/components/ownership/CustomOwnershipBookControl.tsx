import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { UserBookRecord } from '../../types';
import {
  CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT,
  createCustomOwnershipCategory,
  readCustomOwnershipCategories,
  type CustomOwnershipCategory,
} from '../../features/ownership/customOwnershipCategories';

interface CustomOwnershipBookControlProps {
  book: UserBookRecord;
  onUpdateBook: (book: UserBookRecord) => void;
}

export const CustomOwnershipBookControl: React.FC<CustomOwnershipBookControlProps> = ({ book, onUpdateBook }) => {
  const [categories, setCategories] = useState<CustomOwnershipCategory[]>(() => readCustomOwnershipCategories());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    const refresh = () => setCategories(readCustomOwnershipCategories());
    window.addEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
  }, []);

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === book.customOwnershipCategoryId),
    [book.customOwnershipCategoryId, categories],
  );

  if (book.ownership !== 'custom') return null;

  const assign = (categoryId: string | undefined) => {
    onUpdateBook({ ...book, ownership: 'custom', customOwnershipCategoryId: categoryId });
  };

  const createAndAssign = () => {
    const category = createCustomOwnershipCategory(newName);
    if (!category) return;
    setCategories(readCustomOwnershipCategories());
    setNewName('');
    setCreating(false);
    assign(category.id);
  };

  return (
    <section className="rounded-2xl border border-[var(--ink-gold)]/25 bg-[var(--ink-surface-soft)] p-4 sm:col-span-2">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-bold text-[var(--ink-ivory)]">Custom ownership category</p>
        <p className="text-xs leading-5 text-[var(--ink-muted)]">Choose one you already use or create a category that fits your household or collection. You can rename or remove categories later in Library Maintenance.</p>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        {categories.length > 0 && !creating && (
          <select
            value={selectedCategory?.id ?? ''}
            onChange={(event) => {
              if (event.target.value === '__new__') {
                setCreating(true);
                return;
              }
              assign(event.target.value || undefined);
            }}
            className="inkbound-select min-w-0 flex-1"
          >
            <option value="">Choose a custom category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            <option value="__new__">+ Create new category</option>
          </select>
        )}

        {(categories.length === 0 || creating) && (
          <>
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createAndAssign(); } }}
              placeholder="e.g. Kids Books, Classroom, Family Library"
              className="inkbound-select min-w-0 flex-1"
              autoFocus={creating}
            />
            <button type="button" onClick={createAndAssign} disabled={!newName.trim()} className="quiet-shelf-primary-action justify-center disabled:opacity-50">
              <Plus className="h-4 w-4" /> Create & use
            </button>
            {categories.length > 0 && <button type="button" onClick={() => { setCreating(false); setNewName(''); }} className="quiet-shelf-secondary-action justify-center">Cancel</button>}
          </>
        )}
      </div>
    </section>
  );
};
