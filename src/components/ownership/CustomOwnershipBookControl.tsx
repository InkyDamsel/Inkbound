import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { OWNERSHIP_OPTIONS } from '../../domain/libraryTaxonomy';
import type { OwnershipStatus, UserBookRecord } from '../../types';
import {
  CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT,
  CUSTOM_OWNERSHIP_CATEGORIES_KEY,
  createCustomOwnershipCategory,
  readCustomOwnershipCategories,
  type CustomOwnershipCategory,
} from '../../features/ownership/customOwnershipCategories';
import { INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT } from '../../platform/runtimeStorage';

interface CustomOwnershipBookControlProps {
  book: UserBookRecord;
  onUpdateBook: (book: UserBookRecord) => void;
}

type CustomOwnershipSelection = `custom:${string}`;
type OwnershipSelection = OwnershipStatus | CustomOwnershipSelection;

const BUILT_IN_OWNERSHIP_OPTIONS = OWNERSHIP_OPTIONS.filter((option) => option.value !== 'custom');
const isCustomSelection = (value: OwnershipSelection): value is CustomOwnershipSelection => value.startsWith('custom:');

export const CustomOwnershipBookControl: React.FC<CustomOwnershipBookControlProps> = ({ book, onUpdateBook }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [categories, setCategories] = useState<CustomOwnershipCategory[]>(() => readCustomOwnershipCategories());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    const refresh = () => setCategories(readCustomOwnershipCategories());
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

  // Book Details still renders its historical built-in Ownership select next to
  // this shared control. This control is now the one authoritative ownership
  // picker because it includes both built-in and reader-defined values.
  useEffect(() => {
    const root = rootRef.current;
    const grid = root?.parentElement;
    if (!grid) return;
    const labels = Array.from(grid.querySelectorAll(':scope > label'));
    const legacyOwnershipLabel = labels.find((label) => {
      const select = label.querySelector('select');
      return Boolean(select?.querySelector('option[value="owned"]') && select?.querySelector('option[value="subscription"]'));
    }) as HTMLElement | undefined;
    if (!legacyOwnershipLabel) return;
    const previousDisplay = legacyOwnershipLabel.style.display;
    legacyOwnershipLabel.style.display = 'none';
    return () => {
      legacyOwnershipLabel.style.display = previousDisplay;
    };
  }, []);

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === book.customOwnershipCategoryId),
    [book.customOwnershipCategoryId, categories],
  );

  const selection: OwnershipSelection = book.ownership === 'custom' && selectedCategory
    ? `custom:${selectedCategory.id}`
    : book.ownership === 'custom'
      ? 'none'
      : book.ownership;

  const assignSelection = (next: OwnershipSelection) => {
    if (isCustomSelection(next)) {
      const customOwnershipCategoryId = next.slice('custom:'.length);
      onUpdateBook({
        ...book,
        ownership: 'custom',
        customOwnershipCategoryId,
      });
      return;
    }

    onUpdateBook({
      ...book,
      ownership: next,
      customOwnershipCategoryId: undefined,
    });
  };

  const createAndAssign = () => {
    const category = createCustomOwnershipCategory(newName);
    if (!category) return;
    setCategories(readCustomOwnershipCategories());
    setNewName('');
    setCreating(false);
    assignSelection(`custom:${category.id}`);
  };

  return (
    <div ref={rootRef} className="sm:col-span-1">
      {!creating ? (
        <label className="text-xs font-bold text-[#f4efe6]">
          Ownership
          <select
            value={selection}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '__new__') {
                setCreating(true);
                return;
              }
              assignSelection(value as OwnershipSelection);
            }}
            className="inkbound-select mt-2 w-full"
          >
            <optgroup label="Ownership">
              {BUILT_IN_OWNERSHIP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </optgroup>
            {categories.length > 0 && (
              <optgroup label="Custom ownership">
                {categories.map((category) => (
                  <option key={category.id} value={`custom:${category.id}`}>{category.name}</option>
                ))}
              </optgroup>
            )}
            <option value="__new__">+ Create custom ownership</option>
          </select>
        </label>
      ) : (
        <div className="rounded-xl border border-[#3d2448] bg-[#120817] p-3">
          <p className="text-xs font-bold text-[#f4efe6]">Create custom ownership</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createAndAssign(); } }}
              placeholder="e.g. Home Library, Classroom, Owned E-Book"
              className="inkbound-select min-w-0 flex-1"
              autoFocus
            />
            <button type="button" onClick={createAndAssign} disabled={!newName.trim()} className="quiet-shelf-primary-action justify-center disabled:opacity-50">
              <Plus className="h-4 w-4" /> Create
            </button>
            <button type="button" onClick={() => { setCreating(false); setNewName(''); }} className="quiet-shelf-secondary-action justify-center">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
