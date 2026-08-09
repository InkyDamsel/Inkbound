import React, { ChangeEvent, DragEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CopyCheck,
  Download,
  FileClock,
  FileSpreadsheet,
  HelpCircle,
  Loader2,
  RotateCcw,
  SearchCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { Format, ImportRecordItem, ImportSourceInfo, ReadingStatus, UserBookRecord } from '../types';
import { useUserPlan } from '../context/UserPlanContext';
import { analyzeImportDuplicates } from '../features/import/libraryEnrichment';
import {
  getImportVerificationSnapshot,
  readImportMetadataPending,
  resetImportVerificationJob,
  startImportVerificationJob,
  subscribeToImportVerification,
} from '../features/import/importVerificationJob';
import { ImportAnalysisSummaryGrid } from './import/ImportAnalysisSummaryGrid';
import { ImportSourceGrid } from './import/ImportSourceGrid';
import { ImportHistoryScreen } from './ImportHistoryScreen';

interface ImportCenterScreenProps {
  currentBookCount: number;
  onExecuteImport: (importedItems: ImportRecordItem[]) => Promise<void> | void;
  onUndoLastImport?: () => void;
}

export const IMPORT_SOURCES: ImportSourceInfo[] = [
  { id: 'goodreads', name: 'Goodreads', description: 'Import a Goodreads library CSV export.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'storygraph', name: 'StoryGraph', description: 'Import StoryGraph books, tags, and moods.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'hardcover', name: 'Hardcover', description: 'Import your Hardcover library export.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'generic_csv', name: 'Custom File', description: 'Import a CSV or JSON file from another reading service.', badge: 'Any Export', method: 'CSV / JSON', supported: true },
];

const steps = ['Select Source', 'Upload File', 'Analyze', 'Select Books', 'Complete'];
const IMPORT_CENTER_VIEW_KEY = 'inkbound_import_center_view';
const BOOKS_STORAGE_KEY = 'inkbound_books';
const LEGACY_BOOKS_STORAGE_KEY = 'bookhaven_books';
type ImportCenterView = 'import' | 'history';

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
  hardcover: [
    'Open Hardcover and go to Account Settings.',
    'Find Export Data or Library Export.',
    'Download the CSV file to your device.',
  ],
  generic_csv: [
    'Export your library from the original reading app.',
    'Choose CSV or JSON when the service offers a format choice.',
    'Save the export file somewhere easy to find, such as Downloads.',
  ],
};

function readImportCenterView(): ImportCenterView {
  try {
    return localStorage.getItem(IMPORT_CENTER_VIEW_KEY) === 'history' ? 'history' : 'import';
  } catch {
    return 'import';
  }
}

function readStoredLibrary(): UserBookRecord[] {
  try {
    const stored = localStorage.getItem(BOOKS_STORAGE_KEY) ?? localStorage.getItem(LEGACY_BOOKS_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? parsed as UserBookRecord[] : [];
  } catch {
    return [];
  }
}

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
  const normalized = value.trim().toLowerCase();
  if (normalized === 'to-read' || normalized === 'tbr' || normalized.includes('want to read')) return 'tbr';
  if (normalized === 'currently-reading' || normalized === 'currently reading' || normalized === 'reading') return 'currently-reading';
  if (normalized === 'read' || normalized === 'finished' || normalized === 'finish') return 'finished';
  if (normalized.includes('dnf') || normalized.includes('did not finish')) return 'dnf';
  if (normalized.includes('pause')) return 'paused';
  if (normalized.includes('wish')) return 'wishlist';
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
  const initialJob = getImportVerificationSnapshot();

  const [centerView, setCenterView] = useState<ImportCenterView>(() => readImportCenterView());
  const [historyBooks, setHistoryBooks] = useState<UserBookRecord[]>(() => readStoredLibrary());
  const [currentStep, setCurrentStep] = useState(initialJob.status === 'running' ? 4 : initialJob.status === 'complete' ? 5 : 1);
  const [selectedSource, setSelectedSource] = useState<ImportSourceInfo>(IMPORT_SOURCES[0]);
  const [importRecords, setImportRecords] = useState<ImportRecordItem[]>([]);
  const [duplicateRecords, setDuplicateRecords] = useState<ImportRecordItem[]>(initialJob.duplicates);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isImporting, setIsImporting] = useState(initialJob.status === 'running');
  const [importError, setImportError] = useState<string | null>(initialJob.error ?? null);
  const [importedCount, setImportedCount] = useState(initialJob.importedCount);
  const [matchedCount, setMatchedCount] = useState(initialJob.matchedCount);
  const [metadataPendingCount, setMetadataPendingCount] = useState(initialJob.metadataPendingCount);
  const [verificationProgress, setVerificationProgress] = useState({ completed: initialJob.completed, total: initialJob.total });
  const [hasUndone, setHasUndone] = useState(false);

  const switchCenterView = (view: ImportCenterView) => {
    setCenterView(view);
    if (view === 'history') setHistoryBooks(readStoredLibrary());
    try { localStorage.setItem(IMPORT_CENTER_VIEW_KEY, view); } catch { /* no-op */ }
  };

  const resumeHistoryEnrichment = () => {
    setHistoryBooks(readStoredLibrary());
    window.dispatchEvent(new Event('online'));
    window.setTimeout(() => setHistoryBooks(readStoredLibrary()), 750);
  };

  useEffect(() => subscribeToImportVerification((job) => {
    setIsImporting(job.status === 'running');
    setVerificationProgress({ completed: job.completed, total: job.total });
    setImportedCount(job.importedCount);
    setMatchedCount(job.matchedCount);
    setMetadataPendingCount(job.metadataPendingCount);
    setDuplicateRecords(job.duplicates);

    if (job.status === 'running') {
      setCurrentStep(4);
      setImportError(null);
    } else if (job.status === 'complete') {
      setCurrentStep(5);
      setImportError(null);
    } else if (job.status === 'error') {
      setCurrentStep(4);
      setImportError(job.error ?? 'The import could not be completed. Your library was not changed.');
    }
  }), []);

  const duplicateIds = useMemo(() => new Set(duplicateRecords.map((record) => record.id)), [duplicateRecords]);
  const newRecords = useMemo(() => importRecords.filter((record) => !duplicateIds.has(record.id)), [importRecords, duplicateIds]);
  const selectedRecords = useMemo(
    () => newRecords.filter((record) => selectedIds.includes(record.id)),
    [newRecords, selectedIds],
  );

  const maximumSelection = isPremium ? newRecords.length : remainingFreeSlots;
  const allEligibleSelected =
    newRecords.length > 0 && selectedIds.length === Math.min(newRecords.length, maximumSelection);

  const goNext = () => setCurrentStep((step) => Math.min(5, step + 1));
  const goBack = () => setCurrentStep((step) => Math.max(1, step - 1));

  const processFile = async (file?: File) => {
    if (!file) return;
    resetImportVerificationJob();
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'json'].includes(extension ?? '')) {
      setFileError('Choose a CSV or JSON export file.');
      return;
    }

    setIsReadingFile(true);
    setFileError(null);
    setImportError(null);
    setImportedCount(0);
    setMatchedCount(0);
    setMetadataPendingCount(0);
    setHasUndone(false);
    try {
      const records = await readImportFile(file);
      if (records.length === 0) throw new Error('No recognizable book records were found in this file.');
      const duplicateAnalysis = analyzeImportDuplicates(records);
      setImportRecords(records);
      setDuplicateRecords(duplicateAnalysis.duplicates);
      setSelectedFileName(file.name);
      const initialLimit = isPremium ? duplicateAnalysis.unique.length : remainingFreeSlots;
      setSelectedIds(duplicateAnalysis.unique.slice(0, initialLimit).map((record) => record.id));
    } catch (error) {
      setImportRecords([]);
      setDuplicateRecords([]);
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
    if (isImporting || duplicateIds.has(recordId)) return;
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
    const limit = isPremium ? newRecords.length : remainingFreeSlots;
    setSelectedIds(newRecords.slice(0, limit).map((record) => record.id));
  };

  const selectByStatus = (status: ReadingStatus) => {
    setSelectedIds(
      newRecords
        .filter((record) => record.status === status)
        .slice(0, isPremium ? newRecords.length : remainingFreeSlots)
        .map((record) => record.id),
    );
  };

  const executeImport = () => {
    if (selectedRecords.length === 0 || isImporting) return;
    if (!navigator.onLine) {
      setImportError('Connect to the internet before importing so Inkbound can check optional cover and summary metadata.');
      return;
    }

    const recordsToCheck = [...selectedRecords];
    setImportError(null);
    setVerificationProgress({ completed: 0, total: recordsToCheck.length });
    void startImportVerificationJob(recordsToCheck, duplicateRecords, onExecuteImport);
  };

  const undoImport = () => {
    onUndoLastImport?.();
    setHasUndone(true);
  };

  const downloadMetadataPending = () => {
    const pending = readImportMetadataPending();
    if (pending.length === 0) return;
    const escapeCsv = (value?: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Title', 'Author', 'ISBN', 'Status', 'Format'],
      ...pending.map((record) => [record.title, record.author, record.isbn ?? '', record.status, record.format]),
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inkbound-metadata-pending.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 pb-20">
      <header>
        <span className="rounded border border-[#c5a059]/30 bg-[#c5a059]/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-[#e5c158]">
          Library Migration
        </span>
        <h1 className="mt-2 font-serif text-3xl font-bold text-[#f4efe6]">Import Center</h1>
        <p className="mt-1 text-sm text-stone-400">Import a library or review the history and optional book-detail updates from previous imports.</p>
      </header>

      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-[#3d2448] bg-[#120817] p-1" role="tablist" aria-label="Import Center views">
        <button type="button" role="tab" aria-selected={centerView === 'import'} onClick={() => switchCenterView('import')} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition ${centerView === 'import' ? 'bg-[#c5a059] text-[#120817]' : 'text-stone-400 hover:bg-[#1c0f24] hover:text-[#f4efe6]'}`}>
          <Upload className="h-4 w-4" /> Import Books
        </button>
        <button type="button" role="tab" aria-selected={centerView === 'history'} onClick={() => switchCenterView('history')} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition ${centerView === 'history' ? 'bg-[#c5a059] text-[#120817]' : 'text-stone-400 hover:bg-[#1c0f24] hover:text-[#f4efe6]'}`}>
          <FileClock className="h-4 w-4" /> History
        </button>
      </div>

      {centerView === 'history' ? (
        <ImportHistoryScreen books={historyBooks} onResumeEnrichment={resumeHistoryEnrichment} />
      ) : (
        <>
          <div className="flex items-start gap-3 rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-4 text-xs text-stone-300">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[#c5a059]" />
            <div>
              <p className="font-bold text-[#f4efe6]">Your export is the source of truth</p>
              <p className="mt-1 text-stone-400">Inkbound imports your selected non-duplicate books using the title, author, shelf, rating, dates, review, and ISBN from your export. External book sources are only used to verify optional covers, summaries, and edition details.</p>
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

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-stone-500">Found in file</p>
                  <p className="mt-2 font-serif text-3xl text-[#f4efe6]">{importRecords.length.toLocaleString()}</p>
                </div>
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/15 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-400/80">New books</p>
                  <p className="mt-2 font-serif text-3xl text-emerald-200">{newRecords.length.toLocaleString()}</p>
                </div>
                <div className="rounded-2xl border border-amber-500/25 bg-amber-950/15 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-400/80">Duplicates skipped</p>
                  <p className="mt-2 font-serif text-3xl text-amber-200">{duplicateRecords.length.toLocaleString()}</p>
                </div>
              </div>

              {duplicateRecords.length > 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-stone-300">
                  <CopyCheck className="h-5 w-5 shrink-0 text-amber-300" />
                  <div>
                    <p className="font-bold text-amber-200">Duplicates will not be added again</p>
                    <p className="mt-1 text-xs leading-5 text-stone-400">Inkbound matched {duplicateRecords.length.toLocaleString()} {duplicateRecords.length === 1 ? 'book' : 'books'} by ISBN or exact title + author, including repeats already in your library and repeats inside this file.</p>
                  </div>
                </div>
              )}

              {isPremium ? (
                <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-sm text-emerald-200">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <div><p className="font-bold">Premium unlimited import</p><p className="mt-1 text-emerald-100/70">All {newRecords.length.toLocaleString()} new books are ready to import.</p></div>
                </div>
              ) : newRecords.length > remainingFreeSlots ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-xs text-stone-300">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
                  <div><p className="font-bold text-amber-300">Choose up to {remainingFreeSlots} books</p><p className="mt-1">Upgrade to Premium to import the entire file.</p></div>
                </div>
              ) : null}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={goBack} className="quiet-shelf-secondary-action min-h-11"><ArrowLeft className="h-4 w-4" /> Back</button>
                <button type="button" onClick={goNext} disabled={newRecords.length === 0} className="quiet-shelf-primary-action min-h-11 disabled:opacity-50">Choose Books<ArrowRight className="h-4 w-4" /></button>
              </div>
            </section>
          )}

          {currentStep === 4 && (
            <section className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="font-serif text-xl font-bold text-[#f4efe6]">Choose books to import</h2>
                  <p className="mt-1 text-sm text-stone-400" aria-live="polite"><strong className="text-[#f4efe6]">{selectedIds.length.toLocaleString()}</strong> of {newRecords.length.toLocaleString()} new books selected{duplicateRecords.length > 0 && ` · ${duplicateRecords.length.toLocaleString()} duplicates already skipped`}{!isPremium && ` · ${remainingFreeSlots.toLocaleString()} slots available`}.</p>
                </div>
                {!isPremium && <button type="button" onClick={() => openUpgradeModal('Import every book with Inkbound Premium.')} className="text-xs font-bold text-[#e5c158] hover:underline">Upgrade for unlimited imports</button>}
              </div>

              <div className="flex flex-wrap gap-2 rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-3">
                <button type="button" onClick={selectAllEligible} disabled={allEligibleSelected || maximumSelection === 0 || isImporting} className="quiet-shelf-secondary-action min-h-10 px-4 disabled:opacity-40">{isPremium ? 'Select All New' : `Select Up to ${remainingFreeSlots}`}</button>
                <button type="button" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0 || isImporting} className="quiet-shelf-secondary-action min-h-10 px-4 disabled:opacity-40">Clear All</button>
                <button type="button" onClick={() => selectByStatus('tbr')} disabled={isImporting} className="quiet-shelf-secondary-action min-h-10 px-4">Select TBR</button>
                <button type="button" onClick={() => selectByStatus('currently-reading')} disabled={isImporting} className="quiet-shelf-secondary-action min-h-10 px-4">Select Reading</button>
                <button type="button" onClick={() => selectByStatus('finished')} disabled={isImporting} className="quiet-shelf-secondary-action min-h-10 px-4">Select Read</button>
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-amber-500/35 bg-amber-950/20 p-4 text-sm text-stone-300">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div>
                  <p className="font-bold text-amber-200">Keep Inkbound open while metadata checking runs</p>
                  <p className="mt-1 text-xs leading-5 text-stone-400">Your selected books will be imported from the export. Inkbound is only checking which covers and summaries can be trusted. You can move to other Inkbound pages, but do not close or refresh until this step finishes.</p>
                </div>
              </div>

              {importError && <div role="alert" className="rounded-xl border border-rose-500/35 bg-rose-950/25 p-4 text-sm text-rose-200">{importError}</div>}
              {isImporting && (
                <div className="rounded-xl border border-[#c5a059]/35 bg-[#c5a059]/10 p-4 text-sm text-[#f4efe6]" role="status">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-[#e5c158]" />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">Checking optional metadata…</p>
                      <p className="mt-1 text-xs text-stone-400">Books that cannot be matched will still be imported safely with placeholders and queued for later enrichment.</p>
                    </div>
                    <span className="text-xs font-bold text-[#e5c158]">{verificationProgress.completed.toLocaleString()} / {verificationProgress.total.toLocaleString()}</span>
                  </div>
                  {verificationProgress.total > 0 && (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/25">
                      <div className="h-full rounded-full bg-[#c5a059] transition-[width]" style={{ width: `${Math.round((verificationProgress.completed / verificationProgress.total) * 100)}%` }} />
                    </div>
                  )}
                </div>
              )}

              {newRecords.length > 0 && (
                <div className="space-y-2">
                  {newRecords.map((record) => {
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
              )}

              <div className="sticky bottom-0 flex flex-col-reverse gap-3 border-t border-[#3d2448] bg-[#0d0910]/95 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={goBack} disabled={isImporting} className="quiet-shelf-secondary-action min-h-11 disabled:opacity-50">Back</button>
                <button type="button" onClick={executeImport} disabled={selectedRecords.length === 0 || isImporting} className="quiet-shelf-primary-action min-h-11 disabled:cursor-not-allowed disabled:opacity-50">
                  {isImporting ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking metadata…</> : `Import ${selectedRecords.length.toLocaleString()} Books`}
                </button>
              </div>
            </section>
          )}

          {currentStep === 5 && (
            <section className="space-y-5">
              <div className="rounded-3xl border border-emerald-500/30 bg-emerald-950/20 p-6 text-center sm:p-10">
                <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-400" />
                <h2 className="mt-4 font-serif text-3xl font-bold text-[#f4efe6]">Import complete</h2>
                <p className="mx-auto mt-2 max-w-lg text-sm text-stone-400">
                  {importedCount.toLocaleString()} {importedCount === 1 ? 'book was' : 'books were'} added from your export. Metadata matching does not block library imports.
                </p>
                <div className="mx-auto mt-5 flex max-w-3xl flex-wrap justify-center gap-2 text-xs">
                  <span className="rounded-full border border-emerald-500/25 bg-emerald-950/30 px-3 py-1.5 text-emerald-200">{importedCount.toLocaleString()} imported</span>
                  <span className="rounded-full border border-sky-500/25 bg-sky-950/25 px-3 py-1.5 text-sky-200">{matchedCount.toLocaleString()} metadata matched now</span>
                  <span className="rounded-full border border-[#c5a059]/25 bg-[#c5a059]/10 px-3 py-1.5 text-[#e5c158]">{metadataPendingCount.toLocaleString()} metadata queued</span>
                  <span className="rounded-full border border-amber-500/25 bg-amber-950/30 px-3 py-1.5 text-amber-200">{duplicateRecords.length.toLocaleString()} duplicates skipped</span>
                </div>
                {importedCount > 0 && !hasUndone ? (
                  <button type="button" onClick={undoImport} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-500/30 px-4 text-xs font-bold text-rose-300"><RotateCcw className="h-4 w-4" /> Undo This Import</button>
                ) : hasUndone ? <p className="mt-5 text-xs font-bold text-rose-300">The import was undone.</p> : null}
              </div>

              {duplicateRecords.length > 0 && (
                <section className="rounded-3xl border border-amber-500/25 bg-amber-950/10 p-5 sm:p-6">
                  <div className="flex items-start gap-3">
                    <CopyCheck className="mt-0.5 h-6 w-6 shrink-0 text-amber-300" />
                    <div>
                      <h3 className="font-serif text-2xl text-[#f4efe6]">{duplicateRecords.length.toLocaleString()} duplicates skipped</h3>
                      <p className="mt-1 text-sm leading-6 text-stone-400">These books already existed in Inkbound or appeared more than once in the uploaded file, so no extra copies were created.</p>
                    </div>
                  </div>
                </section>
              )}

              {metadataPendingCount > 0 && (
                <section className="rounded-3xl border border-[#c5a059]/30 bg-[#c5a059]/10 p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <SearchCheck className="mt-0.5 h-6 w-6 shrink-0 text-[#e5c158]" />
                      <div>
                        <h3 className="font-serif text-2xl text-[#f4efe6]">{metadataPendingCount.toLocaleString()} {metadataPendingCount === 1 ? 'book is' : 'books are'} awaiting metadata</h3>
                        <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-400">These books are already in your Inkbound library using the data from your export. Inkbound did not trust an external cover or summary yet, so those details will continue through the background enrichment queue instead of blocking your import.</p>
                      </div>
                    </div>
                    <button type="button" onClick={downloadMetadataPending} className="quiet-shelf-secondary-action min-h-10 shrink-0 px-4">
                      <Download className="h-4 w-4" /> Download List
                    </button>
                  </div>
                </section>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};