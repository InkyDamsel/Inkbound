import React, { useState } from 'react';
import { UserBookRecord, ReadingStatus, OwnershipStatus, Format, Priority } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import {
  X,
  Check,
  AlertTriangle,
  RotateCcw,
  Tag,
  BookOpen,
  Trash2,
  Bookmark,
  Layers,
  Sparkles,
  Lock
} from 'lucide-react';

interface BatchEditModalProps {
  selectedBookIds: string[];
  books: UserBookRecord[];
  onClose: () => void;
  onApplyBatchChanges: (changes: {
    status?: ReadingStatus;
    ownership?: OwnershipStatus;
    format?: Format;
    priority?: Priority;
    addTag?: string;
    addCollection?: string;
  }) => void;
  onDeleteSelected: () => void;
  onUndoLastBatch?: () => void;
}

export const BatchEditModal: React.FC<BatchEditModalProps> = ({
  selectedBookIds,
  books,
  onClose,
  onApplyBatchChanges,
  onDeleteSelected,
  onUndoLastBatch,
}) => {
  const { userPlan, openUpgradeModal } = useUserPlan();
  const selectedBooks = books.filter((b) => selectedBookIds.includes(b.id));

  if (userPlan === 'free') {
    return (
      <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-[#1c0f24] border border-[#c5a059]/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 text-center relative">
          <button onClick={onClose} className="absolute top-4 right-4 text-stone-400 hover:text-white p-1 rounded-full bg-black/30 hover:bg-black/50 transition">
            <X className="w-5 h-5" />
          </button>
          <div className="w-12 h-12 rounded-full bg-[#c5a059]/20 flex items-center justify-center text-[#e5c158] mx-auto border border-[#c5a059]/40">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="font-serif font-bold text-2xl text-[#f4efe6]">
            Batch Editing is Premium
          </h3>
          <p className="text-xs text-stone-300">
            Batch-selecting and modifying statuses, formats, ownership, tags, collections, or priorities across multiple books simultaneously requires a Premium account.
          </p>
          <div className="pt-2 flex flex-col gap-2">
            <button
              onClick={() => {
                onClose();
                openUpgradeModal('Batch editing requires a Premium account.');
              }}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-xs shadow hover:opacity-95 transition flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-[#120817]" /> Upgrade to Premium Now
            </button>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-xl text-stone-400 text-xs font-semibold hover:bg-[#25132f] transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }


  // Determine if all selected books share the same status/ownership/etc.
  const firstBook = selectedBooks[0];
  const sameStatus = selectedBooks.every((b) => b.status === firstBook?.status);
  const sameOwnership = selectedBooks.every((b) => b.ownership === firstBook?.ownership);
  const samePriority = selectedBooks.every((b) => b.priority === firstBook?.priority);

  // Form states
  const [targetStatus, setTargetStatus] = useState<string>(sameStatus ? firstBook?.status || 'keep' : 'multiple');
  const [targetOwnership, setTargetOwnership] = useState<string>(sameOwnership ? firstBook?.ownership || 'keep' : 'multiple');
  const [targetPriority, setTargetPriority] = useState<string>(samePriority ? firstBook?.priority || 'keep' : 'multiple');
  const [targetFormat, setTargetFormat] = useState<string>('keep');
  const [tagToAdd, setTagToAdd] = useState('');
  const [collectionToAdd, setCollectionToAdd] = useState('');

  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const handleApply = () => {
    onApplyBatchChanges({
      status: targetStatus !== 'multiple' && targetStatus !== 'keep' ? (targetStatus as ReadingStatus) : undefined,
      ownership: targetOwnership !== 'multiple' && targetOwnership !== 'keep' ? (targetOwnership as OwnershipStatus) : undefined,
      priority: targetPriority !== 'multiple' && targetPriority !== 'keep' ? (targetPriority as Priority) : undefined,
      format: targetFormat !== 'keep' ? (targetFormat as Format) : undefined,
      addTag: tagToAdd.trim() ? tagToAdd.trim().toLowerCase() : undefined,
      addCollection: collectionToAdd.trim() ? collectionToAdd.trim() : undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#1c0f24] border border-[#c5a059]/40 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 relative">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#3d2448] pb-3">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#120817] bg-gradient-to-r from-[#c5a059] to-[#d4af37] px-2.5 py-1 rounded">
              Batch Edit Engine
            </span>
            <h3 className="font-serif font-bold text-xl text-[#f4efe6] mt-1">
              {selectedBooks.length} Books Selected
            </h3>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-white p-1 rounded-full bg-black/30 hover:bg-black/50 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Selected Books Thumbnails Scrollable */}
        <div className="flex gap-2 overflow-x-auto py-2 border-b border-[#3d2448]">
          {selectedBooks.map((b) => (
            <div
              key={b.id}
              className="w-12 h-16 rounded bg-gradient-to-br from-[#2a1435] to-[#120817] border border-[#3d2448] shrink-0 p-1 flex items-end justify-center text-[8px] text-stone-200 font-serif line-clamp-2 text-center shadow"
            >
              {b.work.title}
            </div>
          ))}
        </div>

        {/* Batch Fields Controls */}
        <div className="space-y-4 text-xs">
          
          {/* Reading Status */}
          <div>
            <label className="font-bold text-[#f4efe6] block mb-1">
              Change Reading Status
            </label>
            <select
              value={targetStatus}
              onChange={(e) => setTargetStatus(e.target.value)}
              className="w-full p-2 rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] font-medium focus:outline-none focus:border-[#c5a059]"
            >
              <option value="keep">Keep Current Values</option>
              {targetStatus === 'multiple' && <option value="multiple" disabled>— Multiple values —</option>}
              <option value="currently-reading">Currently Reading</option>
              <option value="tbr">TBR</option>
              <option value="finished">Finished</option>
              <option value="paused">Paused</option>
              <option value="dnf">Did Not Finish</option>
            </select>
          </div>

          {/* Ownership Status */}
          <div>
            <label className="font-bold text-[#f4efe6] block mb-1">
              Change Ownership Status
            </label>
            <select
              value={targetOwnership}
              onChange={(e) => setTargetOwnership(e.target.value)}
              className="w-full p-2 rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] font-medium focus:outline-none focus:border-[#c5a059]"
            >
              <option value="keep">Keep Current Values</option>
              {targetOwnership === 'multiple' && <option value="multiple" disabled>— Multiple values —</option>}
              <option value="owned">Owned Copy</option>
              <option value="borrowed-library">Borrowed from Library</option>
              <option value="borrowed-person">Borrowed from Friend</option>
              <option value="subscription">Subscription Access</option>
              <option value="wishlist">Wishlist</option>
            </select>
          </div>

          {/* Primary Format */}
          <div>
            <label className="font-bold text-[#f4efe6] block mb-1">
              Set Primary Edition Format
            </label>
            <select
              value={targetFormat}
              onChange={(e) => setTargetFormat(e.target.value)}
              className="w-full p-2 rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] font-medium focus:outline-none focus:border-[#c5a059]"
            >
              <option value="keep">Keep Current Formats</option>
              <option value="hardcover">Hardcover</option>
              <option value="paperback">Paperback</option>
              <option value="ebook">Ebook</option>
              <option value="audiobook">Audiobook</option>
            </select>
          </div>

          {/* Add Tag */}
          <div>
            <label className="font-bold text-[#f4efe6] block mb-1">
              Add Tag to All Selected
            </label>
            <input
              type="text"
              placeholder="e.g. 2026-challenge, favorites, gothic..."
              value={tagToAdd}
              onChange={(e) => setTagToAdd(e.target.value)}
              className="w-full p-2 rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
            />
          </div>

        </div>

        {/* Live Summary Preview */}
        <div className="p-3 bg-[#25132f] rounded-xl border border-[#c5a059]/30 text-xs text-stone-200 italic font-serif">
          Preview: &quot;Apply batch changes to {selectedBooks.length} selected books.&quot;
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            onClick={() => setShowConfirmDelete(!showConfirmDelete)}
            className="px-3 py-2 rounded-xl text-rose-400 hover:bg-rose-950/60 text-xs font-bold transition flex items-center gap-1 border border-rose-500/20"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete Selected</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#3d2448] text-xs font-bold text-stone-300 hover:bg-[#25132f]"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] text-xs font-bold shadow transition hover:opacity-95"
            >
              Apply Changes
            </button>
          </div>
        </div>

        {/* Danger Confirm Delete Overlay */}
        {showConfirmDelete && (
          <div className="p-3 bg-rose-950/90 text-white rounded-xl text-xs space-y-2 border border-rose-500/40">
            <p className="font-bold text-rose-200">Are you sure you want to delete these {selectedBooks.length} books?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowConfirmDelete(false)} className="px-3 py-1 bg-stone-800 rounded font-bold">
                Cancel
              </button>
              <button
                onClick={() => {
                  onDeleteSelected();
                  onClose();
                }}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
