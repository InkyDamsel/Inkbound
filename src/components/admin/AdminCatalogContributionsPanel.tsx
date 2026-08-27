import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Database, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import {
  getCatalogContributions,
  getCatalogPromotionStatuses,
  promoteCatalogContribution,
  reviewCatalogContribution,
  type CatalogContribution,
  type CatalogPromotionStatus,
} from '../../features/catalog/metadataContributions';

type ReviewStatus = 'pending' | 'approved' | 'rejected';

const formatDate = (value: string | null) => {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
};

export const AdminCatalogContributionsPanel: React.FC = () => {
  const [filter, setFilter] = useState<ReviewStatus>('pending');
  const [items, setItems] = useState<CatalogContribution[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [promotionStatuses, setPromotionStatuses] = useState<Record<string, CatalogPromotionStatus>>({});
  const [loading, setLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const load = async (nextFilter = filter) => {
    setLoading(true);
    setStatus('');
    try {
      const next = await getCatalogContributions(nextFilter);
      setItems(next);
      if (nextFilter === 'approved' && next.length > 0) {
        setPromotionStatuses(await getCatalogPromotionStatuses(next.map((item) => item.id)));
      } else {
        setPromotionStatuses({});
      }
      setStatus(`${next.length} ${nextFilter} catalog contribution${next.length === 1 ? '' : 's'} loaded.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Catalog contributions could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(filter);
  }, [filter]);

  const review = async (item: CatalogContribution, decision: 'approved' | 'rejected') => {
    const reviewNote = notes[item.id]?.trim() ?? '';
    if (decision === 'rejected' && !reviewNote) {
      setStatus('Add a review note before rejecting a contribution.');
      return;
    }
    setReviewingId(item.id);
    setStatus('');
    try {
      await reviewCatalogContribution({ contributionId: item.id, decision, reviewNote });
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setNotes((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setStatus(decision === 'approved'
        ? 'Contribution approved. Open the Approved tab when you are ready to promote it to the Trusted Catalog.'
        : 'Contribution rejected and retained in review history.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The contribution could not be reviewed.');
    } finally {
      setReviewingId(null);
    }
  };

  const promote = async (item: CatalogContribution) => {
    setPromotingId(item.id);
    setStatus('');
    try {
      const result = await promoteCatalogContribution(item.id);
      setPromotionStatuses((current) => ({
        ...current,
        [item.id]: { promoted: true, catalogId: result.catalogId, promotedAt: new Date().toISOString() },
      }));
      setStatus(`${item.fields.title} is now live in the Inkbound Trusted Catalog and can be used by metadata searches.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The approved contribution could not be promoted.');
    } finally {
      setPromotingId(null);
    }
  };

  const counts = useMemo(() => ({ visible: items.length }), [items]);

  return (
    <section className="inkbound-panel p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-[var(--ink-mauve)]" />
            <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Catalog contribution review</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Review reader-submitted catalog-safe metadata. Approval verifies the contribution; promotion is a separate owner-only step that makes the record available to Inkbound metadata searches.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="quiet-shelf-secondary-action justify-center disabled:opacity-40">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected'] as ReviewStatus[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`min-h-11 rounded-xl border px-4 text-sm font-semibold capitalize ${filter === value ? 'border-[var(--ink-mauve)] bg-[var(--ink-surface-raised)] text-[var(--ink-ivory)]' : 'border-[var(--ink-border)] text-[var(--ink-muted)]'}`}
          >
            {value}
          </button>
        ))}
      </div>

      {status && <p className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-muted)]" role="status">{status}</p>}

      <div className="mt-5 space-y-4">
        {loading && items.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5 text-sm text-[var(--ink-muted)]"><Loader2 className="h-5 w-5 animate-spin" />Loading contributions…</div>
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--ink-border)] p-6 text-center text-sm text-[var(--ink-muted)]">No {filter} catalog contributions.</p>
        ) : items.map((item) => {
          const fields = item.fields;
          const busy = reviewingId === item.id || promotingId === item.id;
          const promotion = promotionStatuses[item.id];
          return (
            <article key={item.id} className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="block break-words font-serif text-xl text-[var(--ink-ivory)]">{fields.title}</strong>
                    {promotion?.promoted && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-300/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200"><ShieldCheck className="h-3.5 w-3.5" />Trusted Catalog</span>}
                  </div>
                  <span className="text-sm text-[var(--ink-muted)]">{fields.author}</span>
                  <p className="mt-2 break-all text-[11px] text-[var(--ink-muted)]">{item.catalogKey}</p>
                </div>
                <div className="text-xs text-[var(--ink-muted)] lg:text-right">
                  <div>Submitted {formatDate(item.updatedAt ?? item.createdAt)}</div>
                  <div>Contributor {item.contributorHash || 'anonymous'}</div>
                </div>
              </div>

              <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(fields).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => (
                  <div key={key} className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-3">
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">{key.replace(/([A-Z])/g, ' $1')}</dt>
                    <dd className="mt-1 break-words text-sm text-[var(--ink-ivory)]">{String(value)}</dd>
                  </div>
                ))}
              </dl>

              {filter === 'pending' ? (
                <div className="mt-4">
                  <label className="text-xs font-semibold text-[var(--ink-ivory)]" htmlFor={`catalog-review-note-${item.id}`}>Review note</label>
                  <textarea
                    id={`catalog-review-note-${item.id}`}
                    value={notes[item.id] ?? ''}
                    onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                    rows={2}
                    placeholder="Optional for approval; required for rejection"
                    className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-3 text-sm text-[var(--ink-ivory)] outline-none"
                  />
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button type="button" disabled={busy} onClick={() => void review(item, 'rejected')} className="quiet-shelf-secondary-action justify-center disabled:opacity-40"><XCircle className="h-4 w-4" />Reject</button>
                    <button type="button" disabled={busy} onClick={() => void review(item, 'approved')} className="quiet-shelf-primary-action justify-center disabled:opacity-40">{reviewingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve</button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-3 text-xs text-[var(--ink-muted)]">
                    Reviewed {formatDate(item.reviewedAt)}{item.reviewedByEmail ? ` by ${item.reviewedByEmail}` : ''}{item.reviewNote ? ` — ${item.reviewNote}` : ''}
                  </div>
                  {filter === 'approved' && (
                    promotion?.promoted ? (
                      <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-3 text-xs text-emerald-100">Promoted to the Trusted Catalog {promotion.promotedAt ? `on ${formatDate(promotion.promotedAt)}` : ''}. This record can now assist Inkbound metadata searches.</div>
                    ) : (
                      <div className="flex justify-end">
                        <button type="button" disabled={busy} onClick={() => void promote(item)} className="quiet-shelf-primary-action justify-center disabled:opacity-40">{promotingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Promote to Trusted Catalog</button>
                      </div>
                    )
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-[var(--ink-muted)]">Showing {counts.visible} record{counts.visible === 1 ? '' : 's'} in the current review state.</p>
    </section>
  );
};
