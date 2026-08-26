import React, { useMemo, useState } from 'react';
import { CheckCircle2, Database, Loader2, Send } from 'lucide-react';
import type { UserBookRecord } from '../../types';
import { buildCatalogContributionFields, submitCatalogContribution } from '../../features/catalog/metadataContributions';

interface CatalogContributionPanelProps {
  book: UserBookRecord;
}

export const CatalogContributionPanel: React.FC<CatalogContributionPanelProps> = ({ book }) => {
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const fields = useMemo(() => buildCatalogContributionFields(book), [book]);

  const submit = async () => {
    if (!fields || submitting) return;
    setSubmitting(true);
    setStatus('');
    try {
      await submitCatalogContribution(book);
      setStatus('Submitted for owner review. Your private notes, ratings, reviews, reading progress, tags, and collections were not shared.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Inkbound could not submit these catalog details.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Database className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ink-mauve)]" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[var(--ink-ivory)]">Help improve Inkbound’s catalog</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
            Share only this book’s catalog-safe edition details for owner review. Personal reading data is never included.
          </p>

          {fields ? (
            <>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--ink-muted)]">
                <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.title}</span>
                <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.author}</span>
                {fields.isbn13 && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">ISBN-13 {fields.isbn13}</span>}
                {!fields.isbn13 && fields.isbn10 && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">ISBN-10 {fields.isbn10}</span>}
                {fields.publisher && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.publisher}</span>}
                {fields.publicationDate && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.publicationDate}</span>}
                {fields.pageCount && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.pageCount} pages</span>}
                {fields.format && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.format}</span>}
              </div>
              <button type="button" onClick={() => void submit()} disabled={submitting} className="quiet-shelf-secondary-action mt-4 justify-center disabled:opacity-40">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {submitting ? 'Submitting…' : 'Share edition details for review'}
              </button>
            </>
          ) : (
            <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-200">
              Add an ISBN, an edition identifier, or both publisher and publication date before sharing this edition with the catalog.
            </p>
          )}

          {status && (
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--ink-muted)]" role="status">
              {status.startsWith('Submitted') && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />}
              <span>{status}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
