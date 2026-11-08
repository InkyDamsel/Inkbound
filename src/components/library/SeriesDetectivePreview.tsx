import React, { useEffect, useMemo, useState } from 'react';
import type { UserBookRecord } from '../../types';
import {
  classifySeriesCandidates,
  findMissingSeriesBooks,
  type SeriesDetectiveResult,
} from '../../features/series/seriesDetective';
import { resolveEffectiveSeriesMetadata } from '../../features/series/seriesLibrary';
import type { SeriesOverrides } from '../../features/series/seriesOverrides';
import { buildSeriesRoster } from '../../features/series/seriesDetectiveRoster';
import { SeriesDetectiveRoster } from './SeriesDetectiveRoster';

interface Props {
  seriesName: string;
  author: string;
  books: UserBookRecord[];
  seriesBookIds: string[];
  overrides?: SeriesOverrides;
  onSelectBook?: (book: UserBookRecord) => void;
}

/** Read-only integration preview: never mutates the user's library. */
export const SeriesDetectivePreview: React.FC<Props> = ({ seriesName, author, books, seriesBookIds, overrides, onSelectBook }) => {
  const [result, setResult] = useState<SeriesDetectiveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [run, setRun] = useState(0);

  useEffect(() => {
    setResult(null);
    setError('');
  }, [seriesName, author, seriesBookIds.join('|')]);

  // Read the latest library/overrides through refs so the lookup effect only
  // depends on the explicit run counter.
  const booksRef = React.useRef(books);
  booksRef.current = books;
  const overridesRef = React.useRef(overrides);
  overridesRef.current = overrides;

  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setResult(null);
    void findMissingSeriesBooks(
      seriesName,
      author === 'Various authors' ? '' : author,
      booksRef.current,
      controller.signal,
      seriesBookIds,
      // The first run may reuse a recent catalog lookup; an explicit re-run is a retry.
      { forceRefresh: run > 1, overrides: overridesRef.current },
    )
      .then((next) => { if (!controller.signal.aborted) setResult(next); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Series lookup failed.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Run only on explicit user request; a series selection must not trigger network lookups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  // Re-classify against the live library so a book added from this list leaves
  // "missing" immediately, with no new network call.
  const roster = useMemo(() => {
    if (!result) return null;
    const live = classifySeriesCandidates(result.seriesName, result.candidates, books);
    const scoped = new Set(seriesBookIds);
    const seriesBooks = books.filter((book) => scoped.has(book.id));
    return buildSeriesRoster(live, seriesBooks, (book) => resolveEffectiveSeriesMetadata(book, overrides ?? {}));
  }, [result, books, seriesBookIds, overrides]);

  return (
    <section className="mb-4 rounded-2xl border border-[var(--ink-gold)]/30 bg-[var(--ink-surface-soft)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-[var(--ink-ivory)]">Series Detective</h4>
          <p className="text-xs text-[var(--ink-muted)]">Read-only preview. Nothing will be added, deleted, or changed.</p>
        </div>
        <button type="button" disabled={loading} onClick={() => setRun((value) => value + 1)} className="quiet-shelf-secondary-action">
          {loading ? 'Investigating…' : result ? 'Search again' : 'Find missing books'}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {roster && (
        <SeriesDetectiveRoster
          entries={roster}
          onOpenBook={onSelectBook ? (entry) => { if (entry.book) onSelectBook(entry.book); } : undefined}
        />
      )}
    </section>
  );
};
