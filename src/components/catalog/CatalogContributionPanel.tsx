import { BookDetailsDialogActions } from '../BookDetailsDialogActions';
import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, Loader2, Send } from 'lucide-react';
import type { UserBookRecord } from '../../types';
import { buildCatalogContributionFields, submitCatalogContribution } from '../../features/catalog/metadataContributions';

interface CatalogContributionPanelProps {
  book: UserBookRecord;
  onUpdateBook: (updatedBook: UserBookRecord) => void;
  nativeDialogLayout?: boolean;
}

function contributionErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Inkbound could not submit these book details. Please try again.';
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === 'string' ? record.code.toLowerCase() : '';
  const message = typeof record.message === 'string' ? record.message.trim() : '';

  if (message && message.toLowerCase() !== 'internal' && !message.toLowerCase().endsWith('/internal')) return message;
  if (code.includes('resource-exhausted')) return 'Please wait a moment before submitting another correction.';
  if (code.includes('unauthenticated')) return 'Please sign in again before sharing book details.';
  if (code.includes('permission-denied')) return 'Inkbound could not verify this request. Please reload the app and try again.';
  if (code.includes('failed-precondition')) return 'Add an ISBN, ASIN, or publisher and publication date before sharing this edition.';
  if (code.includes('invalid-argument')) return 'One or more book details need to be corrected before they can be shared.';
  return 'Inkbound could not save these book details. Please try again. If it continues, close this window and reopen the book before retrying.';
}

const cleanAsin = (value: string) => value.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10);

export const CatalogContributionPanel: React.FC<CatalogContributionPanelProps> = ({ book, onUpdateBook, nativeDialogLayout = false }) => {
  const activeEdition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
  const [asin, setAsin] = useState(activeEdition?.asin ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const [submitFailed, setSubmitFailed] = useState(false);

  const normalizedAsin = cleanAsin(asin);
  const asinIsValid = !asin || normalizedAsin.length === 10;

  const contributionBook = useMemo<UserBookRecord>(() => {
    if (!activeEdition || !normalizedAsin) return book;
    return {
      ...book,
      editions: book.editions.map((edition) => edition.id === activeEdition.id ? { ...edition, asin: normalizedAsin } : edition),
    };
  }, [activeEdition, book, normalizedAsin]);

  const fields = useMemo(() => buildCatalogContributionFields(contributionBook), [contributionBook]);

  const saveAsinToEdition = () => {
    if (!activeEdition || !asinIsValid) return false;
    const currentAsin = activeEdition.asin ?? '';
    if (currentAsin === normalizedAsin) return true;
    onUpdateBook({
      ...book,
      editions: book.editions.map((edition) => edition.id === activeEdition.id
        ? { ...edition, asin: normalizedAsin || undefined, externalSource: 'manual' as const }
        : edition),
    });
    return true;
  };

  const submit = async () => {
    if (!fields || submitting || !asinIsValid) return;
    setSubmitting(true);
    setStatus('');
    setSubmitFailed(false);
    try {
      saveAsinToEdition();
      await submitCatalogContribution(contributionBook);
      setStatus('Sent to Inkbound for review. The ASIN was saved to this edition, and your private notes, ratings, reviews, reading progress, tags, and collections were not shared.');
    } catch (error) {
      setSubmitFailed(true);
      setStatus(contributionErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={`rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 sm:p-5 ${nativeDialogLayout ? "flex min-h-0 flex-col overflow-hidden" : ""}`}>
      <div className={nativeDialogLayout ? "min-h-0 overflow-y-auto overscroll-contain" : ""}>
      <div className="flex items-start gap-3">
        <Database className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ink-mauve)]" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[var(--ink-ivory)]">Help improve Inkbound’s book details</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
            Share only this book’s basic edition details with Inkbound for review. Your personal reading data is never included.
          </p>

          <label className="mt-4 block text-xs font-semibold text-[var(--ink-ivory)]">
            Amazon ASIN <span className="font-normal text-[var(--ink-muted)]">(optional — useful for Kindle editions without an ISBN)</span>
            <input
              value={asin}
              onChange={(event) => setAsin(cleanAsin(event.target.value))}
              onBlur={saveAsinToEdition}
              placeholder="B0H8DJVYYP"
              autoCapitalize="characters"
              maxLength={10}
              className="inkbound-select mt-2 w-full"
            />
          </label>
          {!asinIsValid && <p className="mt-2 text-xs text-amber-200">ASINs must be exactly 10 letters or numbers.</p>}
          {asinIsValid && normalizedAsin && <p className="mt-2 text-xs text-[var(--ink-muted)]">This ASIN is saved to the selected edition and helps Inkbound match the correct book.</p>}

          {fields ? (
            <>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--ink-muted)]">
                <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.title}</span>
                <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.author}</span>
                {fields.isbn13 && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">ISBN-13 {fields.isbn13}</span>}
                {!fields.isbn13 && fields.isbn10 && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">ISBN-10 {fields.isbn10}</span>}
                {fields.asin && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">ASIN {fields.asin}</span>}
                {fields.publisher && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.publisher}</span>}
                {fields.publicationDate && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.publicationDate}</span>}
                {fields.pageCount && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.pageCount} pages</span>}
                {fields.format && <span className="rounded-full border border-[var(--ink-border)] px-2.5 py-1">{fields.format}</span>}
              </div>
              {!nativeDialogLayout && (
              <BookDetailsDialogActions>
                <button type="button" onClick={() => void submit()} disabled={submitting || !asinIsValid} className="book-details-dialog-primary">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {submitting ? 'Sending…' : 'Share edition details for review'}
                </button>
              </BookDetailsDialogActions>
              )}
            </>
          ) : (
            <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-200">
              Add an ISBN, ASIN, or publisher and publication date before sharing this edition.
            </p>
          )}

          {status && (
            <div className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-xs leading-5 ${submitFailed ? 'border-amber-300/20 bg-amber-300/5 text-amber-100' : 'border-emerald-300/20 bg-emerald-300/5 text-[var(--ink-muted)]'}`} role="status">
              {submitFailed
                ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />}
              <span>{status}</span>
            </div>
          )}
        </div>
      </div>
      </div>
      {nativeDialogLayout && (
        <div className="mt-4 shrink-0 border-t border-[var(--ink-border)] bg-[var(--ink-surface-soft)] pt-3">
          <BookDetailsDialogActions className="!mt-0">
            <button type="button" onClick={() => void submit()} disabled={!fields || submitting || !asinIsValid} className="book-details-dialog-primary">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? 'Sending…' : 'Share edition details for review'}
            </button>
          </BookDetailsDialogActions>
        </div>
      )}
    </section>
  );
};
