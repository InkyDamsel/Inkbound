import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { ImportSourceInfo } from '../../types';
import { ResponsiveGrid } from '../../layout/responsive';

interface ImportSourceGridProps {
  sources: ImportSourceInfo[];
  selectedSourceId: string;
  onSelectSource: (source: ImportSourceInfo) => void;
}

const HIDDEN_IMPORT_SOURCE_IDS = new Set(['fable', 'bookly']);

export const ImportSourceGrid: React.FC<ImportSourceGridProps> = ({
  sources,
  selectedSourceId,
  onSelectSource,
}) => {
  const visibleSources = sources.filter((source) => !HIDDEN_IMPORT_SOURCE_IDS.has(source.id));

  return (
    <ResponsiveGrid minItemWidth={260} maxColumns={3} gap={16} alignItems="stretch">
      {visibleSources.map((source) => {
        const isSelected = selectedSourceId === source.id;

        return (
          <button
            key={source.id}
            type="button"
            onClick={() => onSelectSource(source)}
            aria-pressed={isSelected}
            className={`flex h-full flex-col justify-between space-y-3 rounded-2xl border p-5 text-left transition ${
              isSelected
                ? 'border-[#c5a059] bg-[#c5a059]/15 shadow-md'
                : 'border-[#e8dfd1] bg-[#f8f4ed] hover:bg-[#ebd9c5]/30 dark:border-[#342436] dark:bg-[#201723]'
            }`}
          >
            <div className="flex items-start justify-between">
              <span className="rounded bg-[#c5a059]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#c5a059]">
                {source.badge}
              </span>
              {isSelected && <CheckCircle2 className="h-5 w-5 text-[#c5a059]" />}
            </div>

            <div>
              <h3 className="font-serif text-lg font-bold text-[#2e102d] dark:text-[#f3ede2]">
                {source.name}
              </h3>
              <p className="mt-1 text-xs text-[#849383]">{source.description}</p>
            </div>

            <p className="border-t border-[#e8dfd1] pt-2 text-[10px] font-semibold text-stone-400 dark:border-[#2e1e30]">
              Method: {source.method}
            </p>
          </button>
        );
      })}
    </ResponsiveGrid>
  );
};