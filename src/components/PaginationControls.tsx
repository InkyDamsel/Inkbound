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

  return (
    <nav className="flex flex-col gap-3 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Pagination">
      <span className="text-xs text-[var(--ink-muted)]">Showing {start.toLocaleString()}–{end.toLocaleString()} of {totalItems.toLocaleString()} {itemLabel}</span>
      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)} className="quiet-shelf-secondary-action min-h-10 justify-center disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>
        <span className="min-w-24 text-center text-xs font-bold text-[var(--ink-ivory)]">{safePage} / {totalPages}</span>
        <button type="button" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)} className="quiet-shelf-secondary-action min-h-10 justify-center disabled:cursor-not-allowed disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button>
      </div>
    </nav>
  );
};
