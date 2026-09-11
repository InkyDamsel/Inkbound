import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { withReadingStatus } from '../../features/reading/bookReadingState';
import type { ReadingStatus, UserBookRecord } from '../../types';
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

type CustomCategorySelection = `custom:${string}`;
type CategorySelection = ReadingStatus | CustomCategorySelection;

const READING_STATUS_OPTIONS: Array<{ value: ReadingStatus; label: string }> = [
  { value: 'currently-reading', label: 'Currently Reading' },
  { value: 'tbr', label: 'TBR' },
  { value: 'finished', label: 'Finished' },
  { value: 'paused', label: 'Paused' },
  { value: 'dnf', label: 'Did Not Finish' },
  { value: 'wishlist', label: 'Wishlist' },
];

const isCustomSelection = (value: CategorySelection): value is CustomCategorySelection => value.startsWith('custom:');

export const CustomOwnershipBookControl: React.FC<CustomOwnershipBookControlProps> = ({ book, onUpdateBook }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [categories, setCategories] = useState<CustomOwnershipCategory[]>(() => readCustomOwnershipCategories());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    const refresh = () => setCategories(readCustomOwnershipCategories());
    window.addEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CUSTOM_OWNERSHIP_CATEGORIES_CHANGED_EVENT, refresh);
  }, []);

  // Book Details historically rendered a separate Status control immediately
  // before this component. This control is now the single Status / Category
  // source in the editor, matching Add Book. Hide the legacy duplicate without
  // changing the surrounding modal layout while Build 27 remains stable.
  useEffect(() => {
    const root = rootRef.current;
    const grid = root?.parentElement;
    if (!grid) return;
    const labels = Array.from(grid.querySelectorAll(':scope > label'));
    const legacyStatusLabel = labels.find((label) => {
      const select = label.querySelector('select');
      return Boolean(select?.querySelector('option[value="currently-reading"]'));
    }) as HTMLElement | undefined;
    if (!legacyStatusLabel) return;
    const previousDisplay = legacyStatusLabel.style.display;
    legacyStatusLabel.style.display = 'none';
    return () => {
      legacyStatusLabel.style.display = previousDisplay;
    };
  }, []);

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === book.customOwnershipCategoryId),
    [book.customOwnershipCategoryId, categories],
  );

  const selection: CategorySelection = selectedCategory
    ? `custom:${selectedCategory.id}`
    : book.status;

  const assignSelection = (next: CategorySelection) => {
    if (isCustomSelection(next)) {
      const customOwnershipCategoryId = next.slice('custom:'.length);
      onUpdateBook({
        ...book,
        status: 'custom',
        customOwnershipCategoryId,
      });
      return;
    }

    onUpdateBook({
      ...withReadingStatus(book, next),
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
          Status / Category
          <select
            value={selection}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '__new__') {
                setCreating(true);
                return;
              }
              assignSelection(value as CategorySelection);
            }}
            className="inkbound-select mt-2 w-full"
          >
            <optgroup label="Reading status">
              {READING_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </optgroup>
            {categories.length > 0 && (
              <optgroup label="Custom categories">
                {categories.map((category) => (
                  <option key={category.id} value={`custom:${category.id}`}>{category.name}</option>
                ))}
              </optgroup>
            )}
            <option value="__new__">+ Create new category</option>
          </select>
        </label>
      ) : (
        <div className="rounded-xl border border-[#3d2448] bg-[#120817] p-3">
          <p className="text-xs font-bold text-[#f4efe6]">Create custom category</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createAndAssign(); } }}
              placeholder="e.g. Kids Books, Classroom, Family Library"
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
