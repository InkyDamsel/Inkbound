import React from 'react';
import { CheckCircle2, Columns3 } from 'lucide-react';
import { IMPORT_FIELD_OPTIONS, ImportColumnMapping, ImportFieldKey } from '../../features/import/columnMapping';

interface ImportColumnMappingPanelProps {
  headers: string[];
  mapping: ImportColumnMapping;
  rowCount: number;
  onChange: (field: ImportFieldKey, header: string) => void;
}

export const ImportColumnMappingPanel: React.FC<ImportColumnMappingPanelProps> = ({
  headers,
  mapping,
  rowCount,
  onChange,
}) => {
  const mappedCount = IMPORT_FIELD_OPTIONS.filter((option) => Boolean(mapping[option.key])).length;
  const titleReady = Boolean(mapping.title);

  return (
    <section className="rounded-2xl border border-[#c5a059]/30 bg-[#1c0f24] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Columns3 className="mt-0.5 h-6 w-6 shrink-0 text-[#e5c158]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-serif text-xl font-bold text-[#f4efe6]">Match your spreadsheet columns</h3>
              <p className="mt-1 text-sm leading-6 text-stone-400">
                Inkbound made its best guesses. Change any field that does not look right, or leave fields you do not need set to Ignore.
              </p>
              <p className="mt-2 text-xs leading-5 text-stone-500">
                Covers can only be imported when your export actually includes a cover or image URL. If it does not, you can upload a cover or search online for one from Book Details after import.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-[#c5a059]/25 bg-[#c5a059]/10 px-3 py-1.5 text-xs font-bold text-[#e5c158]">
              {mappedCount} mapped · {rowCount.toLocaleString()} rows
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {IMPORT_FIELD_OPTIONS.map((option) => {
              const selected = mapping[option.key] ?? '';
              return (
                <label key={option.key} className="rounded-xl border border-[#3d2448] bg-[#120817] p-3">
                  <span className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-wider text-stone-400">
                    <span>{option.label}</span>
                    {option.required && <span className="text-[#e5c158]">Required</span>}
                  </span>
                  <select
                    value={selected}
                    onChange={(event) => onChange(option.key, event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-lg border border-[#4a2d56] bg-[#1c0f24] px-3 text-sm text-[#f4efe6] outline-none focus:border-[#c5a059]"
                  >
                    <option value="">Ignore this field</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>

          <div className={`mt-4 flex items-start gap-3 rounded-xl border p-3 text-sm ${titleReady ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200' : 'border-amber-500/35 bg-amber-950/20 text-amber-200'}`}>
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-bold">{titleReady ? 'Title column is ready' : 'Choose a Title column to continue'}</p>
              <p className="mt-1 text-xs opacity-75">
                {titleReady
                  ? 'You can continue with the automatic matches or adjust any optional fields above.'
                  : 'Every imported book needs a title. Other fields are optional and can be ignored.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
