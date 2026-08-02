import React from 'react';
import { ResponsiveGrid } from '../../layout/responsive';

interface TBRSummaryGridProps {
  booksWaiting: number;
  readNextCount: number;
  savedWithReasonCount: number;
}

interface SummaryCardProps {
  value: number;
  label: string;
}

function SummaryCard({ value, label }: SummaryCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4">
      <p className="font-serif text-2xl text-[var(--ink-ivory)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">{label}</p>
    </div>
  );
}

export function TBRSummaryGrid({
  booksWaiting,
  readNextCount,
  savedWithReasonCount,
}: TBRSummaryGridProps) {
  return (
    <ResponsiveGrid
      minItemWidth={180}
      maxColumns={3}
      gap={12}
      className="mt-7"
    >
      <SummaryCard value={booksWaiting} label="Books waiting" />
      <SummaryCard value={readNextCount} label="Marked read next" />
      <SummaryCard value={savedWithReasonCount} label="Saved with a reason" />
    </ResponsiveGrid>
  );
}
