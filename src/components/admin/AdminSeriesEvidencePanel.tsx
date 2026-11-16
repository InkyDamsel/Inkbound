import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

type Claim = { workId: string; seriesId: string; workTitle: string; author: string; series: string; ordinal: string | null; origin: string };
type Result = { status: 'matched' | 'no-matching-claim' | 'provider-unavailable'; claims: Claim[] };

/** Admin dashboard only. Authorization is enforced again in the Firebase callable. */
export const AdminSeriesEvidencePanel: React.FC = () => {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [seriesName, setSeriesName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const inspect = async () => {
    if (!functions || !title.trim() || !author.trim() || !seriesName.trim()) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const callable = httpsCallable<{ title: string; author: string; seriesName: string }, Result>(
        functions, 'inspectSeriesWikidataEvidence');
      const response = await callable({ title: title.trim(), author: author.trim(), seriesName: seriesName.trim() });
      setResult(response.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Evidence inspection unavailable.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border border-[var(--ink-border-subtle)] p-4">
      <h3 className="font-semibold">Series Detective — admin evidence</h3>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">Server-authorized Wikidata P179 membership inspection. No library records are changed. Other catalog evidence is not yet exposed here.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <input aria-label="Book title" placeholder="Owned book title" value={title} onChange={event => setTitle(event.target.value)} className="rounded-lg border p-2 text-black" maxLength={180} />
        <input aria-label="Book author" placeholder="Author" value={author} onChange={event => setAuthor(event.target.value)} className="rounded-lg border p-2 text-black" maxLength={120} />
        <input aria-label="Series name" placeholder="Series" value={seriesName} onChange={event => setSeriesName(event.target.value)} className="rounded-lg border p-2 text-black" maxLength={160} />
      </div>
      <button type="button" disabled={busy || !title.trim() || !author.trim() || !seriesName.trim()} onClick={() => void inspect()} className="quiet-shelf-secondary-action mt-3">
        {busy ? 'Inspecting…' : 'Inspect Wikidata evidence'}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-rose-400">{error}</p>}
      {result && <div className="mt-3 text-sm">
        <p>Provider status: {result.status}. {result.claims.length} matching claim(s).</p>
        {result.claims.map((claim, index) => <p key={claim.workId + index} className="mt-2 break-words">
          {claim.workTitle} · {claim.author} · {claim.series} · position {claim.ordinal ?? 'unknown'} · work {claim.workId} · series {claim.seriesId} · {claim.origin}
        </p>)}
      </div>}
    </section>
  );
};
