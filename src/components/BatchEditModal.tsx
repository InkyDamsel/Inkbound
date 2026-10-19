import React, { useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import {
  FORMAT_OPTIONS,
  OWNERSHIP_OPTIONS,
  PRIORITY_OPTIONS,
  READING_STATUS_OPTIONS,
  formatLabel,
  ownershipLabel,
  priorityLabel,
  readingStatusLabel,
} from '../domain/libraryTaxonomy';
import { readCustomOwnershipCategories } from '../features/ownership/customOwnershipCategories';
import { readCustomReadingStatuses } from '../features/reading/customReadingStatuses';
import type { Format, OwnershipStatus, Priority, ReadingStatus, UserBookRecord } from '../types';
import { IconStepRating } from './reading/IconStepRating';

export interface BatchEditChanges {
  status?: ReadingStatus;
  customReadingStatusId?: string | null;
  ownership?: OwnershipStatus;
  customOwnershipCategoryId?: string | null;
  format?: Format;
  priority?: Priority;
  rating?: number | null;
  spiceLevel?: number | null;
  dateStarted?: string | null;
  dateFinished?: string | null;
  addTag?: string;
  removeTag?: string;
  addCollection?: string;
  removeCollection?: string;
  seriesName?: string | null;
}

interface BatchEditModalProps {
  selectedBookIds: string[];
  books: UserBookRecord[];
  onClose: () => void;
  onApplyBatchChanges: (changes: BatchEditChanges) => void;
  onDeleteSelected: () => void;
  onUndoLastBatch?: () => void;
}

const optionalText = (value: string) => value.trim() || undefined;
const selectClass = 'min-h-11 w-full rounded-lg border border-[#3d2448] bg-[#120817] p-2 text-[#f4efe6] focus:border-[#c5a059] focus:outline-none';

type DateMode = 'keep' | 'set' | 'clear';

export const BatchEditModal: React.FC<BatchEditModalProps> = ({ selectedBookIds, books, onClose, onApplyBatchChanges, onDeleteSelected }) => {
  const selectedBooks = books.filter((book) => selectedBookIds.includes(book.id));
  const first = selectedBooks[0];
  const uniform = <T,>(read: (book: UserBookRecord) => T) => first && selectedBooks.every((book) => read(book) === read(first));
  const customOwnershipCategories = useMemo(() => readCustomOwnershipCategories(), []);
  const customReadingStatuses = useMemo(() => readCustomReadingStatuses(), []);
  const allTags = useMemo(
    () => [...new Set(books.flatMap((book) => book.privateTags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [books],
  );
  const selectedTags = useMemo(
    () => [...new Set(selectedBooks.flatMap((book) => book.privateTags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [selectedBooks],
  );
  const allCollections = useMemo(
    () => [...new Set(books.flatMap((book) => book.collections ?? []).map((collection) => collection.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [books],
  );
  const selectedCollections = useMemo(
    () => [...new Set(selectedBooks.flatMap((book) => book.collections ?? []).map((collection) => collection.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [selectedBooks],
  );
  const initialStatus = uniform((book) => book.status)
    ? first.status === 'custom' && uniform((book) => book.customReadingStatusId)
      ? `custom:${first.customReadingStatusId ?? ''}`
      : first.status
    : 'multiple';

  const initialOwnership = uniform((book) => book.ownership)
    ? first.ownership === 'custom' && uniform((book) => book.customOwnershipCategoryId)
      ? `custom:${first.customOwnershipCategoryId ?? ''}`
      : first.ownership
    : 'multiple';

  const [status, setStatus] = useState<string>(initialStatus);
  const [ownership, setOwnership] = useState<string>(initialOwnership);
  const [priority, setPriority] = useState<string>(uniform((book) => book.priority) ? first.priority : 'multiple');
  const [format, setFormat] = useState('keep');
  const [rating, setRating] = useState('keep');
  const [spiceLevel, setSpiceLevel] = useState('keep');
  const [startedMode, setStartedMode] = useState<DateMode>('keep');
  const [finishedMode, setFinishedMode] = useState<DateMode>('keep');
  const [dateStarted, setDateStarted] = useState('');
  const [dateFinished, setDateFinished] = useState('');
  const [tagAdd, setTagAdd] = useState('');
  const [tagRemove, setTagRemove] = useState('');
  const [collectionAdd, setCollectionAdd] = useState('');
  const [collectionRemove, setCollectionRemove] = useState('');
  const [seriesMode, setSeriesMode] = useState<DateMode>('keep');
  const [seriesName, setSeriesName] = useState('');
  const allSeries = useMemo(() => [...new Set(books.map((book) => book.work.seriesName?.trim()).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b)), [books]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const changes = useMemo<BatchEditChanges>(() => {
    const finishDateChange = finishedMode === 'clear' ? null : finishedMode === 'set' && dateFinished ? dateFinished : undefined;
    const selectedCustomReadingStatusId = status.startsWith('custom:') ? status.slice('custom:'.length) : undefined;
    const explicitStatus = status !== 'multiple' && status !== 'keep'
      ? selectedCustomReadingStatusId !== undefined ? 'custom' : status as ReadingStatus
      : undefined;
    const selectedCustomCategoryId = ownership.startsWith('custom:') ? ownership.slice('custom:'.length) : undefined;
    const selectedOwnership = ownership !== 'multiple' && ownership !== 'keep'
      ? selectedCustomCategoryId !== undefined ? 'custom' : ownership as OwnershipStatus
      : undefined;
    return {
      status: typeof finishDateChange === 'string' ? 'finished' : explicitStatus,
      customReadingStatusId: typeof finishDateChange === 'string'
        ? null
        : explicitStatus
          ? explicitStatus === 'custom' ? selectedCustomReadingStatusId || null : null
          : undefined,
      ownership: selectedOwnership,
      customOwnershipCategoryId: selectedOwnership
        ? selectedOwnership === 'custom' ? selectedCustomCategoryId || null : null
        : undefined,
      priority: priority !== 'multiple' && priority !== 'keep' ? priority as Priority : undefined,
      format: format !== 'keep' ? format as Format : undefined,
      rating: rating === 'clear' ? null : rating !== 'keep' ? Number(rating) : undefined,
      spiceLevel: spiceLevel === 'clear' ? null : spiceLevel !== 'keep' ? Number(spiceLevel) : undefined,
      dateStarted: startedMode === 'clear' ? null : startedMode === 'set' && dateStarted ? dateStarted : undefined,
      dateFinished: finishDateChange,
      addTag: optionalText(tagAdd)?.toLowerCase(),
      removeTag: optionalText(tagRemove)?.toLowerCase(),
      addCollection: optionalText(collectionAdd),
      removeCollection: optionalText(collectionRemove),
      seriesName: seriesMode === 'clear' ? null : seriesMode === 'set' ? optionalText(seriesName) : undefined,
    };
  }, [collectionAdd, collectionRemove, dateFinished, dateStarted, finishedMode, format, ownership, priority, rating, spiceLevel, startedMode, status, tagAdd, tagRemove, seriesMode, seriesName]);

  const preview = useMemo(() => {
    const items: string[] = [];
    if (changes.status) {
      const customLabel = changes.status === 'custom'
        ? customReadingStatuses.find((status) => status.id === changes.customReadingStatusId)?.name
        : undefined;
      items.push(`Status → ${customLabel ?? readingStatusLabel(changes.status)}`);
    }
    if (changes.ownership) {
      const customLabel = changes.ownership === 'custom'
        ? customOwnershipCategories.find((category) => category.id === changes.customOwnershipCategoryId)?.name
        : undefined;
      items.push(`Ownership → ${customLabel ?? ownershipLabel(changes.ownership)}`);
    }
    if (changes.format) items.push(`Format → ${formatLabel(changes.format)}`);
    if (changes.priority) items.push(`Priority → ${priorityLabel(changes.priority)}`);
    if (changes.rating !== undefined) items.push(changes.rating === null ? 'Clear rating' : `Rating → ${changes.rating}/5`);
    if (changes.spiceLevel !== undefined) items.push(changes.spiceLevel === null ? 'Clear spice level' : `Spice → ${changes.spiceLevel}/5`);
    if (changes.dateStarted !== undefined) items.push(changes.dateStarted === null ? 'Clear date started' : `Date started → ${changes.dateStarted}`);
    if (changes.dateFinished !== undefined) items.push(changes.dateFinished === null ? 'Clear date finished' : `Date finished → ${changes.dateFinished}`);
    if (changes.addTag) items.push(`Add tag “${changes.addTag}”`);
    if (changes.removeTag) items.push(`Remove tag “${changes.removeTag}”`);
    if (changes.seriesName !== undefined) items.push(changes.seriesName === null ? 'Clear series assignment' : `Series → ${changes.seriesName}`);
    if (changes.addCollection) items.push(`Add collection “${changes.addCollection}”`);
    if (changes.removeCollection) items.push(`Remove collection “${changes.removeCollection}”`);
    return items;
  }, [changes, customOwnershipCategories, customReadingStatuses]);

  const field = (label: string, child: React.ReactNode) => <div><label className="mb-1 block font-bold text-[#f4efe6]">{label}</label>{child}</div>;
  const optionSet = <T extends string>(options: readonly { value: T; label: string }[]) => options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>);
  const valueOptions = (values: string[]) => values.map((value) => <option key={value} value={value}>{value}</option>);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="batch-edit-title">
      <div className="inkbound-modal-surface relative flex min-h-0 max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-[#3d2448] p-5 sm:p-6 sm:pb-4">
          <div><span className="rounded bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-[#120817]">Batch Edit</span><h3 id="batch-edit-title" className="mt-2 font-serif text-xl font-bold text-[#f4efe6]">{selectedBooks.length} Items Selected</h3></div>
          <button type="button" onClick={onClose} className="rounded-full bg-black/30 p-2 text-stone-400 hover:text-white" aria-label="Close batch edit"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex gap-2 overflow-x-auto border-b border-[#3d2448] px-5 py-3 sm:px-6">
          {selectedBooks.slice(0, 25).map((book) => <div key={book.id} title={book.work.title} className="flex h-16 w-12 shrink-0 items-end justify-center rounded border border-[#3d2448] bg-gradient-to-br from-[#2a1435] to-[#120817] p-1 text-center font-serif text-[8px] text-stone-200"><span className="line-clamp-2">{book.work.title}</span></div>)}
          {selectedBooks.length > 25 && <div className="grid h-16 min-w-12 place-items-center rounded border border-[#3d2448] bg-[#120817] px-2 text-[10px] font-bold text-stone-400">+{selectedBooks.length - 25}</div>}
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 text-xs sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('Reading Status', <select value={status} onChange={(event) => setStatus(event.target.value)} className={selectClass}><option value="keep">Keep Current Values</option>{status === 'multiple' && <option value="multiple" disabled>— Multiple values —</option>}{optionSet(READING_STATUS_OPTIONS)}{customReadingStatuses.length > 0 && <optgroup label="Custom statuses">{customReadingStatuses.map((customStatus) => <option key={customStatus.id} value={`custom:${customStatus.id}`}>{customStatus.name}</option>)}</optgroup>}</select>)}
            {field('Ownership', <select value={ownership} onChange={(event) => setOwnership(event.target.value)} className={selectClass}><option value="keep">Keep Current Values</option>{ownership === 'multiple' && <option value="multiple" disabled>— Multiple values —</option>}{optionSet(OWNERSHIP_OPTIONS.filter((option) => option.value !== 'custom'))}{customOwnershipCategories.length > 0 && <optgroup label="Custom categories">{customOwnershipCategories.map((category) => <option key={category.id} value={`custom:${category.id}`}>{category.name}</option>)}</optgroup>}</select>)}
            {field('Primary Format', <select value={format} onChange={(event) => setFormat(event.target.value)} className={selectClass}><option value="keep">Keep Current Formats</option>{optionSet(FORMAT_OPTIONS)}</select>)}
            {field('Priority', <select value={priority} onChange={(event) => setPriority(event.target.value)} className={selectClass}><option value="keep">Keep Current Values</option>{priority === 'multiple' && <option value="multiple" disabled>— Multiple values —</option>}{optionSet(PRIORITY_OPTIONS)}</select>)}
            {field('Rating', <div className="rounded-xl border border-[#3d2448] bg-[#120817] p-2"><div className="mb-1 flex flex-wrap items-center gap-2"><button type="button" onClick={() => setRating('keep')} className={`min-h-11 rounded-lg border px-3 text-[11px] font-bold ${rating === 'keep' ? 'border-[#c5a059]/60 bg-[#c5a059]/10 text-[#e5c158]' : 'border-[#3d2448] text-stone-400'}`}>Keep current</button>{rating === 'clear' && <span className="text-[11px] text-stone-400">Will clear rating</span>}</div><IconStepRating value={rating === 'keep' || rating === 'clear' ? undefined : Number(rating)} onChange={(value) => setRating(value === undefined ? 'clear' : String(value))} kind="star" ariaLabel="Batch book rating" /></div>)}{field('Spice Level', <div className="rounded-xl border border-[#3d2448] bg-[#120817] p-2"><div className="mb-1 flex flex-wrap items-center gap-2"><button type="button" onClick={() => setSpiceLevel('keep')} className={`min-h-11 rounded-lg border px-3 text-[11px] font-bold ${spiceLevel === 'keep' ? 'border-orange-300/50 bg-orange-300/10 text-orange-200' : 'border-[#3d2448] text-stone-400'}`}>Keep current</button>{spiceLevel === 'clear' && <span className="text-[11px] text-stone-400">Will clear spice level</span>}</div><IconStepRating value={spiceLevel === 'keep' || spiceLevel === 'clear' ? undefined : Number(spiceLevel)} onChange={(value) => setSpiceLevel(value === undefined ? 'clear' : String(value))} kind="spice" ariaLabel="Batch spice level" allowZero /></div>)}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('Date Started', <div className="grid grid-cols-[130px_1fr] gap-2"><select value={startedMode} onChange={(event) => setStartedMode(event.target.value as DateMode)} className={selectClass}><option value="keep">Keep</option><option value="set">Set</option><option value="clear">Clear</option></select><input type="date" value={dateStarted} onChange={(event) => setDateStarted(event.target.value)} disabled={startedMode !== 'set'} className={`${selectClass} disabled:opacity-40`} /></div>)}
            {field('Date Finished', <div className="grid grid-cols-[130px_1fr] gap-2"><select value={finishedMode} onChange={(event) => setFinishedMode(event.target.value as DateMode)} className={selectClass}><option value="keep">Keep</option><option value="set">Set</option><option value="clear">Clear</option></select><input type="date" value={dateFinished} onChange={(event) => setDateFinished(event.target.value)} disabled={finishedMode !== 'set'} className={`${selectClass} disabled:opacity-40`} /></div>)}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('Series', <div className="space-y-2"><select value={seriesMode} onChange={(event) => setSeriesMode(event.target.value as DateMode)} className={selectClass}><option value="keep">Keep current series</option><option value="set">Assign to series</option><option value="clear">Remove series assignment</option></select>{seriesMode === 'set' && <><input type="text" list="batch-series-names" value={seriesName} onChange={(event) => setSeriesName(event.target.value)} placeholder="Choose or enter a series name" className={selectClass} /><datalist id="batch-series-names">{allSeries.map((name) => <option key={name} value={name} />)}</datalist><p className="text-[11px] text-stone-400">Existing series numbers are preserved when the name stays the same; changing series clears the old series number.</p></>}</div>)}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('Add Tag to All', <select value={tagAdd} onChange={(event) => setTagAdd(event.target.value)} className={selectClass}><option value="">Choose a saved tag</option>{valueOptions(allTags)}</select>)}
            {field('Remove Tag from All', <select value={tagRemove} onChange={(event) => setTagRemove(event.target.value)} className={selectClass}><option value="">Choose a tag on selected items</option>{valueOptions(selectedTags)}</select>)}
            {field('Add to Collection', <select value={collectionAdd} onChange={(event) => setCollectionAdd(event.target.value)} className={selectClass}><option value="">Choose a collection</option>{valueOptions(allCollections)}</select>)}
            {field('Remove from Collection', <select value={collectionRemove} onChange={(event) => setCollectionRemove(event.target.value)} className={selectClass}><option value="">Choose a collection on selected items</option>{valueOptions(selectedCollections)}</select>)}
          </div>

          <div className="rounded-xl border border-[#c5a059]/30 bg-[#25132f] p-4 text-stone-200">
            <p className="font-bold text-[#f4efe6]">Change preview</p>
            {preview.length === 0 ? <p className="mt-2 text-stone-400">No changes selected yet. Existing values will be left alone.</p> : <ul className="mt-2 space-y-1.5 text-stone-300">{preview.map((item) => <li key={item}>• {item}</li>)}</ul>}
            <p className="mt-3 text-[11px] text-stone-500">Changes apply to all {selectedBooks.length} selected items. Setting a finished date also marks those books Finished. Reading history stays intact unless you explicitly change dates or delete items.</p>
          </div>

          {confirmDelete && <div className="space-y-3 rounded-xl border border-rose-500/40 bg-rose-950/90 p-4 text-xs text-white"><p className="font-bold text-rose-200">Delete these {selectedBooks.length} items? Their reading sessions will also be removed. This cannot be undone.</p><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setConfirmDelete(false)} className="min-h-11 rounded-lg bg-stone-800 px-4 font-bold">Cancel</button><button type="button" onClick={() => { onDeleteSelected(); onClose(); }} className="min-h-11 rounded-lg bg-rose-600 px-4 font-bold">Yes, Delete</button></div></div>}
        </div>

        <footer className="grid gap-2 border-t border-[#3d2448] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:grid-cols-[auto_1fr] sm:p-6 sm:pt-4">
          <button type="button" onClick={() => setConfirmDelete(true)} className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-rose-500/20 px-4 text-xs font-bold text-rose-400 hover:bg-rose-950/60"><Trash2 className="h-4 w-4" /> Delete Selected</button>
          <div className="grid grid-cols-2 gap-2 sm:justify-self-end"><button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-[#3d2448] px-4 text-xs font-bold text-stone-300 hover:bg-[#25132f]">Cancel</button><button type="button" onClick={() => { if (preview.length) { onApplyBatchChanges(changes); onClose(); } }} disabled={!selectedBooks.length || !preview.length} className="min-h-11 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-5 text-xs font-bold text-[#120817] disabled:opacity-40">Apply Changes</button></div>
        </footer>
      </div>
    </div>
  );
};
