import { createPortal } from 'react-dom';
import { useBookDetailsDialogFocus } from '../bookDetailsDialogFocus';
import React, { useMemo, useState } from 'react';
import { BadgeInfo, Save, X } from 'lucide-react';
import type { UserBookRecord } from '../../types';

interface EditionLccnControlProps {
  book: UserBookRecord;
  onUpdateBook: (updatedBook: UserBookRecord) => void;
}

function normalizeLccn(value: string): string | undefined {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

export const EditionLccnControl: React.FC<EditionLccnControlProps> = ({ book, onUpdateBook }) => {
  const activeEdition = useMemo(
    () => book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0],
    [book],
  );
  const [open, setOpen] = useState(false);
  const dialogRef = useBookDetailsDialogFocus(open, () => setOpen(false));
  const [value, setValue] = useState(activeEdition?.lccn ?? '');

  if (!activeEdition) return null;

  const save = () => {
    const lccn = normalizeLccn(value);
    onUpdateBook({
      ...book,
      editions: book.editions.map((edition) => edition.id === activeEdition.id
        ? { ...edition, lccn, externalSource: 'manual' as const }
        : edition),
    });
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setValue(activeEdition.lccn ?? ''); setOpen(true); }}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-[214] inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--ink-gold)]/30 bg-[#17101b]/95 px-4 py-2 text-xs font-semibold text-[var(--ink-ivory)] shadow-2xl backdrop-blur-md transition hover:border-[var(--ink-gold)]/55"
        aria-label="Edit Library of Congress Control Number"
      >
        <BadgeInfo className="h-4 w-4 text-[var(--ink-gold)]" />
        <span>{activeEdition.lccn ? `LCCN ${activeEdition.lccn}` : 'Add LCCN / LOC'}</span>
      </button>

      {open && createPortal(
        <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[260] grid place-items-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <section className="relative w-full max-w-md rounded-3xl border border-[var(--ink-border)] bg-[#17101b] p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="edition-lccn-title" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setOpen(false)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full text-[var(--ink-muted)] hover:bg-white/5" aria-label="Close LCCN editor"><X className="h-5 w-5" /></button>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-mauve)]">Edition identifier</p>
            <h2 id="edition-lccn-title" className="mt-1 pr-10 font-serif text-2xl text-[var(--ink-ivory)]">Library of Congress number</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Save the LCCN/LOC number for this specific edition. This is separate from the ISBN and is useful for older, collectible, and library-cataloged books.</p>
            <label className="mt-5 block text-sm font-semibold text-[var(--ink-ivory)]" htmlFor="edition-lccn">LCCN / LOC Number</label>
            <input id="edition-lccn" autoComplete="off" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Example: 2001023456" className="inkbound-select mt-2 w-full" />
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => setOpen(false)} className="quiet-shelf-secondary-action justify-center">Cancel</button><button type="button" onClick={save} className="quiet-shelf-primary-action justify-center"><Save className="h-4 w-4" /> Save LCCN</button></div>
          </section>
        </div>
      , document.body)}
    </>
  );
};
