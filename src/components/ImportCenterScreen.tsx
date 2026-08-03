import React, { ChangeEvent, DragEvent, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  HelpCircle,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
} from 'lucide-react';
import { Format, ImportRecordItem, ImportSourceInfo, ReadingStatus } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { ImportAnalysisSummaryGrid } from './import/ImportAnalysisSummaryGrid';
import { ImportSourceGrid } from './import/ImportSourceGrid';

interface ImportCenterScreenProps {
  currentBookCount: number;
  onExecuteImport: (importedItems: ImportRecordItem[]) => Promise<void> | void;
  onUndoLastImport?: () => void;
}

export const IMPORT_SOURCES: ImportSourceInfo[] = [
  { id: 'goodreads', name: 'Goodreads', description: 'Import a Goodreads library CSV export.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'storygraph', name: 'StoryGraph', description: 'Import StoryGraph books, tags, and moods.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'fable', name: 'Fable', description: 'Import an exported Fable bookshelf file.', badge: 'JSON Export', method: 'JSON File', supported: true },
  { id: 'hardcover', name: 'Hardcover', description: 'Import your Hardcover library export.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'bookly', name: 'Bookly', description: 'Import books and reading-session history.', badge: 'CSV / JSON', method: 'Export File', supported: true },
  { id: 'generic_csv', name: 'Custom File', description: 'Import a CSV or JSON file from another reading service.', badge: 'Any Export', method: 'CSV / JSON', supported: true },
];

const steps = ['Select Source', 'Upload File', 'Analyze', 'Select Books', 'Complete'];

const sourceInstructions: Record<string, string[]> = {
  goodreads: [
    'Open Goodreads on the web and go to My Books.',
    'Choose Import and Export from the left side of the page.',
    'Select Export Library and download the CSV file.',
  ],
  storygraph: [
    'Open StoryGraph and go to Manage Account.',
    'Find the data export section.',
    'Request or download your reading history CSV.',
  ],
  fable: [
    'Open Fable and go to your account or data settings.',
    'Choose the available library or data export option.',
    'Download the JSON export file.',
  ],
  hardcover: [
    'Open Hardcover and go to Account Settings.',
    'Find Export Data or Library Export.',
    'Download the CSV file to your device.',
  ],
  bookly: [
    'Open Bookly and go to Settings.',
    'Choose Backup, Export, or Data Export.',
    'Save the CSV or JSON file to your device.',
  ],
  generic_csv: [
    'Export your library from the original reading app.',
    'Choose CSV or JSON when the service offers a format choice.',
    'Save the export file somewhere easy to find, such as Downloads.',
  ],
};

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) =>
    headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = cells[index]?.trim() ?? '';
      return record;
    }, {}),
  );
}

function firstValue(record: Record<string, unknown>, keys: string[]): string {
  const entries = Object.entries(record);
  for (const key of keys) {
    const match = entries.find(([entryKey]) => entryKey.toLowerCase() === key.toLowerCase());
    if (match && match[1] !== undefined && match[1] !== null) return String(match[1]).trim();
  }
  return '';
}

function normalizeFormat(value: string): Format {
  const normalized = value.toLowerCase();
  if (normalized.includes('audio')) return 'audiobook';
  if (normalized.includes('ebook') || normalized.includes('kindle') || normalized.includes('digital')) return 'ebook';
  if (normalized.includes('paper')) return 'paperback';
  return 'hardcover';
}

function normalizeStatus(value: string): ReadingStatus {
  const normalized = value.toLowerCase();
  if (normalized.includes('currently') || normalized === 'reading') return 'currently-reading';
  if (normalized.includes('dnf') || normalized.includes('did not')) return 'dnf';
  if (normalized.includes('pause')) return 'paused';
  if (normalized.includes('wish')) return 'wishlist';
  if (normalized.includes('read') || normalized.includes('finish')) return 'finished';
  return 'tbr';
}

function mapRecord(record: Record<string, unknown>, index: number): ImportRecordItem | null {
  const title = firstValue(record, ['Title', 'Book Title', 'title', 'name']);
  if (!title) return null;

  const author = firstValue(record, ['Author', 'Author Name', 'author', 'authors']) || 'Unknown Author';
  const isbn = firstValue(record, ['ISBN13', 'ISBN', 'isbn13', 'isbn', 'isbn_13', 'isbn_10']);
  const ratingValue = Number(firstValue(record, ['My Rating', 'Rating', 'rating', 'star_rating']));

  return {
    id: `import-${Date.now()}-${index}`,
    title,
    author,
    isbn: isbn || undefined,
    format: normalizeFormat(firstValue(record, ['Binding', 'Format', 'format', 'media_type', 'book_format'])),
    status: normalizeStatus(firstValue(record, ['Exclusive Shelf', 'Status', 'status', 'shelf', 'read_status'])),
    rating: Number.isFinite(ratingValue) && ratingValue > 0 ? ratingValue : undefined,
    dateRead: firstValue(record, ['Date Read', 'dateRead', 'date_finished', 'finished_at']) || undefined,
    dateAdded: firstValue(record, ['Date Added', 'dateAdded', 'created_at', 'added_at']) || new Date().toISOString().split('T')[0],
    review: firstValue(record, ['My Review', 'Review', 'review', 'notes']) || undefined,
    confidence: 100,
    duplicateAction: 'skip',
    coverGradient: 'from-[#5c3d62] via-[#35243f] to-[#171117]',
  };
}

async function readImportFile(file: File): Promise<ImportRecordItem[]> {
  const text = await file.text();
  const extension = file.name.split('.').pop()?.toLowerCase();
  let rawRecords: Record<string, unknown>[];

  if (extension === 'json' || file.type.includes('json')) {
    const parsed: unknown = JSON.parse(text);
    const array = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? Object.values(parsed as Record<string, unknown>).find(Array.isArray) ?? []
        : [];
    rawRecords = (array as unknown[]).filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
    );
  } else {
    rawRecords = parseCsv(text);
  }

  return rawRecords.map(mapRecord).filter((item): item is ImportRecordItem => Boolean(item));
}

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
  const [importRecords, setImportRecords] = useState<ImportRecordItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState(0);
  const [hasUndone, setHasUndone] = useState(false);

  const selectedRecords = useMemo(
    () => importRecords.filter((record) => selectedIds.includes(record.id)),
    [importRecords, selectedIds],
  );

  const maximumSelection = isPremium ? importRecords.length : remainingFreeSlots;
  const allEligibleSelected =
    importRecords.length > 0 && selectedIds.length === Math.min(importRecords.length, maximumSelection);

  const goNext = () => setCurrentStep((step) => Math.min(5, step + 1));
  const goBack = () => setCurrentStep((step) => Math.max(1, step - 1));

  const processFile = async (file?: File) => {
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'json'].includes(extension ?? '')) {
      setFileError('Choose a CSV or JSON export file.');
      return;
    }

    setIsReadingFile(true);
    setFileError(null);
    setImportError(null);
    try {
      const records = await readImportFile(file);
      if (records.length === 0) throw new Error('No recognizable book records were found in this file.');
      setImportRecords(records);
      setSelectedFileName(file.name);
      const initialLimit = isPremium ? records.length : remainingFreeSlots;
      setSelectedIds(records.slice(0, initialLimit).map((record) => record.id));
    } catch (error) {
      setImportRecords([]);
      setSelectedIds([]);
      setSelectedFileName('');
      setFileError(error instanceof Error ? error.message : 'Inkbound could not read this export file.');
    } finally {
      setIsReadingFile(false);
    }
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void processFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void processFile(event.dataTransfer.files?.[0]);
  };

  const toggleSelection = (recordId: string) => {
    if (isImporting) return;
    setSelectedIds((current) => {
      if (current.includes(recordId)) return current.filter((id) => id !== recordId);
      if (!isPremium && current.length >= remainingFreeSlots) {
        openUpgradeModal('Upgrade to Inkbound Premium to import every book in this file.');
        return current;
      }
      return [...current, recordId];
    });
  };

  const selectAllEligible = () => {
    const limit = isPremium ? importRecords.length : remainingFreeSlots;
    setSelectedIds(importRecords.slice(0, limit).map((record) => record.id));
  };

  const selectByStatus = (status: ReadingStatus) => {
    setSelectedIds(
      importRecords
        .filter((record) => record.status === status)
        .slice(0, isPremium ? importRecords.length : remainingFreeSlots)
        .map((record) => record.id),
    );
  };

  const executeImport = async () => {
    if (selectedRecords.length === 0 || isImporting) return;

    const recordsToImport = [...selectedRecords];
    setIsImporting(true);
    setImportError(null);
    try {
      await onExecuteImport(recordsToImport);
      setImportedCount(recordsToImport.length);
      setCurrentStep(5);
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : 'The import could not be completed. Your library was not changed.',
      );
    } finally {
      setIsImporting(false);
    }
  };

  const undoImport = () => {
    onUndoLastImport?.();
    setHasUndone(true);
  };

  return (
    <div className="space-y-6 pb-20">
      <header>
        <span className="rounded border border-[#c5a059]/30 bg-[#c5a059]/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-[#e5c158]">
          Library Migration
        </span>
        <h1 className="mt-2 font-serif text-3xl font-bold text-[#f4efe6]">Import Center</h1>
        <p className="mt-1 text-sm text-stone-400">Bring your reading history into Inkbound from a supported export file.</p>
      </header>

      <div className="flex items-start gap-3 rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-4 text-xs text-stone-300">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[#c5a059]" />
        <div>
          <p className="font-bold text-[#f4efe6]">Your library data stays yours</p>
          <p className="mt-1 text-stone-400">Inkbound reads the file you choose and adds only the books you approve.</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-3">
        <div className="flex min-w-[560px] items-center justify-between gap-2">
          {steps.map((label, index) => {
            const step = index + 1;
            const active = step === currentStep;
            const complete = step < currentStep;
            return (
              <div key={label} className={`flex items-center gap-2 text-xs font-semibold ${active ? 'text-[#e5c158]' : complete ? 'text-emerald-400' : 'text-stone-500'}`}>
                <span className={`grid h-7 w-7 place-items-center rounded-full ${active ? 'bg-[#c5a059] text-[#120817]' : complete ? 'bg-emerald-950 text-emerald-300' : 'bg-[#25132f] text-stone-500'}`}>
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
          <ImportSourceGrid sources={IMPORT_SOURCES} selectedSourceId={selectedSource.id} onSelectSource={setSelectedSource} />
          <div className="flex justify-end">
            <button type="button" onClick={goNext} className="quiet-shelf-primary-action min-h-11">
              Continue with {selectedSource.name}<ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {currentStep === 2 && (
        <section className="space-y-5">
          <div>
            <h2 className="font-serif text-xl font-bold text-[#f4efe6]">Upload {selectedSource.name} export</h2>
            <p className="mt-1 text-sm text-stone-400">Choose the file you downloaded from {selectedSource.name}.</p>
          </div>

          <section className="rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-5">
            <div className="flex items-start gap-3">
              <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#e5c158]" />
              <div>
                <h3 className="font-bold text-[#f4efe6]">How to find your export file</h3>
                <ol className="mt-3 space-y-2 text-sm text-stone-400">
                  {sourceInstructions[selectedSource.id].map((instruction, index) => (
                    <li key={instruction} className="flex gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#c5a059]/15 text-xs font-bold text-[#e5c158]">{index + 1}</span>
                      <span>{instruction}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>

          <div onDragOver={(event) => event.preventDefault()} onDrop={onDrop} className="rounded-2xl border border-dashed border-[#c5a059] bg-[#1c0f24] p-8 text-center sm:p-12">
            <Upload className="mx-auto h-12 w-12 text-[#c5a059]" />
            <p className="mt-3 font-serif text-lg font-bold text-[#f4efe6]">Drag and drop your CSV or JSON file</p>
            <p className="mt-1 text-xs text-stone-400">or choose it from your device</p>
            <label className="quiet-shelf-primary-action mt-5 inline-flex min-h-11 cursor-pointer">
              <FileSpreadsheet className="h-4 w-4" />
              {isReadingFile ? 'Reading file…' : 'Choose Export File'}
              <input type="file" accept=".csv,.json,text/csv,application/json" onChange={onFileInput} className="sr-only" disabled={isReadingFile} />
            </label>
            {selectedFileName && <p className="mt-4 text-sm font-semibold text-emerald-300">Ready: {selectedFileName}</p>}
            {fileError && <p className="mx-auto mt-4 max-w-xl rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-sm text-rose-300">{fileError}</p>}
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={goBack} className="quiet-shelf-secondary-action min-h-11"><ArrowLeft className="h-4 w-4" /> Back</button>
            <button type="button" onClick={goNext} disabled={importRecords.length === 0} className="quiet-shelf-primary-action min-h-11 disabled:opacity-50">
              Analyze {importRecords.length > 0 ? `${importRecords.length} Books` : 'File'}<ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {currentStep === 3 && (
        <section className="space-y-4">
          <h2 className="font-serif text-xl font-bold text-[#f4efe6]">File analysis and access</h2>
          <ImportAnalysisSummaryGrid importRecordCount={importRecords.length} currentBookCount={currentBookCount} freeBookLimit={freeBookLimit} remainingFreeSlots={remainingFreeSlots} isPremium={isPremium} />
          {isPremium ? (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-sm text-emerald-200">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <div><p className="font-bold">Premium unlimited import</p><p className="mt-1 text-emerald-100/70">All {importRecords.length} books in this file are eligible to import.</p></div>
            </div>
          ) : importRecords.length > remainingFreeSlots ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-xs text-stone-300">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
              <div><p className="font-bold text-amber-300">Choose up to {remainingFreeSlots} books</p><p className="mt-1">Upgrade to Premium to import the entire file.</p></div>
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={goBack} className="quiet-shelf-secondary-action min-h-11"><ArrowLeft className="h-4 w-4" /> Back</button>
            <button type="button" onClick={goNext} className="quiet-shelf-primary-action min-h-11">Choose Books<ArrowRight className="h-4 w-4" /></button>
          </div>
        </section>
      )}

      {currentStep === 4 && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-serif text-xl font-bold text-[#f4efe6]">Choose books to import</h2>
              <p className="mt-1 text-sm text-stone-400" aria-live="polite"><strong className="text-[#f4efe6]">{selectedIds.length.toLocaleString()}</strong> of {importRecords.length.toLocaleString()} books selected{!isPremium && ` · ${remainingFreeSlots.toLocaleString()} slots available`}.</p>
            </div>
            {!isPremium && <button type="button" onClick={() => openUpgradeModal('Import every book with Inkbound Premium.')} className="text-xs font-bold text-[#e5c158] hover:underline">Upgrade for unlimited imports</button>}
          </div>

          <div className="flex flex-wrap gap-2 rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-3">
            <button type="button" onClick={selectAllEligible} disabled={allEligibleSelected || maximumSelection === 0 || isImporting} className="quiet-shelf-secondary-action min-h-10 px-4 disabled:opacity-40">{isPremium ? 'Select All' : `Select Up to ${remainingFreeSlots}`}</button>
            <button type="button" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0 || isImporting} className="quiet-shelf-secondary-action min-h-10 px-4 disabled:opacity-40">Clear All</button>
            <button type="button" onClick={() => selectByStatus('tbr')} disabled={isImporting} className="quiet-shelf-secondary-action min-h-10 px-4">Select TBR</button>
            <button type="button" onClick={() => selectByStatus('currently-reading')} disabled={isImporting} className="quiet-shelf-secondary-action min-h-10 px-4">Select Reading</button>
            <button type="button" onClick={() => selectByStatus('finished')} disabled={isImporting} className="quiet-shelf-secondary-action min-h-10 px-4">Select Read</button>
          </div>

          {importError && <div role="alert" className="rounded-xl border border-rose-500/35 bg-rose-950/25 p-4 text-sm text-rose-200">{importError}</div>}
          {isImporting && (
            <div className="flex items-center gap-3 rounded-xl border border-[#c5a059]/35 bg-[#c5a059]/10 p-4 text-sm text-[#f4efe6]" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-[#e5c158]" />
              <div><p className="font-bold">Adding books to your library…</p><p className="mt-1 text-xs text-stone-400">Inkbound is finding covers and metadata. Large imports may take a little while.</p></div>
            </div>
          )}

          <div className="space-y-2">
            {importRecords.map((record) => {
              const selected = selectedIds.includes(record.id);
              return (
                <button key={record.id} type="button" onClick={() => toggleSelection(record.id)} disabled={isImporting} aria-pressed={selected} className={`flex min-h-14 w-full items-center gap-3 rounded-xl border p-3 text-left transition disabled:cursor-wait ${selected ? 'border-[#c5a059] bg-[#c5a059]/10' : 'border-[#3d2448] bg-[#1c0f24]'}`}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${selected ? 'border-[#c5a059] bg-[#c5a059] text-[#120817]' : 'border-stone-600 bg-[#120817]'}`}>{selected && <Check className="h-3.5 w-3.5" />}</span>
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm text-[#f4efe6]">{record.title}</strong><small className="block truncate text-stone-400">{record.author}</small></span>
                  <span className="text-[10px] font-bold uppercase text-[#e5c158]">{record.format}</span>
                </button>
              );
            })}
          </div>

          <div className="sticky bottom-0 flex flex-col-reverse gap-3 border-t border-[#3d2448] bg-[#0d0910]/95 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={goBack} disabled={isImporting} className="quiet-shelf-secondary-action min-h-11 disabled:opacity-50">Back</button>
            <button type="button" onClick={() => void executeImport()} disabled={selectedRecords.length === 0 || isImporting} className="quiet-shelf-primary-action min-h-11 disabled:cursor-not-allowed disabled:opacity-50">
              {isImporting ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : `Import ${selectedRecords.length.toLocaleString()} Books`}
            </button>
          </div>
        </section>
      )}

      {currentStep === 5 && (
        <section className="rounded-3xl border border-emerald-500/30 bg-emerald-950/20 p-6 text-center sm:p-10">
          <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-400" />
          <h2 className="mt-4 font-serif text-3xl font-bold text-[#f4efe6]">Import complete</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-stone-400">{importedCount.toLocaleString()} books were added to your Inkbound library.</p>
          {!hasUndone ? (
            <button type="button" onClick={undoImport} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-500/30 px-4 text-xs font-bold text-rose-300"><RotateCcw className="h-4 w-4" /> Undo This Import</button>
          ) : <p className="mt-5 text-xs font-bold text-rose-300">The import was undone.</p>}
        </section>
      )}
    </div>
  );
};
