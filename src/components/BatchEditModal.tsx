import React, { useMemo, useState } from 'react';
import { Format, OwnershipStatus, Priority, ReadingStatus, UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { Lock, Sparkles, Trash2, X } from 'lucide-react';

export interface BatchEditChanges {
  status?: ReadingStatus;
  ownership?: OwnershipStatus;
  format?: Format;
  priority?: Priority;
  rating?: number | null;
  dateStarted?: string | null;
  dateFinished?: string | null;
  addTag?: string;
  removeTag?: string;
  addCollection?: string;
  removeCollection?: string;
}

interface BatchEditModalProps {
  selectedBookIds: string[];
  books: UserBookRecord[];
  onClose: () => void;
  onApplyBatchChanges: (changes: BatchEditChanges) => void;
  onDeleteSelected: () => void;
  onUndoLastBatch?: () => void;
}

const normalizeOptionalText = (value: string) => value.trim() || undefined;

export const BatchEditModal: React.FC<BatchEditModalProps> = ({
  selectedBookIds,
  books,
  onClose,
  onApplyBatchChanges,
  onDeleteSelected,
}) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const selectedBooks = books.filter((book) => selectedBookIds.includes(book.id));
  const firstBook = selectedBooks[0];

  const sameStatus = selectedBooks.every((book) => book.status === firstBook?.status);
  const sameOwnership = selectedBooks.every((book) => book.ownership === firstBook?.ownership);
  const samePriority = selectedBooks.every((book) => book.priority === firstBook?.priority);

  const [targetStatus, setTargetStatus] = useState<string>(sameStatus ? firstBook?.status || 'keep' : 'multiple');
  const [targetOwnership, setTargetOwnership] = useState<string>(sameOwnership ? firstBook?.ownership || 'keep' : 'multiple');
  const [targetPriority, setTargetPriority] = useState<string>(samePriority ? firstBook?.priority || 'keep' : 'multiple');
  const [targetFormat, setTargetFormat] = useState<string>('keep');
  const [targetRating, setTargetRating] = useState<string>('keep');
  const [dateStartedMode, setDateStartedMode] = useState<'keep' | 'set' | 'clear'>('keep');
  const [dateFinishedMode, setDateFinishedMode] = useState<'keep' | 'set' | 'clear'>('keep');
  const [dateStarted, setDateStarted] = useState('');
  const [dateFinished, setDateFinished] = useState('');
  const [tagToAdd, setTagToAdd] = useState('');
  const [tagToRemove, setTagToRemove] = useState('');
  const [collectionToAdd, setCollectionToAdd] = useState('');
  const [collectionToRemove, setCollectionToRemove] = useState('');
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const changes = useMemo<BatchEditChanges>(() => ({
    status: targetStatus !== 'multiple' && targetStatus !== 'keep' ? targetStatus as ReadingStatus : undefined,
    ownership: targetOwnership !== 'multiple' && targetOwnership !== 'keep' ? targetOwnership as OwnershipStatus : undefined,
    priority: targetPriority !== 'multiple' && targetPriority !== 'keep' ? targetPriority as Priority : undefined,
    format: targetFormat !== 'keep' ? targetFormat as Format : undefined,
    rating: targetRating === 'clear' ? null : targetRating !== 'keep' ? Number(targetRating) : undefined,
    dateStarted: dateStartedMode === 'clear' ? null : dateStartedMode === 'set' && dateStarted ? dateStarted : undefined,
    dateFinished: dateFinishedMode === 'clear' ? null : dateFinishedMode === 'set' && dateFinished ? dateFinished : undefined,
    addTag: normalizeOptionalText(tagToAdd)?.toLowerCase(),
    removeTag: normalizeOptionalText(tagToRemove)?.toLowerCase(),
    addCollection: normalizeOptionalText(collectionToAdd),
    removeCollection: normalizeOptionalText(collectionToRemove),
  }), [collectionToAdd, collectionToRemove, dateFinished, dateFinishedMode, dateStarted, dateStartedMode, tagToAdd, tagToRemove, targetFormat, targetOwnership, targetPriority, targetRating, targetStatus]);

  const previewItems = useMemo(() => {
    const items: string[] = [];
    if (changes.status) items.push(`Status → ${changes.status}`);
    if (changes.ownership) items.push(`Ownership → ${changes.ownership}`);
    if (changes.format) items.push(`Format → ${changes.format}`);
    if (changes.priority) items.push(`Priority → ${changes.priority}`);
    if (changes.rating !== undefined) items.push(changes.rating === null ? 'Clear rating' : `Rating → ${changes.rating}/5`);
    if (changes.dateStarted !== undefined) items.push(changes.dateStarted === null ? 'Clear date started' : `Date started → ${changes.dateStarted}`);
    if (changes.dateFinished !== undefined) items.push(changes.dateFinished === null ? 'Clear date finished' : `Date finished → ${changes.dateFinished}`);
    if (changes.addTag) items.push(`Add tag “${changes.addTag}”`);
    if (changes.removeTag) items.push(`Remove tag “${changes.removeTag}”`);
    if (changes.addCollection) items.push(`Add collection “${changes.addCollection}”`);
    if (changes.removeCollection) items.push(`Remove collection “${changes.removeCollection}”`);
    return items;
  }, [changes]);

  const handleApply = () => {
    if (previewItems.length === 0) return;
    onApplyBatchChanges(changes);
    onClose();
  };

  if (userPlan === 'free') {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="batch-edit-premium-title">
        <div className="relative w-full max-w-md space-y-5 rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-center shadow-2xl sm:rounded-2xl sm:p-6">
          <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full bg-black/30 p-2 text-stone-400 transition hover:bg-black/50 hover:text-white" aria-label="Close batch edit"><X className="h-5 w-5" /></button>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#c5a059]/40 bg-[#c5a059]/20 text-[#e5c158]"><Lock className="h-6 w-6" /></div>
          <h3 id="batch-edit-premium-title" className="font-serif text-2xl font-bold text-[#f4efe6]">Batch Editing is Premium</h3>
          <p className="text-sm leading-relaxed text-stone-300">Modify statuses, formats, ownership, ratings, dates, tags, collections, or priorities across multiple books with Inkbound Premium.</p>
          <div className="flex flex-col gap-2 pt-2">
            <button type="button" onClick={() => { onClose(); openUpgradeModal('Batch editing requires an Inkbound Premium account.'); }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-sm font-bold text-[#120817] shadow transition hover:opacity-95"><Sparkles className="h-4 w-4" /> Upgrade to Premium</button>
            <button type="button" onClick={onClose} className="min-h-11 w-full rounded-xl text-sm font-semibold text-stone-400 transition hover:bg-[#25132f]">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  const inputClass = 'min-h-11 w-full rounded-lg border border-[#3d2448] bg-[#120817] p-2 text-[#f4efe6] focus:border-[#c5a059] focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="batch-edit-title">
      <div className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-[#c5a059]/40 bg-[#1c0f24] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-[#3d2448] p-5 sm:p-6 sm:pb-4">
          <div><span className="rounded bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-[#120817]">Batch Edit Engine</span><h3 id="batch-edit-title" className="mt-2 font-serif text-xl font-bold text-[#f4efe6]">{selectedBooks.length} Books Selected</h3></div>
          <button type="button" onClick={onClose} className="rounded-full bg-black/30 p-2 text-stone-400 transition hover:bg-black/50 hover:text-white" aria-label="Close batch edit"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex gap-2 overflow-x-auto border-b border-[#3d2448] px-5 py-3 sm:px-6">
          {selectedBooks.slice(0, 25).map((book) => <div key={book.id} title={book.work.title} className="flex h-16 w-12 shrink-0 items-end justify-center rounded border border-[#3d2448] bg-gradient-to-br from-[#2a1435] to-[#120817] p-1 text-center font-serif text-[8px] text-stone-200 shadow"><span className="line-clamp-2">{book.work.title}</span></div>)}
          {selectedBooks.length > 25 && <div className="grid h-16 min-w-12 place-items-center rounded border border-[#3d2448] bg-[#120817] px-2 text-[10px] font-bold text-stone-400">+{selectedBooks.length - 25}</div>}
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5 text-xs sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><label className="mb-1 block font-bold text-[#f4efe6]">Reading Status</label><select value={targetStatus} onChange={(event) => setTargetStatus(event.target.value)} className={inputClass}><option value="keep">Keep Current Values</option>{targetStatus === 'multiple' && <option value="multiple" disabled>— Multiple values —</option>}<option value="currently-reading">Currently Reading</option><option value="tbr">TBR</option><option value="finished">Finished</option><option value="paused">Paused</option><option value="dnf">Did Not Finish</option><option value="wishlist">Wishlist</option></select></div>
            <div><label className="mb-1 block font-bold text-[#f4efe6]">Ownership</label><select value={targetOwnership} onChange={(event) => setTargetOwnership(event.target.value)} className={inputClass}><option value="keep">Keep Current Values</option>{targetOwnership === 'multiple' && <option value="multiple" disabled>— Multiple values —</option>}<option value="owned">Owned Copy</option><option value="borrowed-library">Borrowed from Library</option><option value="borrowed-person">Borrowed from Friend</option><option value="subscription">Subscription Access</option><option value="wishlist">Wishlist</option><option value="none">None</option></select></div>
            <div><label className="mb-1 block font-bold text-[#f4efe6]">Primary Format</label><select value={targetFormat} onChange={(event) => setTargetFormat(event.target.value)} className={inputClass}><option value="keep">Keep Current Formats</option><option value="hardcover">Hardcover</option><option value="paperback">Paperback</option><option value="ebook">Ebook</option><option value="audiobook">Audiobook</option></select></div>
            <div><label className="mb-1 block font-bold text-[#f4efe6]">Priority</label><select value={targetPriority} onChange={(event) => setTargetPriority(event.target.value)} className={inputClass}><option value="keep">Keep Current Values</option>{targetPriority === 'multiple' && <option value="multiple" disabled>— Multiple values —</option>}<option value="top">Top Priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
            <div><label className="mb-1 block font-bold text-[#f4efe6]">Rating</label><select value={targetRating} onChange={(event) => setTargetRating(event.target.value)} className={inputClass}><option value="keep">Keep Current Ratings</option><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option><option value="clear">Clear Rating</option></select></div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><label className="mb-1 block font-bold text-[#f4efe6]">Date Started</label><div className="grid grid-cols-[130px_1fr] gap-2"><select value={dateStartedMode} onChange={(event) => setDateStartedMode(event.target.value as 'keep' | 'set' | 'clear')} className={inputClass}><option value="keep">Keep</option><option value="set">Set</option><option value="clear">Clear</option></select><input type="date" value={dateStarted} onChange={(event) => setDateStarted(event.target.value)} disabled={dateStartedMode !== 'set'} className={`${inputClass} disabled:opacity-40`} /></div></div>
            <div><label className="mb-1 block font-bold text-[#f4efe6]">Date Finished</label><div className="grid grid-cols-[130px_1fr] gap-2"><select value={dateFinishedMode} onChange={(event) => setDateFinishedMode(event.target.value as 'keep' | 'set' | 'clear')} className={inputClass}><option value="keep">Keep</option><option value="set">Set</option><option value="clear">Clear</option></select><input type="date" value={dateFinished} onChange={(event) => setDateFinished(event.target.value)} disabled={dateFinishedMode !== 'set'} className={`${inputClass} disabled:opacity-40`} /></div></div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><label className="mb-1 block font-bold text-[#f4efe6]">Add Tag to All</label><input type="text" placeholder="e.g. 2026-challenge" value={tagToAdd} onChange={(event) => setTagToAdd(event.target.value)} className={inputClass} /></div>
            <div><label className="mb-1 block font-bold text-[#f4efe6]">Remove Tag from All</label><input type="text" placeholder="e.g. imported" value={tagToRemove} onChange={(event) => setTagToRemove(event.target.value)} className={inputClass} /></div>
            <div><label className="mb-1 block font-bold text-[#f4efe6]">Add to Collection</label><input type="text" placeholder="e.g. Autumn Reads" value={collectionToAdd} onChange={(event) => setCollectionToAdd(event.target.value)} className={inputClass} /></div>
            <div><label className="mb-1 block font-bold text-[#f4efe6]">Remove from Collection</label><input type="text" placeholder="e.g. Autumn Reads" value={collectionToRemove} onChange={(event) => setCollectionToRemove(event.target.value)} className={inputClass} /></div>
          </div>

          <div className="rounded-xl border border-[#c5a059]/30 bg-[#25132f] p-4 text-stone-200">
            <p className="font-bold text-[#f4efe6]">Change preview</p>
            {previewItems.length === 0 ? <p className="mt-2 text-stone-400">No changes selected yet. Existing values will be left alone.</p> : <ul className="mt-2 space-y-1.5 text-stone-300">{previewItems.map((item) => <li key={item}>• {item}</li>)}</ul>}
            <p className="mt-3 text-[11px] text-stone-500">These changes will apply to all {selectedBooks.length} selected books.</p>
          </div>

          {showConfirmDelete && <div className="space-y-3 rounded-xl border border-rose-500/40 bg-rose-950/90 p-4 text-xs text-white"><p className="font-bold text-rose-200">Delete these {selectedBooks.length} books? This cannot be undone.</p><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowConfirmDelete(false)} className="min-h-11 rounded-lg bg-stone-800 px-4 font-bold">Cancel</button><button type="button" onClick={() => { onDeleteSelected(); onClose(); }} className="min-h-11 rounded-lg bg-rose-600 px-4 font-bold text-white hover:bg-rose-700">Yes, Delete</button></div></div>}
        </div>

        <div className="grid gap-2 border-t border-[#3d2448] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:grid-cols-[auto_1fr] sm:p-6 sm:pt-4">
          <button type="button" onClick={() => setShowConfirmDelete(true)} className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-rose-500/20 px-4 text-xs font-bold text-rose-400 transition hover:bg-rose-950/60"><Trash2 className="h-4 w-4" /> Delete Selected</button>
          <div className="grid grid-cols-2 gap-2 sm:justify-self-end"><button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-[#3d2448] px-4 text-xs font-bold text-stone-300 hover:bg-[#25132f]">Cancel</button><button type="button" onClick={handleApply} disabled={selectedBooks.length === 0 || previewItems.length === 0} className="min-h-11 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-5 text-xs font-bold text-[#120817] shadow transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40">Apply Changes</button></div>
        </div>
      </div>
    </div>
  );
};
