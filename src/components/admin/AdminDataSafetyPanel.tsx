import React, { useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Cloud, Database, HardDrive, Image, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { SYNC_STORAGE_KEYS } from '../../features/sync/storageKeys';
import { AdminSelectiveRecoveryPanel } from './AdminSelectiveRecoveryPanel';

interface DataIntegrityReport {
  generatedAt: string;
  targetUserId: string;
  health: 'healthy' | 'needs-attention';
  criticalIssueCount: number;
  library: {
    books: number; sessions: number; activeCovers: number; booksWithAnyCover: number; missingActiveCovers: number;
    visibleSummaries: number; publisherSummaries: number; importedBooks: number; metadataVerifiedImports: number; possibleDuplicateIdentityGroups: number;
  };
  backup?: {
    tracked: boolean; complete: boolean; expectedBooks: number; savedBooks: number; remainingBooks: number; percentComplete: number; status: string;
  };
  structure: { bookIdMismatches: number; sessionIdMismatches: number; missingActiveEditions: number; orphanSessions: number; malformedSessions: number; };
  cloud: { profilePresent: boolean; auxiliaryRecords: number; photoMemories: number; deletedPhotoMemories: number; recoveryPoints: number; latestRecoveryPointAt: string | null; };
  warnings?: string[];
  storage: {
    status: 'available' | 'unavailable';
    inventoryMode: 'indexed';
    manualCoverAssignments: number;
    photoMemoryRecords: number;
    exactFileCountEnumerated: boolean;
  };
}

interface LibraryInventoryAudit {
  generatedAt: string; deviceCount: number; cloudCount: number;
  checkpointExpected: number | null; checkpointStatus: string | null;
  cloudOnly: Array<{ id: string; title: string; tombstoned: boolean; tombstoneAt: string | null }>;
  localOnly: Array<{ id: string; title: string }>;
  tombstonedButPresent: Array<{ id: string; title: string; tombstoneAt: string }>;
  note: string;
}

interface RecoveryPointSummary {
  id: string; createdAtClient: string; createdAt: string | null; reason: string; bookCount: number; sessionCount: number; auxiliaryCount: number; photoMemoryCount: number; runtimeStateCount: number;
}
interface AdminDataSafetyPanelProps { targetUserId: string | null; targetLabel: string; }
interface DataSafetyState { report: DataIntegrityReport | null; recoveryPoints: RecoveryPointSummary[]; inspectedUserId: string | null; loading: boolean; error: string; }

const dataSafetyListeners = new Set<() => void>();
let dataSafetyState: DataSafetyState = { report: null, recoveryPoints: [], inspectedUserId: null, loading: false, error: '' };
let dataSafetyRequestInFlight = false;
function subscribeDataSafety(listener: () => void) { dataSafetyListeners.add(listener); return () => dataSafetyListeners.delete(listener); }
function getDataSafetySnapshot() { return dataSafetyState; }
function updateDataSafetyState(next: Partial<DataSafetyState>) { dataSafetyState = { ...dataSafetyState, ...next }; dataSafetyListeners.forEach((listener) => listener()); }

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
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
};

export const AdminDataSafetyPanel: React.FC<AdminDataSafetyPanelProps> = ({ targetUserId, targetLabel }) => {
  const { report, recoveryPoints, inspectedUserId, loading, error } = useSyncExternalStore(subscribeDataSafety, getDataSafetySnapshot, getDataSafetySnapshot);
  const [selectedRecoveryId, setSelectedRecoveryId] = useState<string | null>(null);
  const [recoveryReason, setRecoveryReason] = useState('');
  const [recoveryConfirmation, setRecoveryConfirmation] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState('');
  const [inventoryAudit, setInventoryAudit] = useState<LibraryInventoryAudit | null>(null);
  const [inventoryAuditError, setInventoryAuditError] = useState('');
  const [inventoryAuditing, setInventoryAuditing] = useState(false);
  const [orphanConfirmation, setOrphanConfirmation] = useState('');
  const [orphanRemoving, setOrphanRemoving] = useState(false);
  const [orphanResult, setOrphanResult] = useState('');
  const removeOrphanedHardcover = async () => {
    if (!functions || !targetUserId || orphanRemoving || orphanConfirmation !== 'DELETE HARDCOVER') return;
    setOrphanRemoving(true); setOrphanResult('');
    try {
      const cleanup = httpsCallable<{ targetUserId: string; recordId: string; confirmation: string }, { removed: boolean; alreadyAbsent: boolean }>(functions, 'removeVerifiedOrphanedBadBishopHardcover');
      const result = await cleanup({
        targetUserId,
        recordId: 'book-import-import-1058-bad-bishop-standard-edition-',
        confirmation: orphanConfirmation,
      });
      setOrphanResult(result.data.removed ? 'Hardcover removed with deletion tombstone. Rerun the inventory audit to confirm.' : 'Hardcover was already absent.');
      setOrphanConfirmation('');
      setInventoryAudit(null);
      await runIntegrityCheckFromClick();
    } catch (error) {
      setOrphanResult(error instanceof Error ? error.message : 'Cleanup failed; no confirmation of removal.');
    } finally { setOrphanRemoving(false); }
  };
  const runInventoryAudit = async () => {
    if (!functions || !targetUserId || inventoryAuditing) return;
    setInventoryAuditing(true); setInventoryAudit(null); setInventoryAuditError('');
    try {
      const raw = getRuntimeStorage().getItem(SYNC_STORAGE_KEYS.books);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) throw new Error('Local library is not readable on this device.');
      const localBooks = parsed.map((item: unknown) => {
        const book = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const work = book.work && typeof book.work === 'object' ? book.work as Record<string, unknown> : {};
        return { id: typeof book.id === 'string' ? book.id : '', title: String(work.title ?? book.title ?? '') };
      });
      const audit = httpsCallable<{ targetUserId: string; localBooks: Array<{ id: string; title: string }> }, LibraryInventoryAudit>(functions, 'auditAdminLibraryInventory');
      const result = await audit({ targetUserId, localBooks });
      setInventoryAudit(result.data);
    } catch (error) {
      setInventoryAuditError(error instanceof Error ? error.message : 'Inventory audit failed.');
    } finally {
      setInventoryAuditing(false);
    }
  };

  const runIntegrityCheckFromClick = async () => {
    if (!targetUserId) { updateDataSafetyState({ error: 'Select a reader before running an integrity check.' }); return; }
    if (!functions) { updateDataSafetyState({ inspectedUserId: targetUserId, error: 'The Inkbound support service is temporarily unavailable.' }); return; }
    if (dataSafetyRequestInFlight) return;
    dataSafetyRequestInFlight = true;
    updateDataSafetyState({ inspectedUserId: targetUserId, report: null, recoveryPoints: [], loading: true, error: '' });
    setSelectedRecoveryId(null); setRecoveryReason(''); setRecoveryConfirmation(''); setRecoveryStatus('');
    try {
      const getIntegrity = httpsCallable<{ targetUserId: string }, DataIntegrityReport>(functions, 'getAdminDataIntegrity');
      const listRecovery = httpsCallable<{ targetUserId: string }, { points: RecoveryPointSummary[] }>(functions, 'listAdminRecoveryPoints');
      const [integrityResult, recoveryResult] = await Promise.allSettled([
        getIntegrity({ targetUserId }),
        listRecovery({ targetUserId }),
      ]);

      const integrityResponse = integrityResult.status === 'fulfilled' ? integrityResult.value : null;
      const recoveryResponse = recoveryResult.status === 'fulfilled' ? recoveryResult.value : null;
      const failures = [
        integrityResult.status === 'rejected'
          ? `Integrity check failed: ${integrityResult.reason instanceof Error ? integrityResult.reason.message : String(integrityResult.reason)}`
          : '',
        recoveryResult.status === 'rejected'
          ? `Recovery history failed: ${recoveryResult.reason instanceof Error ? recoveryResult.reason.message : String(recoveryResult.reason)}`
          : '',
      ].filter(Boolean);

      updateDataSafetyState({
        report: integrityResponse?.data ?? null,
        recoveryPoints: recoveryResponse?.data.points ?? [],
        inspectedUserId: targetUserId,
        loading: false,
        error: failures.join(' '),
      });
    } catch (requestError) {
      updateDataSafetyState({ report: null, recoveryPoints: [], inspectedUserId: targetUserId, loading: false, error: requestError instanceof Error ? requestError.message : 'The integrity service is temporarily unavailable. Administration is still safe to use; retry this check later.' });
    } finally {
      dataSafetyRequestInFlight = false;
      if (dataSafetyState.loading) updateDataSafetyState({ loading: false });
    }
  };

  const restoreSelectedRecovery = async () => {
    if (!functions || !targetUserId || !selectedRecoveryId || restoring) return;
    if (!recoveryReason.trim() || recoveryConfirmation.trim().toUpperCase() !== 'RESTORE') return;
    setRestoring(true); setRecoveryStatus('Creating a safety copy of the reader’s current cloud data before restore…');
    try {
      const restoreRecovery = httpsCallable<{ targetUserId: string; targetEmail: string; snapshotId: string; reason: string; confirmation: string }, { success: boolean; safetySnapshotId: string }>(functions, 'restoreAdminRecoveryPoint');
      const response = await restoreRecovery({ targetUserId, targetEmail: targetLabel, snapshotId: selectedRecoveryId, reason: recoveryReason.trim(), confirmation: 'RESTORE' });
      setRecoveryStatus(`Reader data restored. A pre-restore safety copy was preserved (${response.data.safetySnapshotId}). Ask the reader to reopen Inkbound so their device loads the restored saved state.`);
      setSelectedRecoveryId(null); setRecoveryReason(''); setRecoveryConfirmation(''); await runIntegrityCheckFromClick();
    } catch (restoreError) { setRecoveryStatus(restoreError instanceof Error ? restoreError.message : 'The reader recovery could not be completed.'); }
    finally { setRestoring(false); }
  };

  const currentReport = inspectedUserId === targetUserId ? report : null;
  const currentRecoveryPoints = inspectedUserId === targetUserId ? recoveryPoints : [];
  const currentError = inspectedUserId === targetUserId ? error : '';
  const needsManualInspection = Boolean(targetUserId && inspectedUserId !== targetUserId && !loading);
  const selectedRecovery = currentRecoveryPoints.find((point) => point.id === selectedRecoveryId) ?? null;
  const backup = currentReport?.backup;

  return (
    <section className="inkbound-panel p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 shrink-0 text-[var(--ink-mauve)]" /><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Data safety & recovery</h2></div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-muted)]">Owner-only support tools for {targetLabel || 'the selected reader'}. Inspection is read-only. Recovery never runs unless you explicitly select a saved recovery point and confirm the restore.</p>
        </div>
        <button type="button" onClick={() => void runIntegrityCheckFromClick()} disabled={!targetUserId || loading || restoring} className="quiet-shelf-secondary-action w-full shrink-0 justify-center disabled:opacity-45 md:w-auto"><RefreshCw className={loading ? 'animate-spin' : ''} />{loading ? 'Inspecting…' : currentReport || currentError ? 'Run integrity check again' : 'Run integrity check'}</button>
      </div>

      {!targetUserId && <p className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">Select a reader above to inspect their saved library and recovery history.</p>}
      {loading && inspectedUserId === targetUserId && <p className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">Checking the reader’s saved library and recovery points now…</p>}
      <section className="mt-4 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-semibold text-[var(--ink-ivory)]">Read-only library inventory audit</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">Compares this device with cloud record IDs and deletion evidence. Does not modify any books.</p></div>
          <button type="button" className="quiet-shelf-secondary-action" disabled={!targetUserId || inventoryAuditing} onClick={() => void runInventoryAudit()}>{inventoryAuditing ? 'Comparing records…' : 'Compare book IDs'}</button>
        </div>
        {inventoryAuditError && <p role="alert" className="mt-3 text-sm text-rose-300">{inventoryAuditError}</p>}
        {inventoryAudit && <div className="mt-4 space-y-3 text-sm text-[var(--ink-muted)]">
          <p>Device: <strong>{inventoryAudit.deviceCount.toLocaleString()}</strong> · Cloud: <strong>{inventoryAudit.cloudCount.toLocaleString()}</strong> · Saved checkpoint: <strong>{inventoryAudit.checkpointExpected?.toLocaleString() ?? 'None'}</strong> ({inventoryAudit.checkpointStatus ?? 'unknown'})</p>
          {([
            ['Cloud-only records', inventoryAudit.cloudOnly],
            ['Device-only records', inventoryAudit.localOnly],
            ['Cloud records with deletion tombstones', inventoryAudit.tombstonedButPresent],
          ] as const).map(([heading, records]) => <div key={heading}>
            <h4 className="font-semibold text-[var(--ink-ivory)]">{heading}: {records.length}</h4>
            {records.length > 0 && <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-[var(--ink-border-subtle)] p-3">
              {records.map((book) => <p key={book.id} className="mb-2 break-all">{book.title || 'Untitled'} · {book.id}{'tombstoned' in book && book.tombstoned ? ' · deletion tombstone exists' : ''}</p>)}
            </div>}
          </div>)}
          {inventoryAudit.cloudOnly.some((book) => book.id === 'book-import-import-1058-bad-bishop-standard-edition-') && <div className="rounded-xl border border-amber-600/50 p-3 space-y-2">
            <h4 className="font-semibold text-[var(--ink-ivory)]">Verified orphan: Bad Bishop hardcover</h4>
            <p className="text-xs">Owner-only, exact-record cleanup. Writes a deletion tombstone and removes this hardcover document atomically. The ebook and all other records are untouched.</p>
            <label className="block text-xs" htmlFor="orphan-delete-confirmation">Type DELETE HARDCOVER to confirm</label>
            <input id="orphan-delete-confirmation" className="w-full rounded-lg border border-[var(--ink-border-subtle)] bg-transparent p-2" value={orphanConfirmation} onChange={(event) => setOrphanConfirmation(event.target.value)} autoComplete="off" />
            <button type="button" className="quiet-shelf-secondary-action" disabled={orphanConfirmation !== 'DELETE HARDCOVER' || orphanRemoving} onClick={() => void removeOrphanedHardcover()}>{orphanRemoving ? 'Removing verified hardcover…' : 'Remove verified hardcover only'}</button>
          </div>}
          {orphanResult && <p role="status">{orphanResult}</p>}
          <p className="text-xs">{inventoryAudit.note}</p>
        </div>}
      </section>
      {needsManualInspection && <p className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">Ready to inspect this reader. No integrity or recovery request has been sent.</p>}
      {currentError && <p className="mt-5 rounded-2xl border border-[#c97b7b]/35 bg-[#c97b7b]/5 p-4 text-sm text-[#e9b2b2]">Data Safety is temporarily unavailable. Administration remains usable. {currentError}</p>}

      {currentReport && <div className="mt-6 space-y-6">
        {currentReport.warnings && currentReport.warnings.length > 0 && (
          <div className="rounded-2xl border border-amber-300/30 bg-amber-300/5 p-4 text-sm text-amber-200">
            <strong className="block text-[var(--ink-ivory)]">Integrity check completed with partial data</strong>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Inkbound could not read every recovery dataset, but the available sections were still inspected. No restore or write was performed.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {currentReport.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}
        <div className={`flex items-start gap-3 rounded-2xl border p-4 ${currentReport.health === 'healthy' ? 'border-emerald-400/25 bg-emerald-400/5' : 'border-amber-300/30 bg-amber-300/5'}`}>
          {currentReport.health === 'healthy' ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />}
          <div><strong className="text-[var(--ink-ivory)]">{currentReport.health === 'healthy' ? `Structure healthy${backup?.tracked && !backup.complete ? ' · Backup not yet verified' : backup?.tracked && backup.complete ? ' · Backup complete' : ''}` : `${currentReport.criticalIssueCount} structural issue${currentReport.criticalIssueCount === 1 ? '' : 's'} need attention`}</strong><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Generated {formatDateTime(currentReport.generatedAt)}. Missing covers and book details are reported separately and do not by themselves mean library corruption.</p></div>
        </div>

        {backup?.tracked && <section className={`rounded-2xl border p-5 ${backup.complete ? 'border-emerald-400/25 bg-emerald-400/5' : 'border-amber-300/30 bg-amber-300/5'}`}>
          <div className="flex items-start gap-3"><Cloud className={`mt-0.5 h-5 w-5 shrink-0 ${backup.complete ? 'text-emerald-300' : 'text-amber-300'}`} /><div className="min-w-0 flex-1"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><h3 className="font-serif text-xl text-[var(--ink-ivory)]">{backup.complete ? 'Library backup complete' : backup.status === 'inventory-mismatch' ? 'Library inventory mismatch' : 'Library backup not yet verified'}</h3><strong className="text-sm text-[var(--ink-ivory)]">{backup.percentComplete}%</strong></div><p className="mt-1 text-sm text-[var(--ink-muted)]">{backup.savedBooks.toLocaleString()} of {backup.expectedBooks.toLocaleString()} books saved{backup.complete ? '.' : backup.status === 'inventory-mismatch' ? ' · Cloud count differs from the saved checkpoint.' : ` · ${backup.remainingBooks.toLocaleString()} remaining.`}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-black/25"><div className="h-full rounded-full bg-current text-[var(--ink-gold)] transition-all" style={{ width: `${backup.percentComplete}%` }} /></div><p className="mt-3 text-xs leading-5 text-[var(--ink-muted)]">{backup.complete ? 'The saved account copy contains the full tracked library.' : backup.status === 'inventory-mismatch' ? 'The cloud inventory and its saved checkpoint disagree. This is not a completed backup; investigate record IDs and deletion tombstones before changing any records.' : 'The saved account copy has not yet been verified as complete.'}</p></div></div>
        </section>}

        <div><div className="mb-3 flex items-center gap-2"><Database className="h-4 w-4 text-[var(--ink-mauve)]" /><h3 className="font-semibold text-[var(--ink-ivory)]">Library & import health</h3></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label={backup?.tracked ? 'Books saved' : 'Books'} value={currentReport.library.books.toLocaleString()} note={backup?.tracked ? 'Books currently present in the saved account copy' : undefined} />
          <Metric label="Sessions" value={currentReport.library.sessions} /><Metric label="Active covers" value={currentReport.library.activeCovers} note={`${currentReport.library.booksWithAnyCover} books have a cover on at least one edition`} /><Metric label="Missing active covers" value={currentReport.library.missingActiveCovers} /><Metric label="Visible summaries" value={currentReport.library.visibleSummaries} note={`${currentReport.library.publisherSummaries} publisher summaries`} /><Metric label="Imported books" value={currentReport.library.importedBooks} /><Metric label="Verified imports" value={currentReport.library.metadataVerifiedImports} /><Metric label="Possible duplicate groups" value={currentReport.library.possibleDuplicateIdentityGroups} note="Same ISBN or normalized title + author across multiple saved records" />
        </div></div>

        <div><div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--ink-mauve)]" /><h3 className="font-semibold text-[var(--ink-ivory)]">Structural integrity</h3></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Book ID mismatches" value={currentReport.structure.bookIdMismatches} /><Metric label="Session ID mismatches" value={currentReport.structure.sessionIdMismatches} /><Metric label="Missing active editions" value={currentReport.structure.missingActiveEditions} /><Metric label="Orphan sessions" value={currentReport.structure.orphanSessions} /><Metric label="Malformed sessions" value={currentReport.structure.malformedSessions} /></div></div>

        <div><div className="mb-3 flex items-center gap-2"><Image className="h-4 w-4 text-[var(--ink-mauve)]" /><h3 className="font-semibold text-[var(--ink-ivory)]">Cloud persistence</h3></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Profile record" value={currentReport.cloud.profilePresent ? 'Present' : 'Missing'} /><Metric label="Auxiliary records" value={currentReport.cloud.auxiliaryRecords} note="Collections, goals, memories, challenges and related account state" /><Metric label="Photo Memories" value={currentReport.cloud.photoMemories} note={`${currentReport.cloud.deletedPhotoMemories} soft-deleted records`} /><Metric label="Recovery points" value={currentReport.cloud.recoveryPoints} note={`Latest: ${formatDateTime(currentReport.cloud.latestRecoveryPointAt)}`} /></div></div>

        <section className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5">
          <div className="flex items-start gap-3"><RotateCcw className="mt-0.5 h-5 w-5 text-[var(--ink-mauve)]" /><div><h3 className="font-serif text-xl text-[var(--ink-ivory)]">Reader recovery history</h3><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Use this only when a reader reports lost or overwritten synced data. Before any restore, Inkbound creates a new safety copy of their current saved state so the support action can be reversed.</p></div></div>
          <div className="mt-4 space-y-3">{currentRecoveryPoints.length === 0 ? <div className="rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4 text-sm text-[var(--ink-muted)]"><strong className="block text-[var(--ink-ivory)]">No recovery history yet</strong><p className="mt-2 leading-6">This reader has not created their first automatic Inkbound safety snapshot yet. Until a snapshot exists, there is no earlier saved state for Administration to restore.</p></div> : currentRecoveryPoints.map((point) => <article key={point.id} className="flex flex-col gap-3 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-ivory)]"><Clock3 className="h-4 w-4 text-[var(--ink-mauve)]" />{formatDateTime(point.createdAtClient || point.createdAt)}</div><p className="mt-1 text-xs text-[var(--ink-muted)]">{point.reason}</p><p className="mt-2 text-xs text-[var(--ink-muted)]">{point.bookCount} books · {point.sessionCount} sessions · {point.auxiliaryCount} account records · {point.photoMemoryCount} photo-memory records</p></div><button type="button" disabled={restoring} onClick={() => { setSelectedRecoveryId(point.id); setRecoveryReason(''); setRecoveryConfirmation(''); setRecoveryStatus(''); }} className="quiet-shelf-secondary-action w-full shrink-0 justify-center disabled:opacity-45 md:w-auto"><RotateCcw className="h-4 w-4" /> Prepare restore</button></article>)}</div>
          {selectedRecovery && <div className="mt-5 rounded-xl border border-amber-300/30 bg-amber-300/5 p-4"><h4 className="font-semibold text-[var(--ink-ivory)]">Restore {formatDateTime(selectedRecovery.createdAtClient || selectedRecovery.createdAt)} for {targetLabel}?</h4><p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">This replaces the reader’s saved books, sessions, profile, account records, and photo-memory data with the selected saved point. Their current saved state is preserved first.</p><label className="mt-4 block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]" htmlFor="admin-recovery-reason">Support reason</label><textarea id="admin-recovery-reason" name="adminRecoveryReason" value={recoveryReason} onChange={(event) => setRecoveryReason(event.target.value)} rows={3} disabled={restoring} placeholder="Required for the admin audit log" className="mt-2 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] p-3 text-sm text-[var(--ink-ivory)] outline-none disabled:opacity-45" /><label className="mt-4 block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]" htmlFor="admin-recovery-confirmation">Type RESTORE</label><input id="admin-recovery-confirmation" name="adminRecoveryConfirmation" autoComplete="off" value={recoveryConfirmation} onChange={(event) => setRecoveryConfirmation(event.target.value)} disabled={restoring} placeholder="RESTORE" className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-3 text-[var(--ink-ivory)] outline-none disabled:opacity-45" /><div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap"><button type="button" onClick={() => void restoreSelectedRecovery()} disabled={restoring || !recoveryReason.trim() || recoveryConfirmation.trim().toUpperCase() !== 'RESTORE'} className="quiet-shelf-primary-action w-full justify-center disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"><RotateCcw className={restoring ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{restoring ? 'Restoring reader…' : 'Restore reader data'}</button><button type="button" disabled={restoring} onClick={() => setSelectedRecoveryId(null)} className="quiet-shelf-secondary-action w-full justify-center disabled:opacity-45 sm:w-auto">Cancel</button></div></div>}
          {recoveryStatus && <p className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-raised)] p-4 text-sm text-[var(--ink-muted)]" role="status">{recoveryStatus}</p>}
          <AdminSelectiveRecoveryPanel targetUserId={targetUserId} targetLabel={targetLabel} />
        </section>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-[var(--ink-mauve)]" />
            <h3 className="font-semibold text-[var(--ink-ivory)]">Stored media</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Storage status" value={currentReport.storage.status === 'available' ? 'Available' : 'Unavailable'} note="Health check only; Inkbound does not enumerate every file." />
            <Metric label="Manual cover assignments" value={currentReport.storage.manualCoverAssignments.toLocaleString()} note="Indexed in Firestore, so this stays fast even for very large libraries." />
            <Metric label="Photo-memory records" value={currentReport.storage.photoMemoryRecords.toLocaleString()} />
            <Metric label="Exact file scan" value={currentReport.storage.exactFileCountEnumerated ? 'Completed' : 'Skipped by design'} note="Full Storage scans are intentionally avoided so 50k-book libraries cannot stall Data Safety." />
          </div>
        </div>
      </div>}
    </section>
  );
};