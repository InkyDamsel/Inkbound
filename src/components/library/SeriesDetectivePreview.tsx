import React, { useEffect, useState } from 'react';
import type { UserBookRecord } from '../../types';
import { findMissingSeriesBooks, type SeriesDetectiveResult } from '../../features/series/seriesDetective';

interface Props {
  seriesName: string;
  author: string;
  books: UserBookRecord[];
  seriesBookIds: string[];
}

/** Read-only integration preview: never mutates the user's library. */
export const SeriesDetectivePreview: React.FC<Props> = ({ seriesName, author, books, seriesBookIds }) => {
  const [result, setResult] = useState<SeriesDetectiveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [run, setRun] = useState(0);

  useEffect(() => {
    setResult(null);
    setError('');
  }, [seriesName, author, seriesBookIds.join('|')]);

  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setResult(null);
    void findMissingSeriesBooks(seriesName, author === 'Various authors' ? '' : author, books, controller.signal, seriesBookIds)
      .then((next) => { if (!controller.signal.aborted) setResult(next); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Series lookup failed.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Run only on explicit user request; a series selection must not trigger network lookups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  return (
    <section className="mb-4 rounded-2xl border border-[var(--ink-gold)]/30 bg-[var(--ink-surface-soft)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-[var(--ink-ivory)]">Series Detective</h4>
          <p className="text-xs text-[var(--ink-muted)]">Read-only preview. Nothing will be added, deleted, or changed.</p>
        </div>
        <button type="button" disabled={loading} onClick={() => setRun((value) => value + 1)} className="quiet-shelf-secondary-action">
          {loading ? 'Investigating…' : 'Find missing books'}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {result && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-[var(--ink-muted)]">{result.candidates.length} verified catalog candidate(s); {result.missing.length} not found in your library.</p>
          {result.missing.length === 0 && <p className="text-sm text-[var(--ink-muted)]">No missing books verified by available catalog evidence.</p>}
          {result.missing.map((candidate, index) => (
            <div key={`${candidate.work.key ?? candidate.work.title}-${index}`} className="rounded-xl border border-[var(--ink-border-subtle)] p-3">
              <div className="text-sm font-medium text-[var(--ink-ivory)]">{candidate.work.title}</div>
              <div className="text-xs text-[var(--ink-muted)]">{candidate.work.authors.join(', ') || 'Author unverified'} · {candidate.position === null ? 'Order unverified' : `Book ${candidate.position}`}</div>
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('inkbound:series-detective-add', { detail: { title: candidate.work.title, author: candidate.work.authors[0] ?? '' } }))} className="mt-2 rounded-lg border border-[#c5a059]/50 px-3 py-2 text-xs font-semibold text-[#e5c158] hover:bg-[#c5a059]/10">Find edition &amp; add</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
