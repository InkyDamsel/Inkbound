import React, { useState } from 'react';
import { ImportSourceInfo, ImportRecordItem, UserBookRecord } from '../types';
import { MOCK_IMPORT_RECORDS } from '../data/sampleBooks';
import { useUserPlan } from '../context/UserPlanContext';
import {
  DownloadCloud,
  CheckCircle2,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  FileText,
  Upload,
  Check,
  X,
  Lock,
  CheckSquare,
  Square
} from 'lucide-react';

interface ImportCenterScreenProps {
  currentBookCount: number;
  onExecuteImport: (importedItems: ImportRecordItem[]) => void;
  onUndoLastImport?: () => void;
}

export const IMPORT_SOURCES: ImportSourceInfo[] = [
  { id: 'goodreads', name: 'Goodreads', description: 'Import an exported goodreads_library_export.csv file directly', badge: 'CSV Export', method: 'CSV/JSON File', supported: true },
  { id: 'storygraph', name: 'StoryGraph', description: 'Import an exported storygraph_library.csv file with tags & moods', badge: 'CSV Export', method: 'CSV/JSON File', supported: true },
  { id: 'fable', name: 'Fable', description: 'Import your fable_bookshelf.json exported data file', badge: 'JSON Export', method: 'CSV/JSON File', supported: true },
  { id: 'hardcover', name: 'Hardcover', description: 'Import an exported hardcover_books.csv data export', badge: 'CSV Export', method: 'CSV/JSON File', supported: true },
  { id: 'literal', name: 'Literal', description: 'Import your literal_club_export.json data file', badge: 'JSON Export', method: 'CSV/JSON File', supported: true },
  { id: 'librarything', name: 'LibraryThing', description: 'Import standard LibraryThing CSV export files', badge: 'CSV Export', method: 'CSV/JSON File', supported: true },
  { id: 'bookly', name: 'Bookly', description: 'Import Bookly reading session logs & exported timelines', badge: 'CSV/JSON Export', method: 'CSV/JSON File', supported: true },
  { id: 'generic_csv', name: 'Custom CSV / JSON', description: 'Map any spreadsheet or JSON file manually', badge: 'Any File', method: 'CSV/JSON File', supported: true },
];

export const ImportCenterScreen: React.FC<ImportCenterScreenProps> = ({
  currentBookCount,
  onExecuteImport,
  onUndoLastImport,
}) => {
  const { userPlan, freeBookLimit, openUpgradeModal } = useUserPlan();
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedSource, setSelectedSource] = useState<ImportSourceInfo>(IMPORT_SOURCES[0]);
  const [importRecords, setImportRecords] = useState<ImportRecordItem[]>(MOCK_IMPORT_RECORDS);
  const [isDone, setIsDone] = useState(false);
  const [hasUndone, setHasUndone] = useState(false);

  // Free user item selection state (up to remaining slots)
  const remainingFreeSlots = Math.max(0, freeBookLimit - currentBookCount);
  const [selectedForFreeImport, setSelectedForFreeImport] = useState<string[]>(() =>
    MOCK_IMPORT_RECORDS.slice(0, remainingFreeSlots).map((r) => r.id)
  );

  // Field Mapping state
  const [fieldMapping, setFieldMapping] = useState({
    titleCol: 'Book Title',
    authorCol: 'Author Name',
    isbnCol: 'ISBN13',
    ratingCol: 'My Rating',
    statusCol: 'Exclusive Shelf',
  });

  const handleNextStep = () => {
    if (currentStep < 5) setCurrentStep(currentStep + 1);
  };

  const handlePrevStep = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handleCompleteImport = () => {
    const itemsToImport =
      userPlan === 'premium'
        ? importRecords
        : importRecords.filter((r) => selectedForFreeImport.includes(r.id));
    onExecuteImport(itemsToImport);
    setIsDone(true);
    setCurrentStep(6);
  };

  const toggleFreeImportSelection = (id: string) => {
    if (selectedForFreeImport.includes(id)) {
      setSelectedForFreeImport(selectedForFreeImport.filter((item) => item !== id));
    } else {
      if (selectedForFreeImport.length >= remainingFreeSlots) {
        openUpgradeModal(`Free accounts can only import up to ${remainingFreeSlots} available slot(s). Upgrade to Premium to import all books.`);
        return;
      }
      setSelectedForFreeImport([...selectedForFreeImport, id]);
    }
  };


  const handleUndo = () => {
    if (onUndoLastImport) onUndoLastImport();
    setHasUndone(true);
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#c5a059] bg-[#c5a059]/10 px-2.5 py-1 rounded">
            Data Migration Suite
          </span>
          <h1 className="text-3xl font-serif font-bold text-[#2e102d] dark:text-[#f3ede2] mt-1">
            Import Center
          </h1>
          <p className="text-sm text-[#849383]">
            Import your exported library files (.csv, .json) from Goodreads, StoryGraph, Fable, Bookly, and more.
          </p>
        </div>
      </div>

      {/* Philosophy Banner */}
      <div className="p-4 bg-[#ebd9c5]/30 dark:bg-[#201723] border border-[#d8cbb8] dark:border-[#342436] rounded-2xl flex items-start gap-3 text-xs">
        <Sparkles className="w-5 h-5 text-[#c5a059] shrink-0 mt-0.5" />
        <div className="space-y-0.5 text-[#2e102d] dark:text-stone-300">
          <p className="font-bold">Own Your Personal Library Data</p>
          <p className="text-stone-500">
            Export your data anytime from Goodreads, StoryGraph, Fable, Hardcover, or Bookly, then import your complete history into The Quiet Shelf. Direct live account connectors are planned for future releases.
          </p>
        </div>
      </div>

      {/* Stepper Progress Bar */}
      <div className="bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl p-4 shadow-xs overflow-x-auto">
        <div className="flex items-center justify-between min-w-[650px] text-xs font-semibold">
          {[
            { step: 1, name: 'Select Source' },
            { step: 2, name: 'Upload File' },
            { step: 3, name: 'File Analysis' },
            { step: 4, name: 'Map Fields' },
            { step: 5, name: 'Select Books' },
            { step: 6, name: 'Complete' },
          ].map((s) => (
            <div
              key={s.step}
              className={`flex items-center gap-2 ${
                currentStep === s.step
                  ? 'text-[#361539] dark:text-[#c5a059] font-bold'
                  : currentStep > s.step
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-stone-400'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${
                  currentStep === s.step
                    ? 'bg-[#361539] text-[#f8f4ed] dark:bg-[#c5a059] dark:text-[#1c121e]'
                    : currentStep > s.step
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                    : 'bg-stone-200 dark:bg-stone-800 text-stone-500'
                }`}
              >
                {currentStep > s.step ? '✓' : s.step}
              </span>
              <span>{s.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* STEP 1: SELECT SOURCE */}
      {currentStep === 1 && (
        <div className="space-y-4">
          <h2 className="text-xl font-serif font-bold text-[#2e102d] dark:text-[#f3ede2]">
            Step 1: Choose Import Source
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {IMPORT_SOURCES.map((src) => (
              <div
                key={src.id}
                onClick={() => setSelectedSource(src)}
                className={`p-5 rounded-2xl border transition cursor-pointer flex flex-col justify-between space-y-3 ${
                  selectedSource.id === src.id
                    ? 'bg-[#c5a059]/15 border-[#c5a059] shadow-md'
                    : 'bg-[#f8f4ed] dark:bg-[#201723] border-[#e8dfd1] dark:border-[#342436] hover:bg-[#ebd9c5]/30'
                }`}
              >
                <div className="flex items-start justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#c5a059] bg-[#c5a059]/10 px-2 py-0.5 rounded">
                    {src.badge}
                  </span>
                  {selectedSource.id === src.id && <CheckCircle2 className="w-5 h-5 text-[#c5a059]" />}
                </div>

                <div>
                  <h3 className="font-serif font-bold text-lg text-[#2e102d] dark:text-[#f3ede2]">
                    {src.name}
                  </h3>
                  <p className="text-xs text-[#849383] mt-1">{src.description}</p>
                </div>

                <p className="text-[10px] text-stone-400 font-semibold pt-2 border-t border-[#e8dfd1] dark:border-[#2e1e30]">
                  Method: {src.method}
                </p>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-4">
            <button
              onClick={handleNextStep}
              className="px-6 py-2.5 rounded-xl bg-[#361539] text-[#f8f4ed] dark:bg-[#c5a059] dark:text-[#1c121e] text-xs font-bold shadow hover:opacity-90 flex items-center gap-2"
            >
              <span>Continue with {selectedSource.name}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: UPLOAD FILE */}
      {currentStep === 2 && (
        <div className="space-y-4">
          <h2 className="text-xl font-serif font-bold text-[#2e102d] dark:text-[#f3ede2]">
            Step 2: Upload or Paste {selectedSource.name} File
          </h2>

          <div className="bg-[#f8f4ed] dark:bg-[#201723] border border-dashed border-[#c5a059] rounded-2xl p-10 text-center space-y-4">
            <Upload className="w-12 h-12 text-[#c5a059] mx-auto" />
            <div>
              <p className="font-serif font-bold text-lg text-[#2e102d] dark:text-stone-200">
                Drag and drop your export CSV or JSON file here
              </p>
              <p className="text-xs text-stone-500 mt-1">
                Supported formats: .csv, .json, .xlsx
              </p>
            </div>
            <button
              onClick={handleNextStep}
              className="px-5 py-2.5 rounded-xl bg-[#c5a059] text-[#1c121e] text-xs font-bold shadow hover:bg-[#b58e45] inline-flex items-center gap-2"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Use Pre-Loaded Sample Export Data ({importRecords.length} records)</span>
            </button>
          </div>

          <div className="flex justify-between pt-4">
            <button
              onClick={handlePrevStep}
              className="px-4 py-2 rounded-xl border border-stone-300 dark:border-stone-700 text-xs font-bold"
            >
              Back
            </button>
            <button
              onClick={handleNextStep}
              className="px-6 py-2.5 rounded-xl bg-[#361539] text-[#f8f4ed] dark:bg-[#c5a059] dark:text-[#1c121e] text-xs font-bold shadow hover:opacity-90 flex items-center gap-2"
            >
              <span>Next: Map Fields</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: FILE ANALYSIS & CAPACITY CHECK */}
      {currentStep === 3 && (
        <div className="space-y-4">
          <h2 className="text-xl font-serif font-bold text-[#2e102d] dark:text-[#f3ede2]">
            Step 3: Export File Analysis & Capacity Calculation
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl text-center space-y-1">
              <p className="text-xs text-stone-500 font-bold uppercase tracking-wider">Books in File</p>
              <p className="text-3xl font-serif font-bold text-[#361539] dark:text-[#c5a059]">{importRecords.length}</p>
              <p className="text-[11px] text-stone-400">Total records detected</p>
            </div>

            <div className="p-4 bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl text-center space-y-1">
              <p className="text-xs text-stone-500 font-bold uppercase tracking-wider">Account Plan Status</p>
              <p className="text-3xl font-serif font-bold text-[#2e102d] dark:text-[#f3ede2]">
                {currentBookCount} / {freeBookLimit}
              </p>
              <p className="text-[11px] text-[#c5a059] font-semibold">
                {userPlan === 'premium' ? 'Unlimited Premium Plan' : `${remainingFreeSlots} free slots remaining`}
              </p>
            </div>

            <div className="p-4 bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl text-center space-y-1">
              <p className="text-xs text-stone-500 font-bold uppercase tracking-wider">Eligible for Import</p>
              <p className="text-3xl font-serif font-bold text-emerald-600">
                {userPlan === 'premium' ? importRecords.length : Math.min(remainingFreeSlots, importRecords.length)}
              </p>
              <p className="text-[11px] text-stone-400">
                {userPlan === 'premium' ? 'All records eligible' : `Fits within ${freeBookLimit}-book limit`}
              </p>
            </div>
          </div>

          <div className="bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl p-6 space-y-3">
            <h3 className="font-serif font-bold text-sm text-[#2e102d] dark:text-stone-200">
              File Format & Metadata Health
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-[#f3ede2] dark:bg-[#181119] rounded-xl">
                <span className="text-stone-400 block font-semibold">Source Detected</span>
                <span className="font-bold text-[#361539] dark:text-[#c5a059]">{selectedSource.name}</span>
              </div>
              <div className="p-3 bg-[#f3ede2] dark:bg-[#181119] rounded-xl">
                <span className="text-stone-400 block font-semibold">Valid ISBNs</span>
                <span className="font-bold text-emerald-600">4 / 4 (100%)</span>
              </div>
              <div className="p-3 bg-[#f3ede2] dark:bg-[#181119] rounded-xl">
                <span className="text-stone-400 block font-semibold">User Ratings Included</span>
                <span className="font-bold text-[#2e102d] dark:text-stone-200">Yes (1-5 Stars)</span>
              </div>
              <div className="p-3 bg-[#f3ede2] dark:bg-[#181119] rounded-xl">
                <span className="text-stone-400 block font-semibold">Reading Statuses</span>
                <span className="font-bold text-[#2e102d] dark:text-stone-200">Mapped</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button onClick={handlePrevStep} className="px-4 py-2 rounded-xl border text-xs font-bold">
              Back
            </button>
            <button
              onClick={handleNextStep}
              className="px-6 py-2.5 rounded-xl bg-[#361539] text-[#f8f4ed] dark:bg-[#c5a059] dark:text-[#1c121e] text-xs font-bold shadow hover:opacity-90 flex items-center gap-2"
            >
              <span>Next: Map Fields</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: FIELD MAPPING */}
      {currentStep === 4 && (
        <div className="space-y-4">
          <h2 className="text-xl font-serif font-bold text-[#2e102d] dark:text-[#f3ede2]">
            Step 4: Map Export Fields to The Quiet Shelf
          </h2>

          <div className="bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="font-bold text-[#2e102d] dark:text-stone-300 block mb-1">
                  The Quiet Shelf Title Field ← CSV Column
                </label>
                <input
                  type="text"
                  value={fieldMapping.titleCol}
                  onChange={(e) => setFieldMapping({ ...fieldMapping, titleCol: e.target.value })}
                  className="w-full p-2.5 rounded-lg bg-[#f3ede2] dark:bg-[#181119] border border-[#d8cbb8] dark:border-[#38263b]"
                />
              </div>

              <div>
                <label className="font-bold text-[#2e102d] dark:text-stone-300 block mb-1">
                  The Quiet Shelf Author Field ← CSV Column
                </label>
                <input
                  type="text"
                  value={fieldMapping.authorCol}
                  onChange={(e) => setFieldMapping({ ...fieldMapping, authorCol: e.target.value })}
                  className="w-full p-2.5 rounded-lg bg-[#f3ede2] dark:bg-[#181119] border border-[#d8cbb8] dark:border-[#38263b]"
                />
              </div>

              <div>
                <label className="font-bold text-[#2e102d] dark:text-stone-300 block mb-1">
                  ISBN Field ← CSV Column
                </label>
                <input
                  type="text"
                  value={fieldMapping.isbnCol}
                  onChange={(e) => setFieldMapping({ ...fieldMapping, isbnCol: e.target.value })}
                  className="w-full p-2.5 rounded-lg bg-[#f3ede2] dark:bg-[#181119] border border-[#d8cbb8] dark:border-[#38263b]"
                />
              </div>

              <div>
                <label className="font-bold text-[#2e102d] dark:text-stone-300 block mb-1">
                  Rating Field ← CSV Column
                </label>
                <input
                  type="text"
                  value={fieldMapping.ratingCol}
                  onChange={(e) => setFieldMapping({ ...fieldMapping, ratingCol: e.target.value })}
                  className="w-full p-2.5 rounded-lg bg-[#f3ede2] dark:bg-[#181119] border border-[#d8cbb8] dark:border-[#38263b]"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button onClick={handlePrevStep} className="px-4 py-2 rounded-xl border text-xs font-bold">
              Back
            </button>
            <button
              onClick={handleNextStep}
              className="px-6 py-2.5 rounded-xl bg-[#361539] text-[#f8f4ed] dark:bg-[#c5a059] dark:text-[#1c121e] text-xs font-bold shadow hover:opacity-90 flex items-center gap-2"
            >
              <span>Next: Select Books & Resolve Duplicates</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: HANDLE DUPLICATES & FREE LIMIT CHECK */}
      {currentStep === 5 && (
        <div className="space-y-4">
          <h2 className="text-xl font-serif font-bold text-[#2e102d] dark:text-[#f3ede2]">
            Step 5: Set Duplicate Resolution & Account Slot Check
          </h2>

          {/* Account Limit Callout Banner */}
          {userPlan === 'free' ? (
            <div className="p-4 bg-amber-500/15 border-2 border-amber-500/40 rounded-2xl space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-sm">
                  <AlertTriangle className="w-5 h-5" />
                  <span>Free Library Import Limit Calculation</span>
                </div>
                <button
                  onClick={() => openUpgradeModal(`Upgrade to Premium to import all ${importRecords.length} books.`)}
                  className="px-3 py-1 bg-[#c5a059] text-[#1c121e] rounded-lg text-xs font-bold hover:bg-[#b08b46] transition flex items-center gap-1 shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Upgrade to Import All
                </button>
              </div>

              <div className="text-xs text-stone-700 dark:text-stone-300 space-y-1">
                <p className="font-semibold">
                  Your Free library has <span className="font-bold text-[#2e102d] dark:text-white">{currentBookCount} of {freeBookLimit} books</span> ({remainingFreeSlots} available slot{remainingFreeSlots !== 1 ? 's' : ''}). This file contains <span className="font-bold text-[#2e102d] dark:text-white">{importRecords.length} new books</span>.
                </p>
                <p className="italic text-stone-500">
                  You may choose <span className="font-bold text-amber-600 dark:text-amber-400">{Math.min(remainingFreeSlots, importRecords.length)} book(s)</span> to fill your remaining free slots, or upgrade to Bookhaven Premium to import all {importRecords.length} books.
                </p>
              </div>

              {/* Free Book Selector */}
              {remainingFreeSlots > 0 && (
                <div className="space-y-2 pt-2 border-t border-amber-500/30">
                  <p className="text-xs font-bold text-[#2e102d] dark:text-stone-200">
                    Select which {Math.min(remainingFreeSlots, importRecords.length)} book(s) to import ({selectedForFreeImport.length}/{remainingFreeSlots} chosen):
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {importRecords.map((item) => {
                      const isSelected = selectedForFreeImport.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          onClick={() => toggleFreeImportSelection(item.id)}
                          className={`p-2.5 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition ${
                            isSelected
                              ? 'bg-[#c5a059]/20 border-[#c5a059] font-bold text-[#2e102d] dark:text-[#f3ede2]'
                              : 'bg-[#f3ede2] dark:bg-[#181119] border-[#d8cbb8] dark:border-[#38263b] text-stone-500 opacity-70'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-[#c5a059]" />
                            ) : (
                              <Square className="w-4 h-4 text-stone-400" />
                            )}
                            <span>{item.title} <span className="text-stone-400 text-[11px] font-normal">by {item.author}</span></span>
                          </div>
                          <span className="text-[10px] uppercase font-bold text-[#c5a059]">{item.format}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 bg-emerald-950/20 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <Sparkles className="w-4 h-4 text-[#c5a059]" />
              <span>Premium Account: Unlimited import enabled for all {importRecords.length} books.</span>
            </div>
          )}

          <div className="bg-[#f8f4ed] dark:bg-[#201723] border border-[#e8dfd1] dark:border-[#342436] rounded-2xl p-6 space-y-4 text-xs">
            <p className="text-stone-500 font-bold">
              Duplicate Resolution Strategy:
            </p>

            <div className="space-y-2">
              {[
                { id: 'merge', title: 'Merge Records', desc: 'Combine reading status, reviews, and preserve both editions' },
                { id: 'skip', title: 'Skip Duplicates', desc: 'Ignore imported records if the title/ISBN already exists' },
                { id: 'keep_both', title: 'Keep Both Editions', desc: 'Create a new separate format entry (e.g. Audiobook alongside Ebook)' },
                { id: 'replace', title: 'Replace Metadata', desc: 'Overwrite local ratings and notes with imported values' },
              ].map((opt) => (
                <label key={opt.id} className="flex items-start gap-3 p-3 bg-[#f3ede2] dark:bg-[#181119] rounded-xl cursor-pointer border hover:border-[#c5a059]">
                  <input type="radio" name="dup_opt" defaultChecked={opt.id === 'merge'} className="mt-0.5 text-[#c5a059]" />
                  <div>
                    <span className="font-bold text-[#2e102d] dark:text-stone-200 block">{opt.title}</span>
                    <span className="text-stone-500">{opt.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button onClick={handlePrevStep} className="px-4 py-2 rounded-xl border text-xs font-bold">
              Back
            </button>
            <button
              onClick={handleCompleteImport}
              className="px-6 py-2.5 rounded-xl bg-[#c5a059] text-[#1c121e] text-xs font-bold shadow hover:bg-[#b58e45] flex items-center gap-2"
            >
              <span>
                Execute Import ({userPlan === 'premium' ? importRecords.length : selectedForFreeImport.length} Books)
              </span>
              <Check className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 6: IMPORT SUMMARY & UNDO */}
      {currentStep === 6 && (
        <div className="space-y-6">
          <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-8 text-center space-y-4">
            <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto" />
            <h2 className="font-serif font-bold text-3xl text-[#2e102d] dark:text-[#f3ede2]">
              Import Successfully Executed!
            </h2>
            <p className="text-xs text-stone-500 max-w-md mx-auto">
              Your books have been integrated into your library with complete formatting, notes, and tags.
            </p>

            {/* Summary metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mx-auto pt-4 text-center">
              <div className="p-3 bg-[#f8f4ed] dark:bg-[#201723] rounded-xl border">
                <p className="text-2xl font-serif font-bold text-[#361539] dark:text-[#c5a059]">
                  {importRecords.length}
                </p>
                <p className="text-[10px] text-stone-400">Books Imported</p>
              </div>
              <div className="p-3 bg-[#f8f4ed] dark:bg-[#201723] rounded-xl border">
                <p className="text-2xl font-serif font-bold text-emerald-600">3</p>
                <p className="text-[10px] text-stone-400">Merged Copies</p>
              </div>
              <div className="p-3 bg-[#f8f4ed] dark:bg-[#201723] rounded-xl border">
                <p className="text-2xl font-serif font-bold text-amber-600">1</p>
                <p className="text-[10px] text-stone-400">New Edition</p>
              </div>
              <div className="p-3 bg-[#f8f4ed] dark:bg-[#201723] rounded-xl border">
                <p className="text-2xl font-serif font-bold text-stone-400">0</p>
                <p className="text-[10px] text-stone-400">Failed Records</p>
              </div>
            </div>

            {/* Undo import option */}
            {!hasUndone ? (
              <div className="pt-4">
                <button
                  onClick={handleUndo}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-rose-300 dark:border-rose-900 text-rose-700 dark:text-rose-400 hover:bg-rose-100 text-xs font-bold transition"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Undo This Import Batch</span>
                </button>
              </div>
            ) : (
              <p className="text-xs text-rose-600 font-bold pt-2">
                Import batch undone! Library restored to previous state.
              </p>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
