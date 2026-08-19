import React, { useSyncExternalStore } from 'react';
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

interface DataSafetyState {
  report: DataIntegrityReport | null;
  inspectedUserId: string | null;
  loading: boolean;
  error: string;
}

const dataSafetyListeners = new Set<() => void>();
let dataSafetyState: DataSafetyState = {
  report: null,
  inspectedUserId: null,
  loading: false,
  error: '',
};
let dataSafetyRequestInFlight = false;

function subscribeDataSafety(listener: () => void) {
  dataSafetyListeners.add(listener);
  return () => dataSafetyListeners.delete(listener);
}

function getDataSafetySnapshot() {
  return dataSafetyState;
}

function updateDataSafetyState(next: Partial<DataSafetyState>) {
  dataSafetyState = { ...dataSafetyState, ...next };
  dataSafetyListeners.forEach((listener) => listener());
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
  const { report, inspectedUserId, loading, error } = useSyncExternalStore(
    subscribeDataSafety,
    getDataSafetySnapshot,
    getDataSafetySnapshot,
  );

  // This is intentionally the only code path that starts an integrity request.
  // The subscription above only keeps UI state alive across Administration remounts.
  const runIntegrityCheckFromClick = async () => {
    if (!targetUserId) {
      updateDataSafetyState({ error: 'Select a reader before running an integrity check.' });
      return;
    }
    if (!functions) {
      updateDataSafetyState({
        inspectedUserId: targetUserId,
        error: 'Firebase Functions are unavailable in this Inkbound runtime.',
      });
      return;
    }
    if (dataSafetyRequestInFlight) return;

    dataSafetyRequestInFlight = true;
    updateDataSafetyState({
      inspectedUserId: targetUserId,
      report: null,
      loading: true,
      error: '',
    });

    try {
      const getIntegrity = httpsCallable<{ targetUserId: string }, DataIntegrityReport>(functions, 'getAdminDataIntegrity');
      const response = await getIntegrity({ targetUserId });
      updateDataSafetyState({
        report: response.data,
        inspectedUserId: targetUserId,
        loading: false,
        error: '',
      });
    } catch (requestError) {
      updateDataSafetyState({
        report: null,
        inspectedUserId: targetUserId,
        loading: false,
        error: requestError instanceof Error
          ? requestError.message
          : 'The integrity service is temporarily unavailable. Administration is still safe to use; retry this check later.',
      });
    } finally {
      dataSafetyRequestInFlight = false;
      if (dataSafetyState.loading) updateDataSafetyState({ loading: false });
    }
  };

  const currentReport = inspectedUserId === targetUserId ? report : null;
  const currentError = inspectedUserId === targetUserId ? error : '';
  const needsManualInspection = Boolean(targetUserId && inspectedUserId !== targetUserId && !loading);

  return (
    <section className="inkbound-panel p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--ink-mauve)]" />
            <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Data safety</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Read-only cloud integrity inspection for {targetLabel || 'the selected reader'}. Nothing runs until you press Run integrity check.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runIntegrityCheckFromClick()}
          disabled={!targetUserId || loading}
          className="quiet-shelf-secondary-action justify-center disabled:opacity-45"
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          {loading ? 'Inspecting…' : currentReport || currentError ? 'Run integrity check again' : 'Run integrity check'}
        </button>
      </div>

      {!targetUserId && <p className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">Select a reader above to inspect their canonical cloud data.</p>}
      {loading && inspectedUserId === targetUserId && <p className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">Inspecting canonical cloud data now…</p>}
      {needsManualInspection && <p className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">Ready to inspect this reader. No integrity request has been sent.</p>}
      {currentError && <p className="mt-5 rounded-2xl border border-[#c97b7b]/35 bg-[#c97b7b]/5 p-4 text-sm text-[#e9b2b2]">Data Safety is temporarily unavailable. Administration remains usable. {currentError}</p>}

      {currentReport && (
        <div className="mt-6 space-y-6">
          <div className={`flex items-start gap-3 rounded-2xl border p-4 ${currentReport.health === 'healthy' ? 'border-emerald-400/25 bg-emerald-400/5' : 'border-amber-300/30 bg-amber-300/5'}`}>
            {currentReport.health === 'healthy'
              ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
              : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />}
            <div>
              <strong className="text-[var(--ink-ivory)]">{currentReport.health === 'healthy' ? 'Canonical structure is healthy' : `${currentReport.criticalIssueCount} structural issue${currentReport.criticalIssueCount === 1 ? '' : 's'} need attention`}</strong>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Generated {formatDateTime(currentReport.generatedAt)}. Missing covers and metadata are reported separately and do not by themselves mean canonical data corruption.</p>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2"><Database className="h-4 w-4 text-[var(--ink-mauve)]" /><h3 className="font-semibold text-[var(--ink-ivory)]">Library & import health</h3></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="Books" value={currentReport.library.books} />
              <Metric label="Sessions" value={currentReport.library.sessions} />
              <Metric label="Active covers" value={currentReport.library.activeCovers} note={`${currentReport.library.booksWithAnyCover} books have a cover on at least one edition`} />
              <Metric label="Missing active covers" value={currentReport.library.missingActiveCovers} />
              <Metric label="Visible summaries" value={currentReport.library.visibleSummaries} note={`${currentReport.library.publisherSummaries} publisher summaries`} />
              <Metric label="Imported books" value={currentReport.library.importedBooks} />
              <Metric label="Verified imports" value={currentReport.library.metadataVerifiedImports} />
              <Metric label="Possible duplicate groups" value={currentReport.library.possibleDuplicateIdentityGroups} note="Same ISBN or normalized title + author across multiple canonical records" />
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--ink-mauve)]" /><h3 className="font-semibold text-[var(--ink-ivory)]">Structural integrity</h3></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="Book ID mismatches" value={currentReport.structure.bookIdMismatches} />
              <Metric label="Session ID mismatches" value={currentReport.structure.sessionIdMismatches} />
              <Metric label="Missing active editions" value={currentReport.structure.missingActiveEditions} />
              <Metric label="Orphan sessions" value={currentReport.structure.orphanSessions} />
              <Metric label="Malformed sessions" value={currentReport.structure.malformedSessions} />
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2"><Image className="h-4 w-4 text-[var(--ink-mauve)]" /><h3 className="font-semibold text-[var(--ink-ivory)]">Cloud persistence</h3></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="Profile record" value={currentReport.cloud.profilePresent ? 'Present' : 'Missing'} />
              <Metric label="Auxiliary records" value={currentReport.cloud.auxiliaryRecords} note="Collections, goals, memories, challenges and related account state" />
              <Metric label="Photo Memories" value={currentReport.cloud.photoMemories} note={`${currentReport.cloud.deletedPhotoMemories} soft-deleted metadata records`} />
              <Metric label="Recovery points" value={currentReport.cloud.recoveryPoints} note={`Latest: ${formatDateTime(currentReport.cloud.latestRecoveryPointAt)}`} />
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2"><HardDrive className="h-4 w-4 text-[var(--ink-mauve)]" /><h3 className="font-semibold text-[var(--ink-ivory)]">Firebase Storage</h3></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="Storage status" value={currentReport.storage.status === 'available' ? 'Available' : 'Unavailable'} />
              <Metric label="Stored files" value={currentReport.storage.files} />
              <Metric label="Manual cover files" value={currentReport.storage.bookCoverFiles} />
              <Metric label="Photo files" value={currentReport.storage.photoMemoryFiles} />
              <Metric label="Profile media files" value={currentReport.storage.profileMediaFiles} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};