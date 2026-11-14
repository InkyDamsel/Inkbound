import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

interface PhotoInventoryItem {
  id: string;
  date: string;
  caption: string;
  bookId: string;
  deleted: boolean;
  storagePath: string;
  imageStatus: 'present' | 'missing' | 'unknown';
}

export const AdminPhotoMemoryRecoveryPanel: React.FC<{ targetUserId: string | null }> = ({ targetUserId }) => {
  const [items, setItems] = useState<PhotoInventoryItem[]>([]);
  const [inspectedId, setInspectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [status, setStatus] = useState('');
  const inspect = async () => {
    if (!targetUserId || !functions) return;
    setLoading(true);
    setError('');
    setItems([]);
    setInspectedId('');
    setSelectedId('');
    setStatus('');
    try {
      const callable = httpsCallable<{ targetUserId: string }, { items: PhotoInventoryItem[]; truncated: boolean }>(functions, 'inspectAdminPhotoMemories');
      const result = await callable({ targetUserId });
      setItems(result.data.items);
      setTruncated(result.data.truncated);
      setInspectedId(targetUserId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Photo memory inspection failed.');
    } finally {
      setLoading(false);
    }
  };
  const restore = async () => {
    if (!targetUserId || !selectedId || !functions || restoring || confirmation !== 'RESTORE' || reason.trim().length < 10) return;
    setRestoring(true);
    setError('');
    setStatus('');
    try {
      const callable = httpsCallable<{ targetUserId: string; memoryId: string; reason: string; confirmation: string }, { success: boolean }>(functions, 'restoreAdminPhotoMemory');
      await callable({ targetUserId, memoryId: selectedId, reason: reason.trim(), confirmation });
      setStatus('Original photo record restored. Ask the reader to refresh their signed-in Inkbound session.');
      setSelectedId('');
      setReason('');
      setConfirmation('');
      await inspect();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Restoration failed. No changes confirmed.');
    } finally {
      setRestoring(false);
    }
  };
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--ink-border-subtle)] p-4">
      <h3 className="font-serif text-xl text-[var(--ink-ivory)]">Photo Memory Recovery Inventory</h3>
      <p className="text-sm text-[var(--ink-muted)]">Read-only inspection of a reader's original Firestore records and Storage objects. No media or metadata is modified.</p>
      <button type="button" onClick={() => void inspect()} disabled={!targetUserId || !functions || loading} className="quiet-shelf-secondary-action disabled:opacity-50">{loading ? 'Checking photos…' : 'Inspect saved photos'}</button>
      {status && <p role="status" className="text-sm text-emerald-300">{status}</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {inspectedId === targetUserId && (
        <>
          <p className="text-sm text-[var(--ink-muted)]">{items.length} records found. {items.filter((item) => !item.deleted && item.imageStatus === 'present').length} active records with confirmed Storage images.</p>
          {truncated && <p className="text-sm text-amber-300">Only the first 500 records were inspected. More may exist.</p>}
          <div className="max-h-96 space-y-2 overflow-auto">
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border border-[var(--ink-border-subtle)] p-3 text-xs">
                <p className="break-all font-semibold text-[var(--ink-ivory)]">{item.id}</p>
                <p>{item.date} · {item.deleted ? 'Deleted marker' : 'Active'} · Image: {item.imageStatus}</p>
                {item.caption && <p className="mt-1 text-[var(--ink-muted)]">{item.caption}</p>}
                {item.bookId && <p className="break-all">Book ID: {item.bookId}</p>}
                {item.deleted && item.imageStatus === 'present' && <button type="button" className="quiet-shelf-secondary-action mt-2" onClick={() => { setSelectedId(item.id); setReason(''); setConfirmation(''); }}>Review restore</button>}
              </div>
            ))}
          </div>
          {selectedId && <div className="space-y-3 rounded-xl border border-amber-500/40 p-3">
            <p className="text-sm font-semibold">Restore original photo {selectedId}?</p>
            <p className="text-xs">Only a soft-deleted record with its original Storage image can be restored. This action is audited and does not overwrite active memories.</p>
            <label className="block text-sm">Reason<textarea className="mt-1 w-full rounded-lg border border-[var(--ink-border)] bg-transparent p-2" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            <label className="block text-sm">Type RESTORE<input className="mt-1 w-full rounded-lg border border-[var(--ink-border)] bg-transparent p-2" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            <button type="button" className="quiet-shelf-primary-action disabled:opacity-50" disabled={restoring || confirmation !== 'RESTORE' || reason.trim().length < 10} onClick={() => void restore()}>{restoring ? 'Restoring…' : 'Restore original photo'}</button>
            <button type="button" className="quiet-shelf-secondary-action ml-2" onClick={() => setSelectedId('')}>Cancel</button>
          </div>}
        </>
      )}
    </section>
  );
};
