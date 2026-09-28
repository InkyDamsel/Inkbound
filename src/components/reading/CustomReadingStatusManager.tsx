import React, { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  CUSTOM_READING_STATUSES_CHANGED_EVENT,
  CUSTOM_READING_STATUSES_KEY,
  createCustomReadingStatus,
  deleteCustomReadingStatusDefinition,
  readCustomReadingStatuses,
  renameCustomReadingStatus,
  type CustomReadingStatus,
} from '../../features/reading/customReadingStatuses';
import { withReadingStatus } from '../../features/reading/bookReadingState';
import { INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT } from '../../platform/runtimeStorage';
import type { UserBookRecord } from '../../types';

interface CustomReadingStatusManagerProps {
  books: UserBookRecord[];
  onUpdateBook: (book: UserBookRecord) => void;
}

export const CustomReadingStatusManager: React.FC<CustomReadingStatusManagerProps> = ({ books, onUpdateBook }) => {
  const [statuses, setStatuses] = useState<CustomReadingStatus[]>(() => readCustomReadingStatuses());
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = () => setStatuses(readCustomReadingStatuses());

  useEffect(() => {
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

  const usageById = useMemo(() => {
    const counts = new Map<string, number>();
    books.forEach((book) => {
      if (book.status !== 'custom' || !book.customReadingStatusId) return;
      counts.set(book.customReadingStatusId, (counts.get(book.customReadingStatusId) ?? 0) + 1);
    });
    return counts;
  }, [books]);

  const createStatus = () => {
    const created = createCustomReadingStatus(newName);
    if (!created) return;
    setNewName('');
    refresh();
  };

  const beginRename = (status: CustomReadingStatus) => {
    setEditingId(status.id);
    setEditingName(status.name);
    setConfirmDeleteId(null);
  };

  const saveRename = () => {
    if (!editingId || !editingName.trim()) return;
    if (renameCustomReadingStatus(editingId, editingName)) {
      setEditingId(null);
      setEditingName('');
      refresh();
    }
  };

  const deleteStatus = (status: CustomReadingStatus) => {
    const affected = books.filter(
      (book) => book.status === 'custom' && book.customReadingStatusId === status.id,
    );
    affected.forEach((book) => {
      onUpdateBook({
        ...withReadingStatus(book, 'tbr'),
        customReadingStatusId: undefined,
      });
    });
    if (deleteCustomReadingStatusDefinition(status.id)) {
      setConfirmDeleteId(null);
      if (editingId === status.id) {
        setEditingId(null);
        setEditingName('');
      }
      refresh();
    }
  };

  return (
    <section className="inkbound-panel rounded-3xl p-6">
      <div>
        <p className="inkbound-eyebrow">Library organization</p>
        <h2 className="mt-2 font-serif text-2xl text-[var(--ink-ivory)]">Custom reading statuses</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          Create your own reading states for things like Buddy Read, Up Next, Re-Reading, or ARC.
          Renaming a status updates its label everywhere. Deleting one moves books using it back to To Be Read.
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createStatus(); } }}
          placeholder="New status name"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-sm text-[var(--ink-ivory)] outline-none"
        />
        <button
          type="button"
          onClick={createStatus}
          disabled={!newName.trim()}
          className="quiet-shelf-primary-action justify-center disabled:opacity-45"
        >
          <Plus className="h-4 w-4" /> Add status
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {statuses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5 text-sm text-[var(--ink-muted)]">
            No custom reading statuses yet.
          </div>
        ) : statuses.map((status) => {
          const usageCount = usageById.get(status.id) ?? 0;
          const editing = editingId === status.id;
          const confirming = confirmDeleteId === status.id;

          return (
            <article key={status.id} className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
              {editing ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveRename(); } }}
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--ink-border)] bg-[#0d0910] px-3 text-sm text-[var(--ink-ivory)] outline-none"
                    autoFocus
                  />
                  <button type="button" onClick={saveRename} disabled={!editingName.trim()} className="quiet-shelf-primary-action justify-center disabled:opacity-45">
                    <Check className="h-4 w-4" /> Save
                  </button>
                  <button type="button" onClick={() => { setEditingId(null); setEditingName(''); }} className="quiet-shelf-secondary-action justify-center">
                    <X className="h-4 w-4" /> Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-[var(--ink-ivory)]">{status.name}</p>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">
                      {usageCount} {usageCount === 1 ? 'book uses' : 'books use'} this status
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => beginRename(status)} className="quiet-shelf-secondary-action justify-center">
                      <Pencil className="h-4 w-4" /> Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(confirming ? null : status.id)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#c97b7b]/35 px-4 text-sm font-bold text-[#e9b2b2] hover:bg-[#c97b7b]/10"
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </button>
                  </div>
                </div>
              )}

              {confirming && !editing && (
                <div className="mt-3 rounded-xl border border-[#c97b7b]/30 bg-[#c97b7b]/5 p-3">
                  <p className="text-sm text-[var(--ink-muted)]">
                    Delete <strong className="text-[var(--ink-ivory)]">{status.name}</strong>?
                    {usageCount > 0 ? ` ${usageCount} ${usageCount === 1 ? 'book' : 'books'} will move to To Be Read.` : ' No books currently use it.'}
                  </p>
                  <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button type="button" onClick={() => setConfirmDeleteId(null)} className="quiet-shelf-secondary-action justify-center">Cancel</button>
                    <button type="button" onClick={() => deleteStatus(status)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#a65050] px-4 text-sm font-bold text-white">
                      <Trash2 className="h-4 w-4" /> Delete status
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};
