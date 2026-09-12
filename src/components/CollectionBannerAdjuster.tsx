import React, { useEffect, useRef, useState } from 'react';
import { prepareCollectionBannerImage } from '../platform/prepareCollectionBannerImage';

interface CollectionBannerAdjusterProps {
  collectionId: string;
  bannerUrl: string;
  onChange: (url: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const CollectionBannerAdjuster: React.FC<CollectionBannerAdjusterProps> = ({
  collectionId,
  bannerUrl,
  onChange,
  onBusyChange,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; startOffsetX: number; startOffsetY: number } | null>(null);
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [draftPreviewUrl, setDraftPreviewUrl] = useState('');
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (draftPreviewUrl) URL.revokeObjectURL(draftPreviewUrl);
  }, [draftPreviewUrl]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const chooseFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file for the collection banner.');
      return;
    }
    if (draftPreviewUrl) URL.revokeObjectURL(draftPreviewUrl);
    setDraftFile(file);
    setDraftPreviewUrl(URL.createObjectURL(file));
    setOffsetX(0);
    setOffsetY(0);
    setZoom(1);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const saveCrop = async () => {
    if (!draftFile) return;
    setBusy(true);
    setError('');
    try {
      const nextUrl = await prepareCollectionBannerImage(draftFile, collectionId, { offsetX, offsetY, zoom });
      onChange(nextUrl);
      setDraftFile(null);
      if (draftPreviewUrl) URL.revokeObjectURL(draftPreviewUrl);
      setDraftPreviewUrl('');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Inkbound could not prepare that banner image.');
    } finally {
      setBusy(false);
    }
  };

  const cancelCrop = () => {
    setDraftFile(null);
    if (draftPreviewUrl) URL.revokeObjectURL(draftPreviewUrl);
    setDraftPreviewUrl('');
    setOffsetX(0);
    setOffsetY(0);
    setZoom(1);
    setError('');
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draftFile) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, startOffsetX: offsetX, startOffsetY: offsetY };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dx = (event.clientX - dragRef.current.x) / bounds.width;
    const dy = (event.clientY - dragRef.current.y) / bounds.height;
    setOffsetX(clamp(dragRef.current.startOffsetX - dx * 2, -1, 1));
    setOffsetY(clamp(dragRef.current.startOffsetY - dy * 2, -1, 1));
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };

  const displayUrl = draftPreviewUrl || bannerUrl;
  const objectPosition = `${50 + offsetX * 50}% ${50 + offsetY * 50}%`;

  return (
    <div className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[var(--ink-muted)]">Custom banner</p>
          <p className="mt-1 text-[11px] text-[var(--ink-muted)]">Upload an image, position it, and Inkbound will save the final 3:1 crop.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0])} />
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="quiet-shelf-secondary-action justify-center disabled:opacity-50">
            {bannerUrl ? 'Replace banner' : 'Upload banner'}
          </button>
          {bannerUrl && !draftFile && (
            <button type="button" disabled={busy} onClick={() => { onChange(''); setError(''); }} className="quiet-shelf-secondary-action justify-center disabled:opacity-50">Remove</button>
          )}
        </div>
      </div>

      {displayUrl && (
        <div
          className={`mt-4 aspect-[3/1] overflow-hidden rounded-xl border border-[var(--ink-border)] bg-black/20 ${draftFile ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          <img
            src={displayUrl}
            alt="Collection banner preview"
            className="h-full w-full select-none object-cover"
            draggable={false}
            style={draftFile ? { objectPosition, transform: `scale(${zoom})`, transformOrigin: 'center' } : undefined}
          />
        </div>
      )}

      {draftFile && (
        <div className="mt-4 space-y-3">
          <p className="text-[11px] text-[var(--ink-muted)]">Drag the image to reposition it. Use zoom if you want a tighter crop.</p>
          <label className="block text-xs font-semibold text-[var(--ink-muted)]">
            Zoom
            <input
              type="range"
              min="1"
              max="2"
              step="0.05"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="mt-2 w-full"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => { setOffsetX(0); setOffsetY(0); setZoom(1); }} className="quiet-shelf-secondary-action justify-center disabled:opacity-50">Reset</button>
            <button type="button" disabled={busy} onClick={cancelCrop} className="quiet-shelf-secondary-action justify-center disabled:opacity-50">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void saveCrop()} className="quiet-shelf-primary-action justify-center disabled:opacity-50">{busy ? 'Saving…' : 'Use banner'}</button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
    </div>
  );
};
