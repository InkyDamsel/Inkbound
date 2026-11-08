import React, { useEffect, useState } from 'react';
import type { UserBookRecord } from '../../types';
import { resolveSeriesMetadata } from '../../features/series/seriesLibrary';
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
  const savedSeries = resolveSeriesMetadata(book);

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
      const seriesToInvestigate = found ?? savedSeries;
      if (seriesToInvestigate && libraryBooks) {
        const missing = await findMissingSeriesBooks(seriesToInvestigate.name, ('discoveryAuthor' in seriesToInvestigate && seriesToInvestigate.discoveryAuthor) || book.work.author, libraryBooks, controller.signal);
        if (!controller.signal.aborted) setResult(missing);
      }
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Series discovery failed.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [run, book, libraryBooks, savedSeries?.name, savedSeries?.position]);

  return <div className="mt-1 mb-3">
    <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#c5a059]/40 px-3 text-xs font-semibold text-[#e5c158] transition-colors hover:bg-[#c5a059]/10" aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open && !attempted) setRun((value) => value + 1); }}>
      <span aria-hidden="true">⌕</span> Series Detective <span className="font-normal text-stone-400">{open ? 'Hide results' : 'Discover series'}</span>
    </button>
    {open && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label="Series Detective discovery" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#c5a059]/40 bg-[#211128] p-6 text-sm text-[#f4efe6] shadow-2xl">
      <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="font-serif text-2xl text-[#f3dbad]">Series Detective</h2><p className="mt-1 text-sm text-stone-300">{book.work.title} · {book.work.author}</p></div><button type="button" aria-label="Close Series Detective" onClick={() => setOpen(false)} className="rounded-lg border border-white/20 px-3 py-2 text-sm text-stone-200 hover:bg-white/10">Close</button></div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-stone-400">Catalog discovery · Preview only · Your library stays unchanged</p>
        <button type="button" disabled={loading} onClick={() => setRun((value) => value + 1)} className="text-xs font-semibold text-[#e5c158] underline underline-offset-4 disabled:opacity-50">{loading ? 'Investigating…' : 'Retry discovery'}</button>
      </div>
      {loading && <p role="status" className="mt-3">Checking available catalog evidence…</p>}
      {error && <p role="alert" className="mt-3 text-rose-300">Discovery request failed: {error}</p>}
      {savedSeries && <p className="mt-3 text-sm">Saved series: <strong className="text-[#e5c158]">{savedSeries.name}</strong> · {savedSeries.position === null ? 'Order not recorded' : `Book ${savedSeries.position}`} <span className="text-xs text-stone-400">(from your library)</span></p>}
      {attempted && !loading && !error && !match && !savedSeries && <div className="mt-3 space-y-1"><p className="font-semibold">No verified series match returned</p><p className="text-xs text-stone-400">This does not mean the book is standalone. The catalog data may be missing, unavailable, or insufficient to verify a match. No book metadata was changed.</p></div>}
      {attempted && !loading && !error && !match && savedSeries && <p className="mt-2 text-xs text-stone-400">External catalogs did not independently verify the series. Your saved series information remains available.</p>}
      {match && <div className="mt-3"><p>Catalog match: <strong className="text-[#e5c158]">{match.name}</strong> · {match.position === null ? 'Order unverified' : `Book ${match.position}`}</p></div>}
      {result && <div className="mt-3 space-y-2"><p>{result.missing.length} verified candidate(s) not in your library.</p>
        {result.missing.map((candidate, index) => <p key={`${candidate.work.key ?? candidate.work.title}-${index}`}>{candidate.work.title} — {candidate.work.authors.join(', ')} ({candidate.position === null ? 'order unverified' : `book ${candidate.position}`})</p>)}
      </div>}
    </div>}
  </div>;
};
