import React, { useEffect, useState } from 'react';
import type { UserBookRecord } from '../../types';
import { detectSeriesForBook, findMissingSeriesBooks, type SeriesDetectiveMatch, type SeriesDetectiveResult } from '../../features/series/seriesDetective';

interface Props { book: UserBookRecord; libraryBooks?: UserBookRecord[]; }

/** User-triggered, read-only discovery; never updates library metadata automatically. */
export const SeriesDetectiveBookLookup: React.FC<Props> = ({ book, libraryBooks }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [match, setMatch] = useState<SeriesDetectiveMatch | null>(null);
  const [result, setResult] = useState<SeriesDetectiveResult | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    setOpen(false); setMatch(null); setResult(null); setAttempted(false); setError(''); setRun(0);
  }, [book.id]);

  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setMatch(null); setResult(null); setAttempted(true);
    void (async () => {
      const found = await detectSeriesForBook(book, controller.signal);
      if (controller.signal.aborted) return;
      setMatch(found);
      if (found && libraryBooks) {
        const missing = await findMissingSeriesBooks(found.name, found.discoveryAuthor ?? book.work.author, libraryBooks, controller.signal);
        if (!controller.signal.aborted) setResult(missing);
      }
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Series discovery failed.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [run, book, libraryBooks]);

  return <div className="mt-3">
    <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#c5a059]/40 px-3 text-xs font-semibold text-[#e5c158] transition-colors hover:bg-[#c5a059]/10" aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open && !attempted) setRun((value) => value + 1); }}>
      <span aria-hidden="true">⌕</span> Series Detective <span className="font-normal text-stone-400">{open ? 'Hide results' : 'Discover series'}</span>
    </button>
    {open && <div className="mt-3 rounded-xl border border-[#c5a059]/20 bg-[#120817]/60 p-4 text-sm text-[#f4efe6]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-stone-400">Catalog discovery · Preview only · Your library stays unchanged</p>
        <button type="button" disabled={loading} onClick={() => setRun((value) => value + 1)} className="text-xs font-semibold text-[#e5c158] underline underline-offset-4 disabled:opacity-50">{loading ? 'Investigating…' : 'Retry discovery'}</button>
      </div>
      {loading && <p role="status" className="mt-3">Checking available catalog evidence…</p>}
      {error && <p role="alert" className="mt-3 text-rose-300">Discovery request failed: {error}</p>}
      {attempted && !loading && !error && !match && <div className="mt-3 space-y-1"><p className="font-semibold">No verified series match returned</p><p className="text-xs text-stone-400">This does not mean the book is standalone. The catalog data may be missing, unavailable, or insufficient to verify a match. No book metadata was changed.</p></div>}
      {match && <div className="mt-3"><p>Detected series: <strong className="text-[#e5c158]">{match.name}</strong> · {match.position === null ? 'Order unverified' : `Book ${match.position}`}</p></div>}
      {result && <div className="mt-3 space-y-2"><p>{result.missing.length} verified candidate(s) not in your library.</p>
        {result.missing.map((candidate, index) => <p key={`${candidate.work.key ?? candidate.work.title}-${index}`}>{candidate.work.title} — {candidate.work.authors.join(', ')} ({candidate.position === null ? 'order unverified' : `book ${candidate.position}`})</p>)}
      </div>}
    </div>}
  </div>;
};
