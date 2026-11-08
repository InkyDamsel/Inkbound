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

  return <section className="rounded-xl border border-[#c5a059]/35 bg-[#25132f] p-3">
    <button type="button" className="quiet-shelf-secondary-action" onClick={() => { setOpen((value) => !value); if (!open && !attempted) setRun((value) => value + 1); }}>
      Series Detective {open ? '−' : '— Find this book’s series'}
    </button>
    {open && <div className="mt-3 space-y-2 text-sm text-[#f4efe6]">
      <p className="text-xs text-stone-400">Read-only discovery. No changes to your library.</p>
      <button type="button" disabled={loading} onClick={() => setRun((value) => value + 1)} className="quiet-shelf-secondary-action">{loading ? 'Investigating…' : 'Investigate again'}</button>
      {error && <p role="alert" className="text-rose-300">{error}</p>}
      {attempted && !loading && !error && !match && <p>No series could be verified from the available catalog evidence.</p>}
      {match && <p>Detected series: <strong>{match.name}</strong> · {match.position === null ? 'Order unverified' : `Book ${match.position}`}</p>}
      {result && <div className="space-y-2"><p>{result.missing.length} possible missing book(s) verified by catalog evidence.</p>
        {result.missing.map((candidate, index) => <p key={`${candidate.work.key ?? candidate.work.title}-${index}`}>{candidate.work.title} — {candidate.work.authors.join(', ')} ({candidate.position === null ? 'order unverified' : `book ${candidate.position}`})</p>)}
      </div>}
    </div>}
  </section>;
};
