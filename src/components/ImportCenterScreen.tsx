import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  RotateCcw,
  Sparkles,
  Upload,
} from 'lucide-react';
import { ImportRecordItem, ImportSourceInfo } from '../types';
import { MOCK_IMPORT_RECORDS } from '../data/sampleBooks';
import { useUserPlan } from '../context/UserPlanContext';
import { ResponsiveGrid } from '../layout/responsive';
import { ImportAnalysisSummaryGrid } from './import/ImportAnalysisSummaryGrid';
import { ImportSourceGrid } from './import/ImportSourceGrid';

interface ImportCenterScreenProps {
  currentBookCount: number;
  onExecuteImport: (importedItems: ImportRecordItem[]) => void;
  onUndoLastImport?: () => void;
}

export const IMPORT_SOURCES: ImportSourceInfo[] = [
  { id: 'goodreads', name: 'Goodreads', description: 'Import a Goodreads library CSV export.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'storygraph', name: 'StoryGraph', description: 'Import StoryGraph books, tags, and moods.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'fable', name: 'Fable', description: 'Import an exported Fable bookshelf file.', badge: 'JSON Export', method: 'JSON File', supported: true },
  { id: 'hardcover', name: 'Hardcover', description: 'Import your Hardcover library export.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'bookly', name: 'Bookly', description: 'Import books and reading-session history.', badge: 'CSV / JSON', method: 'Export File', supported: true },
  { id: 'generic_csv', name: 'Custom File', description: 'Map a custom CSV or JSON export manually.', badge: 'Any Export', method: 'CSV / JSON', supported: true },
];

const steps = [
  'Select Source',
  'Upload File',
  'Analyze',
  'Map Fields',
  'Select Books',
  'Complete',
];

export const ImportCenterScreen: React.FC<ImportCenterScreenProps> = ({
  currentBookCount,
  onExecuteImport,
  onUndoLastImport,
}) => {
  const { userPlan, freeBookLimit, openUpgradeModal } = useUserPlan();
  const isPremium = userPlan === 'premium';
  const remainingFreeSlots = Math.max(0, freeBookLimit - currentBookCount);

  const [currentStep, setCurrentStep] = useState(1);
  const [selectedSource, setSelectedSource] = useState<ImportSourceInfo>(IMPORT_SOURCES[0]);
  const [importRecords] = useState<ImportRecordItem[]>(MOCK_IMPORT_RECORDS);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    MOCK_IMPORT_RECORDS.slice(0, remainingFreeSlots).map((record) => record.id),
  );
  const [hasUndone, setHasUndone] = useState(false);
  const [fieldMapping, setFieldMapping] = useState({
    title: 'Book Title',
    author: 'Author Name',
    isbn: 'ISBN13',
    status: 'Exclusive Shelf',
  });

  const eligibleCount = isPremium
    ? importRecords.length
    : Math.min(remainingFreeSlots, importRecords.length);

  const selectedRecords = useMemo(
    () =>
      isPremium
        ? importRecords
        : importRecords.filter((record) => selectedIds.includes(record.id)),
    [importRecords, isPremium, selectedIds],
  );

  const goNext = () => setCurrentStep((step) => Math.min(6, step + 1));
  const goBack = () => setCurrentStep((step) => Math.max(1, step - 1));

  const toggleSelection = (recordId: string) => {
    setSelectedIds((current) => {
      if (current.includes(recordId)) {
        return current.filter((id) => id !== recordId);
      }
      if (current.length >= remainingFreeSlots) {
        openUpgradeModal('Upgrade to Inkbound Premium to import every book in this file.');
        return current;
      }
      return [...current, recordId];
    });
  };

  const executeImport = () => {
    onExecuteImport(selectedRecords);
    setCurrentStep(6);
  };

  const undoImport = () => {
    onUndoLastImport?.();
    setHasUndone(true);
  };

  return (
    <div className="space-y-6 pb-20">
      <div>
        <span className="rounded border border-[#c5a059]/30 bg-[#c5a059]/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-[#e5c158]">
          Data Migration Suite
        </span>
        <h1 className="mt-1 font-serif text-3xl font-bold text-[#f4efe6]">Import Center</h1>
        <p className="text-sm text-stone-400">
          Bring your reading history into Inkbound from supported export files.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-4 text-xs text-stone-300">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[#c5a059]" />
        <div>
          <p className="font-bold text-[#f4efe6]">Your library data stays yours</p>
          <p className="mt-1 text-stone-400">
            Import exported files now and export your complete Inkbound library whenever needed.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-3">
        <div className="flex min-w-[650px] items-center justify-between gap-2">
          {steps.map((label, index) => {
            const step = index + 1;
            const active = step === currentStep;
            const complete = step < currentStep;
            return (
              <div
                key={label}
                className={`flex items-center gap-2 text-xs font-semibold ${
                  active ? 'text-[#e5c158]' : complete ? 'text-emerald-400' : 'text-stone-500'
                }`}
              >
                <span
                  className={`grid h-7 w-7 place-items-center rounded-full ${
                    active
                      ? 'bg-[#c5a059] text-[#120817]'
                      : complete
                        ? 'bg-emerald-950 text-emerald-300'
                        : 'bg-[#25132f] text-stone-500'
                  }`}
                >
                  {complete ? '✓' : step}
                </span>
                <span>{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {currentStep === 1 && (
        <section className="space-y-4">
          <h2 className="font-serif text-xl font-bold text-[#f4efe6]">Choose an import source</h2>
          <ImportSourceGrid
            sources={IMPORT_SOURCES}
            selectedSourceId={selectedSource.id}
            onSelectSource={setSelectedSource}
          />
          <div className="flex justify-end">
            <button type="button" onClick={goNext} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#c5a059] px-5 text-xs font-bold text-[#120817]">
              Continue with {selectedSource.name}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {currentStep === 2 && (
        <section className="space-y-4">
          <h2 className="font-serif text-xl font-bold text-[#f4efe6]">Upload {selectedSource.name} export</h2>
          <div className="rounded-2xl border border-dashed border-[#c5a059] bg-[#1c0f24] p-8 text-center sm:p-12">
            <Upload className="mx-auto h-12 w-12 text-[#c5a059]" />
            <p className="mt-3 font-serif text-lg font-bold text-[#f4efe6]">
              Drag and drop your CSV or JSON file
            </p>
            <p className="mt-1 text-xs text-stone-400">This prototype uses sample export data.</p>
            <button type="button" onClick={goNext} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#c5a059] px-5 text-xs font-bold text-[#120817]">
              <FileSpreadsheet className="h-4 w-4" />
              Use Sample Export ({importRecords.length} records)
            </button>
          </div>
          <StepActions onBack={goBack} onNext={goNext} nextLabel="Analyze File" />
        </section>
      )}

      {currentStep === 3 && (
        <section className="space-y-4">
          <h2 className="font-serif text-xl font-bold text-[#f4efe6]">File analysis and capacity</h2>
          <ImportAnalysisSummaryGrid
            importRecordCount={importRecords.length}
            currentBookCount={currentBookCount}
            freeBookLimit={freeBookLimit}
            remainingFreeSlots={remainingFreeSlots}
            isPremium={isPremium}
          />
          {!isPremium && importRecords.length > remainingFreeSlots && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-xs text-stone-300">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <p className="font-bold text-amber-300">Only {eligibleCount} books can be imported</p>
                <p className="mt-1">Choose which books fill your remaining free slots, or upgrade for unlimited imports.</p>
              </div>
            </div>
          )}
          <StepActions onBack={goBack} onNext={goNext} nextLabel="Map Fields" />
        </section>
      )}

      {currentStep === 4 && (
        <section className="space-y-4">
          <h2 className="font-serif text-xl font-bold text-[#f4efe6]">Map export fields</h2>
          <ResponsiveGrid minItemWidth={220} maxColumns={2} gap={16}>
            {Object.entries(fieldMapping).map(([key, value]) => (
              <label key={key} className="text-xs font-bold text-[#f4efe6]">
                <span className="mb-1 block capitalize">{key} field</span>
                <input
                  value={value}
                  onChange={(event) =>
                    setFieldMapping((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className="min-h-11 w-full rounded-xl border border-[#3d2448] bg-[#120817] px-3 text-stone-200 outline-none focus:border-[#c5a059]"
                />
              </label>
            ))}
          </ResponsiveGrid>
          <StepActions onBack={goBack} onNext={goNext} nextLabel="Select Books" />
        </section>
      )}

      {currentStep === 5 && (
        <section className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-serif text-xl font-bold text-[#f4efe6]">Choose books to import</h2>
              <p className="text-xs text-stone-400">
                {isPremium
                  ? `All ${importRecords.length} records are eligible.`
                  : `${selectedIds.length} of ${remainingFreeSlots} available slots selected.`}
              </p>
            </div>
            {!isPremium && (
              <button type="button" onClick={() => openUpgradeModal('Import every book with Inkbound Premium.')} className="text-xs font-bold text-[#e5c158] hover:underline">
                Upgrade to import all
              </button>
            )}
          </div>

          <div className="space-y-2">
            {importRecords.map((record) => {
              const selected = isPremium || selectedIds.includes(record.id);
              return (
                <button
                  key={record.id}
                  type="button"
                  disabled={isPremium}
                  onClick={() => toggleSelection(record.id)}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                    selected
                      ? 'border-[#c5a059] bg-[#c5a059]/10'
                      : 'border-[#3d2448] bg-[#1c0f24] opacity-70'
                  }`}
                >
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${selected ? 'border-[#c5a059] bg-[#c5a059] text-[#120817]' : 'border-stone-600'}`}>
                    {selected && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm text-[#f4efe6]">{record.title}</strong>
                    <small className="text-stone-400">{record.author}</small>
                  </span>
                  <span className="text-[10px] font-bold uppercase text-[#e5c158]">{record.format}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={goBack} className="min-h-11 rounded-xl border border-[#3d2448] px-4 text-xs font-bold text-stone-300">
              Back
            </button>
            <button
              type="button"
              onClick={executeImport}
              disabled={selectedRecords.length === 0}
              className="min-h-11 rounded-xl bg-[#c5a059] px-6 text-xs font-bold text-[#120817] disabled:opacity-50"
            >
              Import {selectedRecords.length} Books
            </button>
          </div>
        </section>
      )}

      {currentStep === 6 && (
        <section className="rounded-3xl border border-emerald-500/30 bg-emerald-950/20 p-6 text-center sm:p-10">
          <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-400" />
          <h2 className="mt-4 font-serif text-3xl font-bold text-[#f4efe6]">Import complete</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-stone-400">
            {selectedRecords.length} books were added to your Inkbound library.
          </p>
          {!hasUndone ? (
            <button type="button" onClick={undoImport} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-500/30 px-4 text-xs font-bold text-rose-300">
              <RotateCcw className="h-4 w-4" /> Undo This Import
            </button>
          ) : (
            <p className="mt-5 text-xs font-bold text-rose-300">The import was undone.</p>
          )}
        </section>
      )}
    </div>
  );
};

interface StepActionsProps {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
}

const StepActions: React.FC<StepActionsProps> = ({ onBack, onNext, nextLabel }) => (
  <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
    <button type="button" onClick={onBack} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#3d2448] px-4 text-xs font-bold text-stone-300">
      <ArrowLeft className="h-4 w-4" /> Back
    </button>
    <button type="button" onClick={onNext} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#c5a059] px-5 text-xs font-bold text-[#120817]">
      {nextLabel}
      <ArrowRight className="h-4 w-4" />
    </button>
  </div>
);
