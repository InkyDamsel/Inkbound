import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationControlsProps {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}

export const PaginationControls: React.FC<PaginationControlsProps> = ({ page, totalItems, pageSize, onPageChange, itemLabel = 'items' }) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize) return null;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(totalItems, safePage * pageSize);

  const visiblePages = (() => {
    if (totalPages <= 9) return Array.from({ length: totalPages }, (_, index) => index + 1);

    const candidates = new Set<number>([
      1,
      totalPages,
      safePage - 2,
      safePage - 1,
      safePage,
      safePage + 1,
      safePage + 2,
    ]);

    if (safePage <= 4) {
      [2, 3, 4, 5, 6].forEach((value) => candidates.add(value));
    }
    if (safePage >= totalPages - 3) {
      [totalPages - 5, totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1].forEach((value) => candidates.add(value));
    }

    return [...candidates]
      .filter((value) => value >= 1 && value <= totalPages)
      .sort((left, right) => left - right);
  })();

  return (
    <nav className="flex flex-col gap-3 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Pagination">
      <span className="text-xs text-[var(--ink-muted)]">Showing {start.toLocaleString()}–{end.toLocaleString()} of {totalItems.toLocaleString()} {itemLabel}</span>
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
        <button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)} className="quiet-shelf-secondary-action min-h-10 justify-center disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>
        <div className="flex flex-wrap items-center justify-center gap-1" aria-label={`Page ${safePage} of ${totalPages}`}>
          {visiblePages.map((pageNumber, index) => {
            const previousPage = visiblePages[index - 1];
            const showGap = previousPage !== undefined && pageNumber - previousPage > 1;
            return (
              <React.Fragment key={pageNumber}>
                {showGap ? <span className="px-1 text-xs text-[var(--ink-muted)]" aria-hidden="true">…</span> : null}
                <button
                  type="button"
                  onClick={() => onPageChange(pageNumber)}
                  aria-current={pageNumber === safePage ? 'page' : undefined}
                  className={`grid h-10 min-w-10 place-items-center rounded-xl border px-2 text-xs font-bold transition ${pageNumber === safePage
                    ? 'border-[#c5a059]/70 bg-[#c5a059]/15 text-[#f4efe6]'
                    : 'border-[var(--ink-border-subtle)] text-[var(--ink-muted)] hover:border-[#c5a059]/45 hover:text-[var(--ink-ivory)]'}`}
                >
                  {pageNumber}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <button type="button" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)} className="quiet-shelf-secondary-action min-h-10 justify-center disabled:cursor-not-allowed disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button>
      </div>
    </nav>
  );
};
