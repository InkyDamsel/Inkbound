import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, HardDrive, Image, RefreshCw, ShieldCheck } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

interface DataIntegrityReport {
  generatedAt: string;
  targetUserId: string;
  health: 'healthy' | 'needs-attention';
  criticalIssueCount: number;
  library: {
    books: number;
    sessions: number;
    activeCovers: number;
    booksWithAnyCover: number;
    missingActiveCovers: number;
    visibleSummaries: number;
    publisherSummaries: number;
    importedBooks: number;
    metadataVerifiedImports: number;
    possibleDuplicateIdentityGroups: number;
  };
  structure: {
    bookIdMismatches: number;
    sessionIdMismatches: number;
    missingActiveEditions: number;
    orphanSessions: number;
    malformedSessions: number;
  };
  cloud: {
    profilePresent: boolean;
    auxiliaryRecords: number;
    photoMemories: number;
    deletedPhotoMemories: number;
    recoveryPoints: number;
    latestRecoveryPointAt: string | null;
  };
  storage: {
    status: 'available' | 'unavailable';
    files: number;
    bookCoverFiles: number;
    photoMemoryFiles: number;
    profileMediaFiles: number;
  };
}

interface AdminDataSafetyPanelProps {
  targetUserId: string | null;
  targetLabel: string;
}

const Metric = ({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) => (
  <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
    <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">{label}</span>
    <strong className="mt-2 block font-serif text-2xl text-[var(--ink-ivory)]">{value}</strong>
    {note && <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{note}</p>}
  </div>
);

const formatDateTime = (value: string | null) => {
  if (!value) return 'None yet';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
};

export const AdminDataSafetyPanel: React.FC<AdminDataSafetyPanelProps> = ({ targetUserId, targetLabel }) => {
  const [report, setReport] = useState<DataIntegrityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    if (!targetUserId || !functions) {
      setReport(null);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const getIntegrity = httpsCallable<{ targetUserId: string }, DataIntegrityReport>(functions, 'getAdminDataIntegrity');
      const response = await getIntegrity({ targetUserId });
      setReport(response.data);
    } catch (requestError) {
      setReport(null);
      setError(requestError instanceof Error ? requestError.message : 'Inkbound could not inspect this reader account.');
    } finally {
      setLoading(false);
    }
  }, [targetUserId]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return (
    <section className="inkbound-panel p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--ink-mauve)]" />
            <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Data safety</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Read-only cloud integrity inspection for {targetLabel || 'the selected reader'}. This panel does not edit, sync, restore, or delete reader data.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadReport()}
          disabled={!targetUserId || loading}
          className="quiet-shelf-secondary-action justify-center disabled:opacity-45"
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          {loading ? 'Inspecting…' : 'Run integrity check'}
        </button>
      </div>

      {!targetUserId && <p className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">Select a reader above to inspect their canonical cloud data.</p>}
      {error && <p className="mt-5 rounded-2xl border border-[#c97b7b]/35 bg-[#c97b7b]/5 p-4 text-sm text-[#e9b2b2]">{error}</p>}

      {report && (
        <div className="mt-6 space-y-6">
          <div className={`flex items-start gap-3 rounded-2xl border p-4 ${report.health === 'healthy' ? 'border-emerald-400/25 bg-emerald-400/5' : 'border-amber-300/30 bg-amber-300/5'}`}>
            {report.health === 'healthy'
              ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
              : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />}
            <div>
              <strong className="text-[var(--ink-ivory)]">{report.health === 'healthy' ? 'Canonical structure is healthy' : `${report.criticalIssueCount} structural issue${report.criticalIssueCount === 1 ? '' : 's'} need attention`}</strong>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Generated {formatDateTime(report.generatedAt)}. Missing covers and metadata are reported separately and do not by themselves mean canonical data corruption.</p>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2"><Database className="h-4 w-4 text-[var(--ink-mauve)]" /><h3 className="font-semibold text-[var(--ink-ivory)]">Library & import health</h3></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="Books" value={report.library.books} />
              <Metric label="Sessions" value={report.library.sessions} />
              <Metric label="Active covers" value={report.library.activeCovers} note={`${report.library.booksWithAnyCover} books have a cover on at least one edition`} />
              <Metric label="Missing active covers" value={report.library.missingActiveCovers} />
              <Metric label="Visible summaries" value={report.library.visibleSummaries} note={`${report.library.publisherSummaries} publisher summaries`} />
              <Metric label="Imported books" value={report.library.importedBooks} />
              <Metric label="Verified imports" value={report.library.metadataVerifiedImports} />
              <Metric label="Possible duplicate groups" value={report.library.possibleDuplicateIdentityGroups} note="Same ISBN or normalized title + author across multiple canonical records" />
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--ink-mauve)]" /><h3 className="font-semibold text-[var(--ink-ivory)]">Structural integrity</h3></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="Book ID mismatches" value={report.structure.bookIdMismatches} />
              <Metric label="Session ID mismatches" value={report.structure.sessionIdMismatches} />
              <Metric label="Missing active editions" value={report.structure.missingActiveEditions} />
              <Metric label="Orphan sessions" value={report.structure.orphanSessions} />
              <Metric label="Malformed sessions" value={report.structure.malformedSessions} />
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2"><Image className="h-4 w-4 text-[var(--ink-mauve)]" /><h3 className="font-semibold text-[var(--ink-ivory)]">Cloud persistence</h3></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="Profile record" value={report.cloud.profilePresent ? 'Present' : 'Missing'} />
              <Metric label="Auxiliary records" value={report.cloud.auxiliaryRecords} note="Collections, goals, memories, challenges and related account state" />
              <Metric label="Photo Memories" value={report.cloud.photoMemories} note={`${report.cloud.deletedPhotoMemories} soft-deleted metadata records`} />
              <Metric label="Recovery points" value={report.cloud.recoveryPoints} note={`Latest: ${formatDateTime(report.cloud.latestRecoveryPointAt)}`} />
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2"><HardDrive className="h-4 w-4 text-[var(--ink-mauve)]" /><h3 className="font-semibold text-[var(--ink-ivory)]">Firebase Storage</h3></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="Storage status" value={report.storage.status === 'available' ? 'Available' : 'Unavailable'} />
              <Metric label="Stored files" value={report.storage.files} />
              <Metric label="Manual cover files" value={report.storage.bookCoverFiles} />
              <Metric label="Photo files" value={report.storage.photoMemoryFiles} />
              <Metric label="Profile media files" value={report.storage.profileMediaFiles} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
