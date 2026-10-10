import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Database, RefreshCw } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

type DetailSection = 'collections' | 'books' | 'sessions' | 'auxiliary' | 'profile' | 'photoMemories' | 'syncState' | 'deletions' | 'recoveryPoints' | 'entitlement';

interface DetailItem {
  id: string;
  label: string;
  subtitle?: string;
  count?: number;
  membersPreview?: Array<{ id: string; title: string }>;
  collections?: string[];
  readingStatus?: string;
  activeEditionId?: string;
  isbn?: string;
  sourceOfImport?: string;
  updatedAt?: string | null;
  clientUpdatedAt?: string | null;
  counts?: { books: number; sessions: number; auxiliary: number; photoMemories: number };
  raw?: unknown;
}

interface DetailResult {
  section: DetailSection;
  page: number;
  pageSize: number;
  hasMore: boolean;
  total?: number;
  items: DetailItem[];
}

interface DetailResponse {
  generatedAt: string;
  targetUserId: string;
  details: DetailResult;
}

interface Props {
  targetUserId: string;
}

const SECTION_LABELS: Record<DetailSection, string> = {
  collections: 'Collections',
  books: 'Books',
  sessions: 'Reading sessions',
  auxiliary: 'Auxiliary records',
  profile: 'Profile',
  photoMemories: 'Photo Memories',
  syncState: 'Sync state',
  deletions: 'Deletion history',
  recoveryPoints: 'Recovery points',
  entitlement: 'Entitlement',
};

const PAGE_SIZE = 25;

const formatRaw = (value: unknown) => {
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
};

export const AdminFirestoreInspector: React.FC<Props> = ({ targetUserId }) => {
  const [section, setSection] = useState<DetailSection>('collections');
  const [page, setPage] = useState(0);
  const [details, setDetails] = useState<DetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forensicReport, setForensicReport] = useState<unknown>(null);
  const [forensicLoading, setForensicLoading] = useState(false);
  const [bookQuery, setBookQuery] = useState('');
  const [appliedBookQuery, setAppliedBookQuery] = useState('');

  useEffect(() => {
    setPage(0);
    setDetails(null);
    setError('');
    setBookQuery('');
    setForensicReport(null);
    setAppliedBookQuery('');
  }, [targetUserId]);

  const loadDetails = async (nextSection = section, nextPage = page, nextBookQuery = appliedBookQuery) => {
    if (!functions || !targetUserId || loading) return;
    setLoading(true);
    setError('');
    try {
      const inspect = httpsCallable<{
        targetUserId: string;
        detailSection: DetailSection;
        page: number;
        pageSize: number;
        bookQuery: string;
      }, DetailResponse>(functions, 'getAdminDataIntegrity');
      const response = await inspect({ targetUserId, detailSection: nextSection, page: nextPage, pageSize: PAGE_SIZE, bookQuery: nextSection === 'books' ? nextBookQuery : '' });
      setSection(nextSection);
      setPage(nextPage);
      setAppliedBookQuery(nextBookQuery);
      setDetails(response.data.details);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load Firestore details.');
    } finally {
      setLoading(false);
    }
  };

  const inspectMissingBooks = async () => {
    if (!functions || !targetUserId || forensicLoading) return;
    setForensicLoading(true);
    setError('');
    try {
      const inspect = httpsCallable<{ targetUserId: string; recordIds: string[] }, unknown>(
        functions, 'inspectMissingBookEvidence',
      );
      const response = await inspect({
        targetUserId,
        recordIds: ['book-1791595235234-593eac', 'book-1791595506485-5xidy1'],
      });
      setForensicReport(response.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Forensic inspection failed.');
    } finally {
      setForensicLoading(false);
    }
  };

  const chooseSection = (nextSection: DetailSection) => {
    setSection(nextSection);
    setPage(0);
    setDetails(null);
    void loadDetails(nextSection, 0);
  };

  const renderMetadata = (item: DetailItem) => {
    const parts: string[] = [];
    if (typeof item.count === 'number') parts.push(`${item.count} book${item.count === 1 ? '' : 's'}`);
    if (item.readingStatus) parts.push(item.readingStatus);
    if (item.isbn) parts.push(`ISBN ${item.isbn}`);
    if (item.sourceOfImport) parts.push(`Source: ${item.sourceOfImport}`);
    if (item.collections?.length) parts.push(`Collections: ${item.collections.join(', ')}`);
    if (item.updatedAt || item.clientUpdatedAt) parts.push(`Updated: ${item.updatedAt || item.clientUpdatedAt}`);
    if (item.counts) parts.push(`${item.counts.books} books · ${item.counts.sessions} sessions · ${item.counts.auxiliary} account records · ${item.counts.photoMemories} photo memories`);
    return parts;
  };

  return (
    <section className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-[var(--ink-mauve)]" />
            <h3 className="font-serif text-xl text-[var(--ink-ivory)]">Firestore records</h3>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--ink-muted)]">Read-only owner inspection of the reader’s saved Firestore data. Expand any record to see the stored value. Recovery actions remain in the dedicated recovery tools above.</p>
        </div>
        <button type="button" onClick={() => void loadDetails(section, page)} disabled={loading} className="quiet-shelf-secondary-action w-full justify-center disabled:opacity-45 lg:w-auto">
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{loading ? 'Loading…' : 'Refresh details'}
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {(Object.keys(SECTION_LABELS) as DetailSection[]).map((key) => (
          <button key={key} type="button" onClick={() => chooseSection(key)} className={`rounded-xl border px-3 py-2 text-left text-sm transition ${section === key ? 'border-[var(--ink-gold)]/50 bg-[var(--ink-gold)]/10 text-[var(--ink-ivory)]' : 'border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] text-[var(--ink-muted)] hover:text-[var(--ink-ivory)]'}`}>
            {SECTION_LABELS[key]}
          </button>
        ))}
      </div>

      {section === 'books' && <div className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] p-3">
        <p className="text-xs text-[var(--ink-muted)]">Read-only investigation: Call Me Baby Side A / Side B deletion IDs. Does not restore or modify records.</p>
        <button type="button" disabled={forensicLoading} onClick={() => void inspectMissingBooks()} className="quiet-shelf-secondary-action mt-2 disabled:opacity-45">{forensicLoading ? 'Inspecting…' : 'Inspect missing book evidence'}</button>
        {forensicReport !== null && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs text-[var(--ink-muted)]">{formatRaw(forensicReport)}</pre>}
      </div>}
      {section === 'books' && <form onSubmit={(event) => { event.preventDefault(); void loadDetails('books', 0, bookQuery.trim()); }} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] px-3">
          <span className="sr-only">Search all saved Firestore books</span>
          <input type="search" value={bookQuery} onChange={(event) => setBookQuery(event.target.value)} placeholder="Search all books by title, author, or ISBN" className="w-full min-w-0 bg-transparent text-sm text-[var(--ink-ivory)] outline-none" />
        </label>
        <button type="submit" disabled={loading} className="quiet-shelf-secondary-action justify-center disabled:opacity-45">Search books</button>
        {(appliedBookQuery || bookQuery) && <button type="button" disabled={loading} onClick={() => { setBookQuery(''); void loadDetails('books', 0, ''); }} className="quiet-shelf-secondary-action justify-center disabled:opacity-45">Clear</button>}
      </form>}
      {section === 'books' && <p className="mt-2 text-xs text-[var(--ink-muted)]">Books are sorted A–Z by title across the complete Firestore collection, before pagination. This inspector is read-only.</p>}

      {!details && !loading && !error && <div className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4 text-sm text-[var(--ink-muted)]">Choose a section above to inspect its saved Firestore records.</div>}
      {error && <div className="mt-4 rounded-xl border border-[#c97b7b]/35 bg-[#c97b7b]/5 p-4 text-sm text-[#e9b2b2]">{error}</div>}

      {details && <div className="mt-4 space-y-3">
        <div className="flex flex-col gap-1 text-xs text-[var(--ink-muted)] sm:flex-row sm:items-center sm:justify-between">
          <span><strong className="text-[var(--ink-ivory)]">{SECTION_LABELS[details.section]}</strong>{typeof details.total === 'number' ? ` · ${details.total.toLocaleString()} total` : ''}</span>
          {(details.page > 0 || details.hasMore) && <span>Page {details.page + 1} · up to {details.pageSize} records per page</span>}
        </div>

        {details.items.length === 0 ? <div className="rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4 text-sm text-[var(--ink-muted)]">No saved records in this section.</div> : details.items.map((item) => {
          const metadata = renderMetadata(item);
          return <details key={item.id} className="group rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)]">
            <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <strong className="block break-words text-sm text-[var(--ink-ivory)]">{item.label}</strong>
                  {item.subtitle && <span className="mt-1 block break-all text-xs text-[var(--ink-muted)]">{item.subtitle}</span>}
                  {metadata.length > 0 && <span className="mt-2 block text-xs leading-5 text-[var(--ink-muted)]">{metadata.join(' · ')}</span>}
                </div>
                <span className="mt-2 shrink-0 text-xs font-semibold text-[var(--ink-mauve)] sm:mt-0">View stored data</span>
              </div>
            </summary>
            <div className="border-t border-[var(--ink-border-subtle)] p-4">
              {item.membersPreview && item.membersPreview.length > 0 && <div className="mb-4">
                <strong className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Member books preview</strong>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">{item.membersPreview.map((member) => <div key={member.id} className="rounded-lg border border-[var(--ink-border-subtle)] px-3 py-2 text-xs text-[var(--ink-muted)]"><span className="block text-[var(--ink-ivory)]">{member.title}</span><span className="break-all">{member.id}</span></div>)}</div>
              </div>}
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">Firestore path / document ID</div>
              <div className="mb-4 break-all rounded-lg bg-black/20 p-3 font-mono text-xs text-[var(--ink-muted)]">{item.id}</div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">Stored value</div>
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/25 p-3 text-xs leading-5 text-[var(--ink-muted)]">{formatRaw(item.raw)}</pre>
            </div>
          </details>;
        })}

        {(details.page > 0 || details.hasMore) && <div className="flex items-center justify-between gap-3 pt-2">
          <button type="button" disabled={loading || details.page === 0} onClick={() => void loadDetails(section, Math.max(0, page - 1))} className="quiet-shelf-secondary-action disabled:opacity-45"><ChevronLeft className="h-4 w-4" />Previous</button>
          <button type="button" disabled={loading || !details.hasMore} onClick={() => void loadDetails(section, page + 1)} className="quiet-shelf-secondary-action disabled:opacity-45">Next<ChevronRight className="h-4 w-4" /></button>
        </div>}
      </div>}
    </section>
  );
};
