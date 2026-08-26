import React, { useState } from 'react';
import { Database, X } from 'lucide-react';
import type { UserBookRecord } from '../../types';
import { CatalogContributionPanel } from './CatalogContributionPanel';

interface CatalogContributionLauncherProps {
  book: UserBookRecord;
}

export const CatalogContributionLauncher: React.FC<CatalogContributionLauncherProps> = ({ book }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-[190] inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--ink-mauve)]/45 bg-[#1c0f24] px-4 text-sm font-bold text-[var(--ink-ivory)] shadow-2xl sm:bottom-6 sm:right-6"
      >
        <Database className="h-4 w-4 text-[var(--ink-mauve)]" />
        Share catalog details
      </button>

      {open && (
        <div className="fixed inset-0 z-[260] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <section className="relative w-full max-w-xl rounded-3xl border border-[var(--ink-border)] bg-[#17101b] p-5 shadow-2xl sm:p-6" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Share catalog details">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-black/25 text-[var(--ink-muted)]" aria-label="Close catalog contribution"><X className="h-5 w-5" /></button>
            <div className="pr-10">
              <CatalogContributionPanel book={book} />
            </div>
          </section>
        </div>
      )}
    </>
  );
};
