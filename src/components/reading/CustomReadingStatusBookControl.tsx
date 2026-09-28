import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { READING_STATUS_OPTIONS } from '../../domain/libraryTaxonomy';
import type { ReadingStatus, UserBookRecord } from '../../types';
import {
  CUSTOM_READING_STATUSES_CHANGED_EVENT,
  CUSTOM_READING_STATUSES_KEY,
  createCustomReadingStatus,
  readCustomReadingStatuses,
  type CustomReadingStatus,
  withCustomReadingStatus,
} from '../../features/reading/customReadingStatuses';
import { withReadingStatus } from '../../features/reading/bookReadingState';
import { INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT } from '../../platform/runtimeStorage';

interface CustomReadingStatusBookControlProps {
  book: UserBookRecord;
  onUpdateBook: (book: UserBookRecord) => void;
}

type CustomReadingSelection = `custom:${string}`;
type ReadingSelection = Exclude<ReadingStatus, 'custom' | 'wishlist'> | CustomReadingSelection;

const isCustomSelection = (value: ReadingSelection): value is CustomReadingSelection => value.startsWith('custom:');

export const CustomReadingStatusBookControl: React.FC<CustomReadingStatusBookControlProps> = ({ book, onUpdateBook }) => {
  const [statuses, setStatuses] = useState<CustomReadingStatus[]>(() => readCustomReadingStatuses());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    const refresh = () => setStatuses(readCustomReadingStatuses());
    const handleRuntimeRefresh = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key === CUSTOM_READING_STATUSES_KEY) refresh();
    };
    window.addEventListener(CUSTOM_READING_STATUSES_CHANGED_EVENT, refresh);
    window.addEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, handleRuntimeRefresh);
    return () => {
      window.removeEventListener(CUSTOM_READING_STATUSES_CHANGED_EVENT, refresh);
      window.removeEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, handleRuntimeRefresh);
    };
  }, []);

  const selectedStatus = useMemo(
    () => statuses.find((status) => status.id === book.customReadingStatusId),
    [book.customReadingStatusId, statuses],
  );

  const selection: ReadingSelection = book.status === 'custom' && selectedStatus
    ? `custom:${selectedStatus.id}`
    : book.status === 'custom' || book.status === 'wishlist'
      ? 'tbr'
      : book.status;

  const assignSelection = (next: ReadingSelection) => {
    if (isCustomSelection(next)) {
      onUpdateBook(withCustomReadingStatus(book, next.slice('custom:'.length)));
      return;
    }
    onUpdateBook(withReadingStatus(book, next));
  };

  const createAndAssign = () => {
    const status = createCustomReadingStatus(newName);
    if (!status) return;
    setStatuses(readCustomReadingStatuses());
    setNewName('');
    setCreating(false);
    assignSelection(`custom:${status.id}`);
  };

  return (
    <div className="sm:col-span-1">
      {!creating ? (
        <label className="text-xs font-bold text-[#f4efe6]">
          Status
          <select
            value={selection}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '__new__') {
                setCreating(true);
                return;
              }
              assignSelection(value as ReadingSelection);
            }}
            className="inkbound-select mt-2 w-full"
          >
            <optgroup label="Reading status">
              {READING_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </optgroup>
            {statuses.length > 0 && (
              <optgroup label="Custom statuses">
                {statuses.map((status) => (
                  <option key={status.id} value={`custom:${status.id}`}>{status.name}</option>
                ))}
              </optgroup>
            )}
            <option value="__new__">+ Create custom status</option>
          </select>
        </label>
      ) : (
        <div className="rounded-xl border border-[#3d2448] bg-[#120817] p-3">
          <p className="text-xs font-bold text-[#f4efe6]">Create custom reading status</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createAndAssign(); } }}
              placeholder="e.g. Up Next, Re-Reading, Buddy Read"
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
