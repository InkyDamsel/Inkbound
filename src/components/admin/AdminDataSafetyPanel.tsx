import React, { useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, HardDrive, Image, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
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

interface RecoveryPointSummary {
  id: string;
  createdAtClient: string;
  createdAt: string | null;
  reason: string;
  bookCount: number;
  sessionCount: number;
  auxiliaryCount: number;
  photoMemoryCount: number;
  runtimeStateCount: number;
}

interface AdminDataSafetyPanelProps {
  targetUserId: string | null;
  targetLabel: string;
}

interface DataSafetyState {
  report: DataIntegrityReport | null;
  recoveryPoints: RecoveryPointSummary[];
  inspectedUserId: string | null;
  loading: boolean;
  error: string;
}

const dataSafetyListeners = new Set<() => void>();
let dataSafetyState: DataSafetyState = {
  report: null,
  recoveryPoints: [],
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
  const { report, recoveryPoints, inspectedUserId, loading, error } = useSyncExternalStore(
    subscribeDataSafety,
    getDataSafetySnapshot,
    getDataSafetySnapshot,
  );
  const [selectedRecoveryId, setSelectedRecoveryId] = useState<string | null>(null);
  const [recoveryReason, setRecoveryReason] = useState('');
  const [recoveryConfirmation, setRecoveryConfirmation] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState('');

  const runIntegrityCheckFromClick = async () => {
    if (!targetUserId) {
      updateDataSafetyState({ error: 'Select a reader before running an integrity check.' });
      return;
    }
    if (!functions) {
      updateDataSafetyState({ inspectedUserId: targetUserId, error: 'Firebase Functions are unavailable in this Inkbound runtime.' });
      return;
    }
    if (dataSafetyRequestInFlight) return;

    dataSafetyRequestInFlight = true;
    updateDataSafetyState({ inspectedUserId: targetUserId, report: null, recoveryPoints: [], loading: true, error: '' });
    setSelectedRecoveryId(null);
    setRecoveryReason('');
    setRecoveryConfirmation('');
    setRecoveryStatus('');

    try {
      const getIntegrity = httpsCallable<{ targetUserId: string }, DataIntegrityReport>(functions, 'getAdminDataIntegrity');
      const listRecovery = httpsCallable<{ targetUserId: string }, { points: RecoveryPointSummary[] }>(functions, 'listAdminRecoveryPoints');
      const [integrityResponse, recoveryResponse] = await Promise.all([
        getIntegrity({ targetUserId }),
        listRecovery({ targetUserId }),
      ]);
      updateDataSafetyState({
        report: integrityResponse.data,
        recoveryPoints: recoveryResponse.data.points ?? [],
        inspectedUserId: targetUserId,
        loading: false,
        error: '',
      });
    } catch (requestError) {
      updateDataSafetyState({
        report: null,
        recoveryPoints: [],
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

  const restoreSelectedRecovery = async () => {
    if (!functions || !targetUserId || !selectedRecoveryId || restoring) return;
    if (!recoveryReason.trim() || recoveryConfirmation.trim().toUpperCase() !== 'RESTORE') return;

    setRestoring(true);
    setRecoveryStatus('Creating a safety copy of the reader’s current cloud data before restore…');
    try {
      const restoreRecovery = httpsCallable<{
        targetUserId: string;
        targetEmail: string;
        snapshotId: string;
        reason: string;
        confirmation: string;
      }, { success: boolean; safetySnapshotId: string }>(functions, 'restoreAdminRecoveryPoint');
      const response = await restoreRecovery({
        targetUserId,
        targetEmail: targetLabel,
        snapshotId: selectedRecoveryId,
        reason: recoveryReason.trim(),
        confirmation: 'RESTORE',
      });
      setRecoveryStatus(`Reader data restored. A pre-restore safety copy was preserved (${response.data.safetySnapshotId}). Ask the reader to reopen Inkbound so their device hydrates the restored cloud state.`);
      setSelectedRecoveryId(null);
      setRecoveryReason('');
      setRecoveryConfirmation('');
      await runIntegrityCheckFromClick();
    } catch (restoreError) {
      setRecoveryStatus(restoreError instanceof Error ? restoreError.message : 'The reader recovery could not be completed.');
    } finally {
      setRestoring(false);
    }
  };

  const currentReport = inspectedUserId === targetUserId ? report : null;
  const currentRecoveryPoints = inspectedUserId === targetUserId ? recoveryPoints : [];
  const currentError = inspectedUserId === targetUserId ? error : '';
  const needsManualInspection = Boolean(targetUserId && inspectedUserId !== targetUserId && !loading);
  const selectedRecovery = currentRecoveryPoints.find((point) => point.id === selectedRecoveryId) ?? null;

  return (
    <section className="inkbound-panel p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--ink-mauve)]" />
            <h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Data safety & recovery</h2>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">
            Owner-only support tools for {targetLabel || 'the selected reader'}. Inspection is read-only. Recovery never runs unless you explicitly select a saved recovery point and confirm the restore.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runIntegrityCheckFromClick()}
          disabled={!targetUserId || loading || restoring}
          className="quiet-shelf-secondary-action justify-center disabled:opacity-45"
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          {loading ? 'Inspecting…' : currentReport || currentError ? 'Run integrity check again' : 'Run integrity check'}
        </button>
      </div>

      {!targetUserId && <p className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">Select a reader above to inspect their canonical cloud data and recovery history.</p>}
      {loading && inspectedUserId === targetUserId && <p className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">Inspecting canonical cloud data and loading recovery points now…</p>}
      {needsManualInspection && <p className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">Ready to inspect this reader. No integrity or recovery request has been sent.</p>}
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

          <section className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
            <div className="flex items-start gap-3">
              <RotateCcw className="mt-0.5 h-5 w-5 text-[var(--ink-mauve)]" />
              <div>
                <h3 className="font-serif text-xl text-[var(--ink-ivory)]">Reader recovery history</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Use this only when a reader reports lost or overwritten synced data. Before any restore, Inkbound creates a new safety copy of their current cloud state so the support action can be reversed.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {currentRecoveryPoints.length === 0 ? (
                <div className="rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4 text-sm text-[var(--ink-muted)]">
                  <strong className="block text-[var(--ink-ivory)]">No recovery history yet</strong>
                  <p className="mt-2 leading-6">This reader has not created their first automatic Inkbound safety snapshot yet. Restore becomes available after they open a build with recovery protection enabled and complete initial cloud hydration. Until a snapshot exists, there is no earlier saved state for Administration to restore.</p>
                </div>
              ) : currentRecoveryPoints.map((point) => (
                <article key={point.id} className="flex flex-col gap-3 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-ivory)]"><Clock3 className="h-4 w-4 text-[var(--ink-mauve)]" />{formatDateTime(point.createdAtClient || point.createdAt)}</div>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">{point.reason}</p>
                    <p className="mt-2 text-xs text-[var(--ink-muted)]">{point.bookCount} books · {point.sessionCount} sessions · {point.auxiliaryCount} account records · {point.photoMemoryCount} photo-memory records</p>
                  </div>
                  <button type="button" disabled={restoring} onClick={() => { setSelectedRecoveryId(point.id); setRecoveryReason(''); setRecoveryConfirmation(''); setRecoveryStatus(''); }} className="quiet-shelf-secondary-action shrink-0 justify-center disabled:opacity-45"><RotateCcw className="h-4 w-4" /> Prepare restore</button>
                </article>
              ))}
            </div>

            {selectedRecovery && (
              <div className="mt-5 rounded-xl border border-amber-300/30 bg-amber-300/5 p-4">
                <h4 className="font-semibold text-[var(--ink-ivory)]">Restore {formatDateTime(selectedRecovery.createdAtClient || selectedRecovery.createdAt)} for {targetLabel}?</h4>
                <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">This replaces the reader’s canonical cloud books, sessions, profile, account records, and photo-memory metadata with the selected saved point. Their current cloud state is preserved first.</p>
                <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]" htmlFor="admin-recovery-reason">Support reason</label>
                <textarea id="admin-recovery-reason" name="adminRecoveryReason" value={recoveryReason} onChange={(event) => setRecoveryReason(event.target.value)} rows={3} disabled={restoring} placeholder="Required for the admin audit log" className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-3 text-sm text-[var(--ink-ivory)] outline-none disabled:opacity-45" />
                <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]" htmlFor="admin-recovery-confirmation">Type RESTORE</label>
                <input id="admin-recovery-confirmation" name="adminRecoveryConfirmation" autoComplete="off" value={recoveryConfirmation} onChange={(event) => setRecoveryConfirmation(event.target.value)} disabled={restoring} placeholder="RESTORE" className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-3 text-[var(--ink-ivory)] outline-none disabled:opacity-45" />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={() => void restoreSelectedRecovery()} disabled={restoring || !recoveryReason.trim() || recoveryConfirmation.trim().toUpperCase() !== 'RESTORE'} className="quiet-shelf-primary-action justify-center disabled:cursor-not-allowed disabled:opacity-45"><RotateCcw className={restoring ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{restoring ? 'Restoring reader…' : 'Restore reader data'}</button>
                  <button type="button" disabled={restoring} onClick={() => setSelectedRecoveryId(null)} className="quiet-shelf-secondary-action justify-center disabled:opacity-45">Cancel</button>
                </div>
              </div>
            )}

            {recoveryStatus && <p className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4 text-sm text-[var(--ink-muted)]" role="status">{recoveryStatus}</p>}
          </section>

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
