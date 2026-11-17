import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

type Claim = { workId: string; seriesId: string; workTitle: string; author: string; series: string; ordinal: string | null; origin: string };
type Result = { status: 'matched' | 'no-matching-claim' | 'provider-unavailable'; claims: Claim[]; durationMs?: number };
type Tab = 'investigation' | 'providers';

const card = 'rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4';
const statusLabel: Record<Result['status'], string> = {
  matched: 'Matching claims returned',
  'no-matching-claim': 'No matching claims',
  'provider-unavailable': 'Provider unavailable',
};

/** Admin-only UI. The callable independently authorizes the owner before querying. */
export const AdminSeriesEvidencePanel: React.FC = () => {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [seriesName, setSeriesName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('investigation');

  const inspect = async () => {
    if (!functions || !title.trim() || !author.trim() || !seriesName.trim() || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const callable = httpsCallable<{ title: string; author: string; seriesName: string }, Result>(
        functions, 'inspectSeriesWikidataEvidence');
      const response = await callable({ title: title.trim(), author: author.trim(), seriesName: seriesName.trim() });
      setResult(response.data);
      setTab('investigation');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Evidence inspection unavailable.');
    } finally {
      setBusy(false);
    }
  };

  const ordinals = result?.claims.map(claim => claim.ordinal).filter((value): value is string => Boolean(value)) ?? [];
  const conflictingOrders = new Set(ordinals).size > 1;
  const status = result?.status ?? null;
  const metric = (label: string, value: string | number) => (
    <div className={card} key={label}>
      <div className="text-xs uppercase tracking-wide text-[var(--ink-muted)]">{label}</div>
      <div className="mt-2 text-xl font-semibold text-[var(--ink-ivory)]">{value}</div>
    </div>
  );

  return (
    <section className="space-y-5 rounded-2xl border border-[var(--ink-border-subtle)] p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-[var(--ink-ivory)]">Series Detective — Settings &amp; Diagnostics</h3>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Owner-only, read-only evidence provenance and provider health. No library records are changed.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Evidence inspector sections">
          <button type="button" onClick={() => setTab('investigation')} aria-pressed={tab === 'investigation'} className={tab === 'investigation' ? 'quiet-shelf-secondary-action border-[var(--ink-gold)]' : 'quiet-shelf-secondary-action'}>Investigation Diagnostics</button>
          <button type="button" onClick={() => setTab('providers')} aria-pressed={tab === 'providers'} className={tab === 'providers' ? 'quiet-shelf-secondary-action border-[var(--ink-gold)]' : 'quiet-shelf-secondary-action'}>Providers &amp; Budgets</button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <input aria-label="Owned book title" placeholder="Owned book title" value={title} onChange={event => setTitle(event.target.value)} className="w-full rounded-lg border border-[#a78755] bg-[#24182c] p-3 text-[#fff4dc] caret-[#f6cc75] placeholder:text-[#c9b8d0] focus:border-[#f6cc75] focus:outline-none focus:ring-2 focus:ring-[#f6cc75]/60" maxLength={180} />
        <input aria-label="Author" placeholder="Author" value={author} onChange={event => setAuthor(event.target.value)} className="rounded-lg border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-[var(--ink-ivory)]" maxLength={120} />
        <input aria-label="Series" placeholder="Series" value={seriesName} onChange={event => setSeriesName(event.target.value)} className="rounded-lg border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-[var(--ink-ivory)]" maxLength={160} />
      </div>
      <button type="button" disabled={busy || !title.trim() || !author.trim() || !seriesName.trim()} onClick={() => void inspect()} className="quiet-shelf-secondary-action disabled:opacity-50">
        {busy ? 'Investigating…' : 'Inspect evidence'}
      </button>
      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      {tab === 'investigation' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {metric('Duration', result?.durationMs != null ? result.durationMs + 'ms' : '—')}
            {metric('Requests made', result ? 1 : '—')}
            {metric('Raw claims', result?.claims.length ?? '—')}
            {metric('Unique works', result ? new Set(result.claims.map(claim => claim.workId)).size : '—')}
            {metric('Verified', 'Not assessed')}
            {metric('Review / excluded', 'Not assessed')}
          </div>
          <div className={card}>
            <h4 className="font-semibold text-[var(--ink-ivory)]">Providers Queried</h4>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">Only Wikidata is connected to this server-side inspector. Other catalog providers are not queried; no status is inferred for them.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-[var(--ink-border-subtle)] text-[var(--ink-muted)]"><th className="py-2 pr-3">Provider</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Requests</th><th className="py-2 pr-3">Claims</th><th className="py-2">Duration</th></tr></thead>
                <tbody><tr><td className="py-3 pr-3">Wikidata (P179)</td><td className="py-3 pr-3">{status ? statusLabel[status] : 'Not run'}</td><td className="py-3 pr-3">{result ? 1 : '—'}</td><td className="py-3 pr-3">{result?.claims.length ?? '—'}</td><td className="py-3">{result?.durationMs != null ? result.durationMs + 'ms' : '—'}</td></tr></tbody>
              </table>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={card}>
              <h4 className="font-semibold">Conflicting Metadata</h4>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">{!result ? 'Run an inspection to compare returned claims.' : conflictingOrders ? 'Wikidata returned conflicting series ordinals for this match. Manual review required.' : 'No conflicting ordinals among returned Wikidata claims. Cross-provider conflicts are not assessed.'}</p>
            </div>
            <div className={card}>
              <h4 className="font-semibold">Rejected &amp; Derivative Products</h4>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">Not assessed by this endpoint. Rejection and edition-consolidation diagnostics require the full discovery pipeline.</p>
            </div>
          </div>
          <div className={card}>
            <h4 className="font-semibold">Evidence Provenance</h4>
            {!result ? <p className="mt-2 text-sm text-[var(--ink-muted)]">Enter an owned title, author and series to inspect Wikidata membership claims.</p>
              : result.claims.length === 0 ? <p className="mt-2 text-sm text-[var(--ink-muted)]">{statusLabel[result.status]}. An empty response is not proof that a book is absent from the series.</p>
              : <div className="mt-3 space-y-3">{result.claims.map((claim, index) => (
                <div key={claim.workId + ':' + claim.seriesId + ':' + index} className="rounded-lg border border-[var(--ink-border-subtle)] p-3 text-sm">
                  <div className="font-semibold text-[var(--ink-ivory)]">{claim.workTitle}</div>
                  <div className="mt-1 text-[var(--ink-muted)]">{claim.author} · {claim.series} · position {claim.ordinal ?? 'unknown'}</div>
                  <div className="mt-1 break-words text-xs text-[var(--ink-muted)]">Work: {claim.workId} · Series: {claim.seriesId} · Source: {claim.origin}</div>
                </div>
              ))}</div>}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className={card}><h4 className="font-semibold">Provider access</h4><p className="mt-2 text-sm text-[var(--ink-muted)]">Wikidata is the only active provider in this inspector. Google Books, Open Library, Hardcover and Penguin Random House are used elsewhere in Series Detective, but their health and request counts are not exposed by this endpoint.</p></div>
          <div className={card}><h4 className="font-semibold">Request budget</h4><p className="mt-2 text-sm text-[var(--ink-muted)]">One Wikidata SPARQL request per inspection. The server applies a 12-second request timeout and a 30-second callable timeout. No credentials are displayed or editable here.</p></div>
        </div>
      )}
    </section>
  );
};
