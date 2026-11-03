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
import { normalizeBookRating, normalizeSpiceLevel } from '../features/reading/bookRating';
import { analyzeImportDuplicates } from '../features/import/libraryEnrichment';
import { findExistingImportMatch } from '../features/import/safeReimportMerge';
import { readXlsxRecords } from '../features/import/spreadsheetImport';
import {
  detectImportColumnMapping,
  ImportColumnMapping,
  ImportFieldKey,
  mappedValue,
} from '../features/import/columnMapping';
import {
  getImportVerificationSnapshot,
  readImportMetadataPending,
  resetImportVerificationJob,
  startImportVerificationJob,
  type ImportExecutionResult,
  subscribeToImportVerification,
} from '../features/import/importVerificationJob';
import { ImportAnalysisSummaryGrid } from './import/ImportAnalysisSummaryGrid';
import { ImportColumnMappingPanel } from './import/ImportColumnMappingPanel';
import { ImportSourceGrid } from './import/ImportSourceGrid';
import { ImportHistoryScreen } from './ImportHistoryScreen';

interface ImportCenterScreenProps {
  books: UserBookRecord[];
  onExecuteImport: (importedItems: ImportRecordItem[]) => Promise<ImportExecutionResult> | ImportExecutionResult;
  onUndoLastImport?: () => void;
  onRetryEnrichment: (targetBookIds: string[]) => Promise<void>;
}

export const IMPORT_SOURCES: ImportSourceInfo[] = [
  { id: 'goodreads', name: 'Goodreads', description: 'Import a Goodreads library CSV export.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'storygraph', name: 'StoryGraph', description: 'Import StoryGraph books, tags, and moods.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'hardcover', name: 'Hardcover', description: 'Import your Hardcover library export.', badge: 'CSV Export', method: 'CSV File', supported: true },
  { id: 'generic_csv', name: 'Custom File', description: 'Import a CSV, Excel, or JSON library export from another reading service.', badge: 'Any Export', method: 'CSV / XLSX / JSON', supported: true },
];

const steps = ['Select Source', 'Upload File', 'Analyze', 'Select Books', 'Complete'];
const IMPORT_CENTER_VIEW_KEY = 'inkbound_import_center_view';
const LARGE_LIBRARY_IMPORT_THRESHOLD = 5_000;
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
    'Export your library from the original reading app or book tracker.',
    'Download the export as CSV, Excel (.xlsx), or JSON. You do not need to convert an Excel-only export first.',
    'Inkbound will guess which columns contain each book detail, then let you correct anything that does not look right before import.',
  ],
};

function readImportCenterView(): ImportCenterView {
  try { return localStorage.getItem(IMPORT_CENTER_VIEW_KEY) === 'history' ? 'history' : 'import'; } catch { return 'import'; }
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header, index) => header.trim() || `Column ${index + 1}`);
  return rows.slice(1).map((cells) => headers.reduce<Record<string, string>>((record, header, index) => {
    record[header] = cells[index]?.trim() ?? '';
    return record;
  }, {}));
}

function normalizeFormat(value: string): Format {
  const normalized = value.toLowerCase();
  if (normalized.includes('audio')) return 'audiobook';
  if (normalized.includes('ebook') || normalized.includes('e-book') || normalized.includes('kindle') || normalized.includes('digital')) return 'ebook';
  if (normalized.includes('paper') || normalized.includes('softcover')) return 'paperback';
  return 'hardcover';
}

function normalizeStatus(value: string): ReadingStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'to-read' || normalized === 'to read' || normalized === 'tbr' || normalized.includes('want to read')) return 'tbr';
  if (normalized === 'currently-reading' || normalized === 'currently reading' || normalized === 'reading' || normalized === 'in progress') return 'currently-reading';
  if (normalized === 'read' || normalized === 'finished' || normalized === 'finish' || normalized === 'completed') return 'finished';
  if (normalized.includes('dnf') || normalized.includes('did not finish') || normalized.includes('abandoned')) return 'dnf';
  if (normalized.includes('pause') || normalized.includes('on hold')) return 'paused';
  if (normalized.includes('wish')) return 'wishlist';
  return 'tbr';
}

function positiveInteger(value: string): number | undefined {
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
}

function optionalNumber(value: string): number | undefined {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function importedCoverUrl(value: string): string | undefined {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

function splitImportList(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const values = trimmed.split(/[,;|\n]+/).map((item) => item.trim()).filter(Boolean);
  return values.length ? [...new Set(values)] : undefined;
}

function mapRecord(record: Record<string, unknown>, index: number, mapping: ImportColumnMapping): ImportRecordItem | null {
  const title = mappedValue(record, mapping, 'title');
  if (!title) return null;
  const author = mappedValue(record, mapping, 'author') || 'Unknown Author';
  const isbn = mappedValue(record, mapping, 'isbn');
  const ratingValue = Number(mappedValue(record, mapping, 'rating'));
  const spiceValue = Number(mappedValue(record, mapping, 'spiceLevel'));
  return {
    id: `import-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}`,
    title,
    author,
    isbn: isbn || undefined,
    format: normalizeFormat(mappedValue(record, mapping, 'format')),
    status: normalizeStatus(mappedValue(record, mapping, 'status')),
    rating: Number.isFinite(ratingValue) && ratingValue > 0 ? normalizeBookRating(ratingValue) : undefined,
    spiceLevel: Number.isFinite(spiceValue) ? normalizeSpiceLevel(spiceValue) : undefined,
    dateStarted: mappedValue(record, mapping, 'dateStarted') || undefined,
    dateRead: mappedValue(record, mapping, 'dateRead') || undefined,
    dateAdded: mappedValue(record, mapping, 'dateAdded') || new Date().toISOString().split('T')[0],
    pageCount: positiveInteger(mappedValue(record, mapping, 'pageCount')),
    coverUrl: importedCoverUrl(mappedValue(record, mapping, 'coverUrl')),
    review: mappedValue(record, mapping, 'review') || undefined,
    tags: splitImportList(mappedValue(record, mapping, 'tags')),
    sourceShelves: splitImportList(mappedValue(record, mapping, 'shelves')),
    sourceCollections: splitImportList(mappedValue(record, mapping, 'collections')),
    seriesName: mappedValue(record, mapping, 'seriesName') || undefined,
    seriesOrder: optionalNumber(mappedValue(record, mapping, 'seriesOrder')),
    seriesLabel: mappedValue(record, mapping, 'seriesLabel') || undefined,
    seriesSource: mappedValue(record, mapping, 'seriesSource') || undefined,
    confidence: 100,
    duplicateAction: 'skip',
    coverGradient: 'from-[#5c3d62] via-[#35243f] to-[#171117]',
  };
}

async function readRawImportFile(file: File): Promise<Record<string, unknown>[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'xlsx') return readXlsxRecords(file);
  const text = await file.text();
  if (extension === 'json' || file.type.includes('json')) {
    const parsed: unknown = JSON.parse(text);
    const array = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? Object.values(parsed as Record<string, unknown>).find(Array.isArray) ?? [] : [];
    return (array as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  return parseCsv(text);
}

export const ImportCenterScreen: React.FC<ImportCenterScreenProps> = ({ books, onExecuteImport, onUndoLastImport, onRetryEnrichment }) => {
  const initialJob = getImportVerificationSnapshot();
  const [centerView, setCenterView] = useState<ImportCenterView>(() => readImportCenterView());
  const [currentStep, setCurrentStep] = useState(initialJob.status === 'running' ? 4 : initialJob.status === 'complete' ? 5 : 1);
  const [selectedSource, setSelectedSource] = useState<ImportSourceInfo>(IMPORT_SOURCES[0]);
  const [rawRecords, setRawRecords] = useState<Record<string, unknown>[]>([]);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ImportColumnMapping>({});
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
    try { localStorage.setItem(IMPORT_CENTER_VIEW_KEY, view); } catch { /* no-op */ }
  };
  const resumeHistoryEnrichment = () => window.dispatchEvent(new Event('online'));

  useEffect(() => subscribeToImportVerification((job) => {
    setIsImporting(job.status === 'running');
    setVerificationProgress({ completed: job.completed, total: job.total });
    setImportedCount(job.importedCount);
    setMatchedCount(job.matchedCount);
    setMetadataPendingCount(job.metadataPendingCount);
    setDuplicateRecords(job.duplicates);
    if (job.status === 'running') { setCurrentStep(4); setImportError(null); }
    else if (job.status === 'complete') { setCurrentStep(5); setImportError(null); }
    else if (job.status === 'error') { setCurrentStep(4); setImportError(job.error ?? 'The import could not be completed. Your library was not changed.'); }
  }), []);

  const duplicateIds = useMemo(() => new Set(duplicateRecords.map((record) => record.id)), [duplicateRecords]);
  const mergeRecords = useMemo(() => importRecords.filter((record) => record.duplicateAction === 'merge'), [importRecords]);
  const newRecords = useMemo(() => importRecords.filter((record) => record.duplicateAction !== 'merge' && !duplicateIds.has(record.id)), [importRecords, duplicateIds]);
  const eligibleRecords = useMemo(() => [...newRecords, ...mergeRecords], [newRecords, mergeRecords]);
  const selectedRecords = useMemo(() => eligibleRecords.filter((record) => selectedIds.includes(record.id)), [eligibleRecords, selectedIds]);
  const maximumSelection = eligibleRecords.length;
  const allEligibleSelected = eligibleRecords.length > 0 && selectedIds.length === eligibleRecords.length;
  const mappingReady = Boolean(columnMapping.title) && importRecords.length > 0;
  const isLargeSelectedImport = selectedRecords.length >= LARGE_LIBRARY_IMPORT_THRESHOLD;
  const isLargeCompletedImport = importedCount >= LARGE_LIBRARY_IMPORT_THRESHOLD || metadataPendingCount >= LARGE_LIBRARY_IMPORT_THRESHOLD;

  const goNext = () => setCurrentStep((step) => Math.min(5, step + 1));
  const goBack = () => setCurrentStep((step) => Math.max(1, step - 1));

  const applyMapping = (records: Record<string, unknown>[], mapping: ImportColumnMapping) => {
    const mappedRecords = records.map((record, index) => mapRecord(record, index, mapping)).filter((item): item is ImportRecordItem => Boolean(item));
    const mergeCandidates: ImportRecordItem[] = [];
    const newCandidates: ImportRecordItem[] = [];
    for (const item of mappedRecords) {
      const existing = findExistingImportMatch(item, books);
      if (existing) mergeCandidates.push({ ...item, matchedBookId: existing.id, duplicateAction: 'merge' });
      else newCandidates.push(item);
    }
    const duplicateAnalysis = analyzeImportDuplicates(newCandidates, books);
    const nextRecords = [...duplicateAnalysis.unique, ...mergeCandidates, ...duplicateAnalysis.duplicates];
    setImportRecords(nextRecords);
    setDuplicateRecords(duplicateAnalysis.duplicates);
    setSelectedIds([...duplicateAnalysis.unique, ...mergeCandidates].map((record) => record.id));
  };

  const updateColumnMapping = (field: ImportFieldKey, header: string) => {
    const next = { ...columnMapping };
    if (header) next[field] = header; else delete next[field];
    setColumnMapping(next);
    applyMapping(rawRecords, next);
    setFileError(null);
  };

  const processFile = async (file?: File) => {
    if (!file) return;
    resetImportVerificationJob();
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'json'].includes(extension ?? '')) { setFileError('Choose a CSV, Excel (.xlsx), or JSON export file.'); return; }
    setIsReadingFile(true);
    setFileError(null);
    setImportError(null);
    setImportedCount(0);
    setMatchedCount(0);
    setMetadataPendingCount(0);
    setHasUndone(false);
    try {
      const records = await readRawImportFile(file);
      if (records.length === 0) throw new Error('No library rows were found in this file.');
      const headers = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
      if (headers.length === 0) throw new Error('No column names were found in this file.');
      const detectedMapping = detectImportColumnMapping(headers);
      setRawRecords(records);
      setFileHeaders(headers);
      setColumnMapping(detectedMapping);
      setSelectedFileName(file.name);
      applyMapping(records, detectedMapping);
    } catch (error) {
      setRawRecords([]); setFileHeaders([]); setColumnMapping({}); setImportRecords([]); setDuplicateRecords([]); setSelectedIds([]); setSelectedFileName('');
      setFileError(error instanceof Error ? error.message : 'Inkbound could not read this export file.');
    } finally { setIsReadingFile(false); }
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => { void processFile(event.target.files?.[0]); event.target.value = ''; };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); void processFile(event.dataTransfer.files?.[0]); };
  const toggleSelection = (recordId: string) => {
    if (isImporting || duplicateIds.has(recordId)) return;
    setSelectedIds((current) => current.includes(recordId) ? current.filter((id) => id !== recordId) : [...current, recordId]);
  };
  const selectAllEligible = () => setSelectedIds(eligibleRecords.map((record) => record.id));
  const selectByStatus = (status: ReadingStatus) => setSelectedIds(eligibleRecords.filter((record) => record.status === status).map((record) => record.id));
  const executeImport = () => {
    if ((selectedRecords.length === 0 && duplicateRecords.length === 0) || isImporting) return;
    if (!navigator.onLine && selectedRecords.length > 0) { setImportError('Connect to the internet before importing so Inkbound can look for optional covers and summaries.'); return; }
    const recordsToCheck = [...selectedRecords];
    setImportError(null);
    setVerificationProgress({ completed: 0, total: recordsToCheck.length });
    void startImportVerificationJob(recordsToCheck, duplicateRecords, onExecuteImport, books, selectedFileName || undefined);
  };
  const undoImport = () => { onUndoLastImport?.(); setHasUndone(true); };

  const downloadMetadataPending = () => {
    const pending = readImportMetadataPending();
    if (pending.length === 0) return;
    const escapeCsv = (value?: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [['Title', 'Author', 'ISBN', 'Status', 'Format'], ...pending.map((record) => [record.title, record.author, record.isbn ?? '', record.status, record.format])];
    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inkbound-book-details-pending.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 pb-20">
      <header><span className="rounded border border-[#c5a059]/30 bg-[#c5a059]/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-[#e5c158]">Library Import</span><h1 className="mt-2 font-serif text-3xl font-bold text-[#f4efe6]">Import Center</h1><p className="mt-1 text-sm text-stone-400">Import a library or safely update missing information from a newer export.</p></header>
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-[#3d2448] bg-[#120817] p-1" role="tablist" aria-label="Import Center views"><button type="button" role="tab" aria-selected={centerView === 'import'} onClick={() => switchCenterView('import')} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition ${centerView === 'import' ? 'bg-[#c5a059] text-[#120817]' : 'text-stone-400 hover:bg-[#1c0f24] hover:text-[#f4efe6]'}`}><Upload className="h-4 w-4" /> Import Books</button><button type="button" role="tab" aria-selected={centerView === 'history'} onClick={() => switchCenterView('history')} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition ${centerView === 'history' ? 'bg-[#c5a059] text-[#120817]' : 'text-stone-400 hover:bg-[#1c0f24] hover:text-[#f4efe6]'}`}><FileClock className="h-4 w-4" /> History</button></div>
      {centerView === 'history' ? <ImportHistoryScreen books={books} onResumeEnrichment={resumeHistoryEnrichment} onRetryEnrichment={onRetryEnrichment} /> : <>
        <div className="flex items-start gap-3 rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-4 text-xs text-stone-300"><Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[#c5a059]" /><div><p className="font-bold text-[#f4efe6]">Your export is the source of truth on first import</p><p className="mt-1 text-stone-400">On a re-import, Inkbound keeps your existing reader-edited data and only fills missing information or merges additive fields such as tags and Collections. Manual covers, existing finished dates, Collections, and manual series work are never replaced by a re-import.</p></div></div>
        <div className="overflow-x-auto rounded-2xl border border-[#3d2448] bg-[#120817] p-3"><div className="flex min-w-[560px] items-center justify-between gap-2">{steps.map((label, index) => { const step = index + 1; const active = step === currentStep; const complete = step < currentStep; return <div key={label} className={`flex items-center gap-2 text-xs font-semibold ${active ? 'text-[#e5c158]' : complete ? 'text-emerald-400' : 'text-stone-500'}`}><span className={`grid h-7 w-7 place-items-center rounded-full ${active ? 'bg-[#c5a059] text-[#120817]' : complete ? 'bg-emerald-950 text-emerald-300' : 'bg-[#25132f] text-stone-500'}`}>{complete ? '✓' : step}</span><span>{label}</span></div>; })}</div></div>

        {currentStep === 1 && <section className="space-y-4"><h2 className="font-serif text-xl font-bold text-[#f4efe6]">Choose an import source</h2><ImportSourceGrid sources={IMPORT_SOURCES} selectedSourceId={selectedSource.id} onSelectSource={setSelectedSource} /><div className="flex justify-end"><button type="button" onClick={goNext} className="quiet-shelf-primary-action min-h-11">Continue with {selectedSource.name}<ArrowRight className="h-4 w-4" /></button></div></section>}

        {currentStep === 2 && <section className="space-y-5"><div><h2 className="font-serif text-xl font-bold text-[#f4efe6]">Upload {selectedSource.name} export</h2><p className="mt-1 text-sm text-stone-400">Choose the file you downloaded from {selectedSource.name}.</p></div><section className="rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-5"><div className="flex items-start gap-3"><HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#e5c158]" /><div><h3 className="font-bold text-[#f4efe6]">How to find your export file</h3><ol className="mt-3 space-y-2 text-sm text-stone-400">{sourceInstructions[selectedSource.id].map((instruction, index) => <li key={instruction} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#c5a059]/15 text-xs font-bold text-[#e5c158]">{index + 1}</span><span>{instruction}</span></li>)}</ol></div></div></section><div onDragOver={(event) => event.preventDefault()} onDrop={onDrop} className="rounded-2xl border border-dashed border-[#c5a059] bg-[#1c0f24] p-8 text-center sm:p-12"><Upload className="mx-auto h-12 w-12 text-[#c5a059]" /><p className="mt-3 font-serif text-lg font-bold text-[#f4efe6]">Drag and drop your CSV, Excel, or JSON file</p><p className="mt-1 text-xs text-stone-400">Excel .xlsx files are read directly — no conversion required.</p><label className="quiet-shelf-primary-action mt-5 inline-flex min-h-11 cursor-pointer"><FileSpreadsheet className="h-4 w-4" />{isReadingFile ? 'Reading file…' : 'Choose Export File'}<input type="file" accept=".csv,.xlsx,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFileInput} className="sr-only" disabled={isReadingFile} /></label>{selectedFileName && <p className="mt-4 text-sm font-semibold text-emerald-300">Ready: {selectedFileName}</p>}{fileError && <p className="mx-auto mt-4 max-w-xl rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-sm text-rose-300">{fileError}</p>}</div>{rawRecords.length > 0 && <ImportColumnMappingPanel headers={fileHeaders} mapping={columnMapping} rowCount={rawRecords.length} onChange={updateColumnMapping} />}<div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={goBack} className="quiet-shelf-secondary-action min-h-11"><ArrowLeft className="h-4 w-4" /> Back</button><button type="button" onClick={goNext} disabled={!mappingReady} className="quiet-shelf-primary-action min-h-11 disabled:opacity-50">Review {importRecords.length > 0 ? `${importRecords.length} Books` : 'File'}<ArrowRight className="h-4 w-4" /></button></div></section>}

        {currentStep === 3 && <section className="space-y-4"><h2 className="font-serif text-xl font-bold text-[#f4efe6]">Review your import</h2><ImportAnalysisSummaryGrid importRecordCount={importRecords.length} /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-4"><p className="text-xs font-bold uppercase tracking-wider text-stone-500">Found in file</p><p className="mt-2 font-serif text-3xl text-[#f4efe6]">{importRecords.length.toLocaleString()}</p></div><div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/15 p-4"><p className="text-xs font-bold uppercase tracking-wider text-emerald-400/80">New books</p><p className="mt-2 font-serif text-3xl text-emerald-200">{newRecords.length.toLocaleString()}</p></div><div className="rounded-2xl border border-sky-500/25 bg-sky-950/15 p-4"><p className="text-xs font-bold uppercase tracking-wider text-sky-300/80">Existing to enrich</p><p className="mt-2 font-serif text-3xl text-sky-200">{mergeRecords.length.toLocaleString()}</p></div><div className="rounded-2xl border border-amber-500/25 bg-amber-950/15 p-4"><p className="text-xs font-bold uppercase tracking-wider text-amber-400/80">Repeats skipped</p><p className="mt-2 font-serif text-3xl text-amber-200">{duplicateRecords.length.toLocaleString()}</p></div></div>{mergeRecords.length > 0 && <div className="flex items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-950/20 p-4 text-sm text-stone-300"><SearchCheck className="h-5 w-5 shrink-0 text-sky-300" /><div><p className="font-bold text-sky-200">Existing books will be safely enriched</p><p className="mt-1 text-xs leading-5 text-stone-400">Inkbound can fill missing ISBNs, pages, ratings, finished dates, reviews, tags, shelves, mapped Collections, and series metadata without replacing reader-edited data.</p></div></div>}{duplicateRecords.length > 0 && <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-stone-300"><CopyCheck className="h-5 w-5 shrink-0 text-amber-300" /><div><p className="font-bold text-amber-200">Repeated rows will not create extra copies</p><p className="mt-1 text-xs leading-5 text-stone-400">Inkbound found {duplicateRecords.length.toLocaleString()} repeated {duplicateRecords.length === 1 ? 'row' : 'rows'} inside the uploaded file.</p></div></div>}<div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-sm text-emerald-200"><CheckCircle2 className="h-5 w-5 shrink-0" /><div><p className="font-bold">Ready</p><p className="mt-1 text-emerald-100/70">{newRecords.length.toLocaleString()} new and {mergeRecords.length.toLocaleString()} existing {mergeRecords.length === 1 ? 'book is' : 'books are'} available to process.</p></div></div><div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={goBack} className="quiet-shelf-secondary-action min-h-11"><ArrowLeft className="h-4 w-4" /> Back</button><button type="button" onClick={goNext} disabled={eligibleRecords.length === 0} className="quiet-shelf-primary-action min-h-11 disabled:opacity-50">Choose Books<ArrowRight className="h-4 w-4" /></button></div></section>}

        {currentStep === 4 && <section className="space-y-4"><div><h2 className="font-serif text-xl font-bold text-[#f4efe6]">Choose books to process</h2><p className="mt-1 text-sm text-stone-400" aria-live="polite"><strong className="text-[#f4efe6]">{selectedIds.length.toLocaleString()}</strong> of {eligibleRecords.length.toLocaleString()} eligible books selected{duplicateRecords.length > 0 && ` · ${duplicateRecords.length.toLocaleString()} repeated rows skipped`}.</p></div><div className="flex flex-wrap gap-2 rounded-2xl border border-[#3d2448] bg-[#1c0f24] p-3"><button type="button" onClick={selectAllEligible} disabled={allEligibleSelected || maximumSelection === 0 || isImporting} className="quiet-shelf-secondary-action min-h-10 px-4 disabled:opacity-40">Select All</button><button type="button" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0 || isImporting} className="quiet-shelf-secondary-action min-h-10 px-4 disabled:opacity-40">Clear All</button><button type="button" onClick={() => selectByStatus('tbr')} disabled={isImporting} className="quiet-shelf-secondary-action min-h-10 px-4">Select TBR</button><button type="button" onClick={() => selectByStatus('currently-reading')} disabled={isImporting} className="quiet-shelf-secondary-action min-h-10 px-4">Select Reading</button><button type="button" onClick={() => selectByStatus('finished')} disabled={isImporting} className="quiet-shelf-secondary-action min-h-10 px-4">Select Read</button></div><div className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${isLargeSelectedImport ? 'border-[#c5a059]/40 bg-[#c5a059]/10 text-stone-200' : 'border-emerald-500/30 bg-emerald-950/15 text-stone-300'}`}><AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${isLargeSelectedImport ? 'text-[#e5c158]' : 'text-emerald-300'}`} /><div><p className={`font-bold ${isLargeSelectedImport ? 'text-[#f0cf7a]' : 'text-emerald-200'}`}>{isLargeSelectedImport ? 'Large library import' : 'Safe import'}</p><p className="mt-1 text-xs leading-5 text-stone-400">New books are added from the export. Existing matches are additive only: blank values can be filled and list-style fields are merged without replacing the reading life you already built in Inkbound.</p></div></div>{importError && <div role="alert" className="rounded-xl border border-rose-500/35 bg-rose-950/25 p-4 text-sm text-rose-200">{importError}</div>}{isImporting && <div className="rounded-xl border border-[#c5a059]/35 bg-[#c5a059]/10 p-4 text-sm text-[#f4efe6]" role="status"><div className="flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin text-[#e5c158]" /><div className="min-w-0 flex-1"><p className="font-bold">Processing your export…</p><p className="mt-1 text-xs text-stone-400">Existing reader data is protected while missing information is merged.</p></div><span className="text-xs font-bold text-[#e5c158]">{verificationProgress.completed.toLocaleString()} / {verificationProgress.total.toLocaleString()}</span></div></div>}{eligibleRecords.length > 0 && <div className="space-y-2">{eligibleRecords.map((record) => { const selected = selectedIds.includes(record.id); const merging = record.duplicateAction === 'merge'; return <button key={record.id} type="button" onClick={() => toggleSelection(record.id)} disabled={isImporting} aria-pressed={selected} className={`flex min-h-14 w-full items-center gap-3 rounded-xl border p-3 text-left transition disabled:cursor-wait ${selected ? 'border-[#c5a059] bg-[#c5a059]/10' : 'border-[#3d2448] bg-[#1c0f24]'}`}><span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${selected ? 'border-[#c5a059] bg-[#c5a059] text-[#120817]' : 'border-stone-600 bg-[#120817]'}`}>{selected && <Check className="h-3.5 w-3.5" />}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-[#f4efe6]">{record.title}</strong><small className="block truncate text-stone-400">{record.author}</small></span>{merging && <span className="rounded-full border border-sky-500/25 bg-sky-950/25 px-2 py-1 text-[10px] font-bold uppercase text-sky-200">Safe update</span>}<span className="text-[10px] font-bold uppercase text-[#e5c158]">{record.format}</span></button>; })}</div>}<div className="sticky bottom-0 flex flex-col-reverse gap-3 border-t border-[#3d2448] bg-[#0d0910]/95 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={goBack} disabled={isImporting} className="quiet-shelf-secondary-action min-h-11 disabled:opacity-50">Back</button><button type="button" onClick={executeImport} disabled={(selectedRecords.length === 0 && duplicateRecords.length === 0) || isImporting} className="quiet-shelf-primary-action min-h-11 disabled:cursor-not-allowed disabled:opacity-50">{isImporting ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</> : selectedRecords.length ? `Process ${selectedRecords.length.toLocaleString()} Books` : `Record ${duplicateRecords.length.toLocaleString()} Skipped Books`}</button></div></section>}

        {currentStep === 5 && <section className="space-y-5"><div className="rounded-3xl border border-emerald-500/30 bg-emerald-950/20 p-6 text-center sm:p-10"><CheckCircle2 className="mx-auto h-16 w-16 text-emerald-400" /><h2 className="mt-4 font-serif text-3xl font-bold text-[#f4efe6]">Import complete</h2><p className="mx-auto mt-2 max-w-lg text-sm text-stone-400">{importedCount.toLocaleString()} new {importedCount === 1 ? 'book was' : 'books were'} added and {matchedCount.toLocaleString()} existing {matchedCount === 1 ? 'book was' : 'books were'} safely updated from your export.</p><div className="mx-auto mt-5 flex max-w-3xl flex-wrap justify-center gap-2 text-xs"><span className="rounded-full border border-emerald-500/25 bg-emerald-950/30 px-3 py-1.5 text-emerald-200">{importedCount.toLocaleString()} new</span><span className="rounded-full border border-sky-500/25 bg-sky-950/25 px-3 py-1.5 text-sky-200">{matchedCount.toLocaleString()} existing updated</span><span className="rounded-full border border-[#c5a059]/25 bg-[#c5a059]/10 px-3 py-1.5 text-[#e5c158]">{metadataPendingCount.toLocaleString()} awaiting optional details</span><span className="rounded-full border border-amber-500/25 bg-amber-950/30 px-3 py-1.5 text-amber-200">{duplicateRecords.length.toLocaleString()} repeats skipped</span></div>{importedCount > 0 && !hasUndone ? <button type="button" onClick={undoImport} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-500/30 px-4 text-xs font-bold text-rose-300"><RotateCcw className="h-4 w-4" /> Undo New Books</button> : hasUndone ? <p className="mt-5 text-xs font-bold text-rose-300">The newly added books were undone. Safe updates to pre-existing books are intentionally not rolled back.</p> : null}</div>{isLargeCompletedImport && <section className="rounded-3xl border border-[#c5a059]/45 bg-[#c5a059]/10 p-5 sm:p-6" role="status"><div className="flex items-start gap-3"><Sparkles className="mt-0.5 h-6 w-6 shrink-0 text-[#e5c158]" /><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#c5a059]">Large library</p><h3 className="mt-1 font-serif text-2xl text-[#f4efe6]">Your books are ready — details will keep filling in</h3><p className="mt-2 max-w-4xl text-sm leading-6 text-stone-300">New books are already safely in Inkbound. Covers, summaries, and other optional details may continue filling in afterward.</p></div></div></section>}{duplicateRecords.length > 0 && <section className="rounded-3xl border border-amber-500/25 bg-amber-950/10 p-5 sm:p-6"><div className="flex items-start gap-3"><CopyCheck className="mt-0.5 h-6 w-6 shrink-0 text-amber-300" /><div><h3 className="font-serif text-2xl text-[#f4efe6]">{duplicateRecords.length.toLocaleString()} repeated rows skipped</h3><p className="mt-1 text-sm leading-6 text-stone-400">These appeared more than once in the uploaded file and did not create extra copies.</p></div></div></section>}{metadataPendingCount > 0 && <section className="rounded-3xl border border-[#c5a059]/30 bg-[#c5a059]/10 p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><SearchCheck className="mt-0.5 h-6 w-6 shrink-0 text-[#e5c158]" /><div><h3 className="font-serif text-2xl text-[#f4efe6]">{metadataPendingCount.toLocaleString()} {metadataPendingCount === 1 ? 'new book is' : 'new books are'} waiting for optional details</h3><p className="mt-1 max-w-3xl text-sm leading-6 text-stone-400">These books are already safely in your library using the information from your export. Inkbound can keep looking for covers, summaries, and edition details afterward.</p></div></div><button type="button" onClick={downloadMetadataPending} className="quiet-shelf-secondary-action min-h-10 shrink-0 px-4"><Download className="h-4 w-4" /> Download List</button></div></section>}</section>}
      </>}
    </div>
  );
};
