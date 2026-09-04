import React from 'react';
import { ResponsiveGrid } from '../../layout/responsive';

interface ImportAnalysisSummaryGridProps {
  importRecordCount: number;
}

interface SummaryCardProps {
  label: string;
  value: React.ReactNode;
  description: string;
  valueClassName?: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({
  label,
  value,
  description,
  valueClassName = 'text-[#2e102d] dark:text-[#f3ede2]',
}) => (
  <div className="space-y-1 rounded-2xl border border-[#e8dfd1] bg-[#f8f4ed] p-4 text-center dark:border-[#342436] dark:bg-[#201723]">
    <p className="text-xs font-bold uppercase tracking-wider text-stone-500">{label}</p>
    <p className={`font-serif text-3xl font-bold ${valueClassName}`}>{value}</p>
    <p className="text-[11px] text-stone-400">{description}</p>
  </div>
);

export const ImportAnalysisSummaryGrid: React.FC<ImportAnalysisSummaryGridProps> = ({
  importRecordCount,
}) => (
  <ResponsiveGrid minItemWidth={190} maxColumns={3} gap={16}>
    <SummaryCard
      label="Books in File"
      value={importRecordCount}
      description="Total records detected"
      valueClassName="text-[#361539] dark:text-[#c5a059]"
    />

    <SummaryCard
      label="Import Access"
      value="Unlimited"
      description="Available to every Inkbound reader"
      valueClassName="text-[#2e102d] dark:text-[#f3ede2]"
    />

    <SummaryCard
      label="Eligible for Import"
      value={importRecordCount}
      description="All records eligible"
      valueClassName="text-emerald-600"
    />
  </ResponsiveGrid>
);
