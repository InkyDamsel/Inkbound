import { isSeriesDetectiveAvailable } from '../../features/series/seriesDetectiveAvailability';
import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { useAccountSync } from '../../context/AccountSyncContext';
import { OWNER_EMAILS } from '../../features/admin/approvedOwners';
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
  const { user } = useAccountSync();
  const [adminAuthorized, setAdminAuthorized] = useState(false);
  const [adminChecking, setAdminChecking] = useState(false);
  const [adminDiagnosticsOpen, setAdminDiagnosticsOpen] = useState(false);
  const [result, setResult] = useState<SeriesDetectiveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [run, setRun] = useState(0);

  // The owner-only diagnostics require the existing server-authorized admin
  // callable; hiding a button is never the authorization boundary.
  useEffect(() => {
    setAdminAuthorized(false);
    setAdminDiagnosticsOpen(false);
  }, [user?.uid]);
  const requestAdminDiagnostics = async () => {
    if (!user || !functions || adminChecking) return;
    setAdminChecking(true);
    setAdminAuthorized(false);
    try {
      const getAdminDashboard = httpsCallable<{ query: string }, { role?: string }>(functions, 'getAdminDashboard');
      const response = await getAdminDashboard({ query: '' });
      if (response.data?.role === 'owner' || response.data?.role === 'admin') {
        setAdminAuthorized(true);
        setAdminDiagnosticsOpen(true);
        setRun(value => value + 1);
      }
    } catch {
      // Fail closed: no diagnostics when server authorization fails.
      setAdminAuthorized(false);
      setAdminDiagnosticsOpen(false);
    } finally {
      setAdminChecking(false);
    }
  };
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
      // Every explicit lookup refreshes discovery; no roster cache is active.
      { forceRefresh: run > 1, overrides: overridesRef.current, includeAdminDiagnostics: adminAuthorized },
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

  if (!isSeriesDetectiveAvailable()) return null;

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
      {result && user?.email && OWNER_EMAILS.has(user.email.toLowerCase()) && (
        <button type="button" disabled={adminChecking}
          onClick={() => { if (adminAuthorized) setAdminDiagnosticsOpen(value => !value); else void requestAdminDiagnostics(); }}
          className="mt-3 text-xs text-[var(--ink-muted)] underline">
          {adminChecking ? 'Checking access…' : 'Admin diagnostics'}
        </button>
      )}
      {adminAuthorized && adminDiagnosticsOpen && (
        <div aria-label="Admin-only Series Detective diagnostics">
          {result?.providerReports && (
        <div role="status" className="mt-3 rounded-xl border border-amber-400/30 p-3 text-xs text-amber-100">
          <p className="font-semibold">Catalog coverage is incomplete. Missing entries are not proof that a book does not exist.</p>
          <p className="mt-1">{result.providerReports.map((report) =>
            `${report.provider}: ${report.status}${report.errorCode ? ` (${report.errorCode})` : ''}`).join(' · ')}</p>
        </div>
      )}
          {result?.discoveryDiagnostics && (
        <details className="mt-3 rounded-xl border border-[var(--ink-border-subtle)] p-3 text-xs text-[var(--ink-muted)]">
          <summary className="cursor-pointer font-semibold">Discovery details</summary>
          <p className="mt-2">
            {result.discoveryDiagnostics.discovered} provider records · {result.discoveryDiagnostics.merged} merged candidates · {result.discoveryDiagnostics.admitted} admitted
          </p>
          <p className="mt-1">
            Excluded: {result.discoveryDiagnostics.rejectedSeries} series mismatch, {result.discoveryDiagnostics.rejectedAuthor} author mismatch, {result.discoveryDiagnostics.rejectedEvidence} insufficient evidence.
          </p>
          {result.candidates.length === 0 && (
            <p className="mt-2">No actionable roster was established. This does not prove that the series has no other books.</p>
          )}
        </details>
      )}
          {result?.candidates && (
            <details className="mt-3 rounded-xl border border-[var(--ink-border-subtle)] p-3 text-xs text-[var(--ink-muted)]">
              <summary className="cursor-pointer font-semibold">Per-book evidence inspector ({result.candidates.length})</summary>
              <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
                {result.candidates.map((candidate, index) => {
                  const evidence = candidate.evidenceInspection;
                  return (
                    <details key={candidate.work.key + ':' + index} className="rounded-lg border border-[var(--ink-border-subtle)] p-2">
                      <summary className="cursor-pointer font-medium text-[var(--ink-ivory)]">
                        {candidate.work.title} — {candidate.verification === 'verified' ? 'Verified' : 'Needs Review'}
                      </summary>
                      {evidence ? (
                        <div className="mt-2 space-y-1">
                          <p>Order: {evidence.position ?? 'Unconfirmed'} · Conflicting order: {evidence.conflictingOrder ? 'Yes' : 'No'}</p>
                          <p>Owned seed corroborated: {evidence.ownedSeedCorroborated ? 'Yes' : 'No'}</p>
                          <p>Providers: {evidence.candidateProviders.join(', ') || 'None'}</p>
                          {evidence.reasons.map((reason, reasonIndex) => <p key={reasonIndex}>• {reason}</p>)}
                          {evidence.providerClaims.map((claim, claimIndex) => (
                            <p key={claimIndex} className="break-words">
                              {claim.provider}: {claim.origin} · series ID {claim.nativeSeriesId ?? 'not supplied'} ·
                              position {claim.position ?? 'unknown'} · {claim.structured ? 'structured' : 'context only'}
                            </p>
                          ))}
                        </div>
                      ) : <p className="mt-2">No detailed provider evidence was retained for this result.</p>}
                    </details>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
      {roster && (
        <SeriesDetectiveRoster
          entries={roster}
          onOpenBook={onSelectBook ? (entry) => { if (entry.book) onSelectBook(entry.book); } : undefined}
        />
      )}
    </section>
  );
};
