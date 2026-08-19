import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useAccountSync } from '../../context/AccountSyncContext';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import type { ReadingSession, UserBookRecord } from '../../types';
import {
  createRecoveryPoint,
  listRecoveryPoints,
  scheduleRecoveryRestore,
  type RecoveryPointSummary,
} from './dataRecovery';
import { analyzeLibraryIntegrity } from './libraryIntegrity';

const RESTORE_PHRASE = 'RESTORE';
const BOOKS_KEY = 'inkbound_books';
const SESSIONS_KEY = 'inkbound_sessions';
const OWNER_EMAILS = new Set(['blackdame494@gmail.com', 'inkbound@inkydameinteractive.com']);

function formatRecoveryDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown time';
  return parsed.toLocaleString();
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = getRuntimeStorage().getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export const RecoveryCenter: React.FC = () => {
  const { user } = useAccountSync();
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState<RecoveryPointSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<RecoveryPointSummary | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [diagnosticRevision, setDiagnosticRevision] = useState(0);

  const integrity = useMemo(() => {
    const books = readLocalJson<UserBookRecord[]>(BOOKS_KEY, []);
    const sessions = readLocalJson<ReadingSession[]>(SESSIONS_KEY, []);
    return analyzeLibraryIntegrity(books, sessions);
  }, [diagnosticRevision, open]);

  const refresh = async () => {
    if (!user) return;
    setLoading(true);
    setMessage('');
    try {
      setPoints(await listRecoveryPoints(user.uid));
      setDiagnosticRevision((current) => current + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load recovery points.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !user) return;
    void refresh();
  }, [open, user?.uid]);

  if (!user) return null;

  // Owner accounts use the Administration recovery workflow instead of the
  // personal floating shortcut. RecoverySafetyBridge still creates owner
  // snapshots normally, so owner data remains protected and recoverable.
  const isOwnerAccount = Boolean(user.email && OWNER_EMAILS.has(user.email.toLowerCase()));
  if (isOwnerAccount) return null;

  const createManualPoint = async () => {
    setLoading(true);
    setMessage('Creating a full safety copy...');
    try {
      await createRecoveryPoint(user.uid, 'Manual recovery point', { force: true });
      setMessage('Recovery point created.');
      setPoints(await listRecoveryPoints(user.uid));
      setDiagnosticRevision((current) => current + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create a recovery point.');
    } finally {
      setLoading(false);
    }
  };

  const restore = () => {
    if (!selected || confirmation.trim().toUpperCase() !== RESTORE_PHRASE) return;
    setLoading(true);
    setMessage('Restarting Inkbound into protected recovery mode...');
    scheduleRecoveryRestore(user.uid, selected.id);
    window.location.reload();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-5 z-[140] inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-4 text-xs font-bold text-[var(--ink-muted)] shadow-2xl transition hover:text-[var(--ink-ivory)]"
        aria-label="Open your personal Inkbound Recovery Center"
        title="Personal recovery for your own Inkbound account"
      >
        <ShieldCheck className="h-4 w-4 text-[var(--ink-mauve)]" /> My Recovery
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <section
            className="inkbound-panel max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-3xl p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Inkbound Recovery Center"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="inkbound-eyebrow">Personal data protection</p>
                <h2 className="mt-2 flex items-center gap-2 font-serif text-3xl text-[var(--ink-ivory)]">
                  <ShieldCheck className="h-6 w-6 text-[var(--ink-mauve)]" /> My Recovery Center
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
                  These recovery points belong only to your signed-in Inkbound account. Inkbound keeps separate recovery points for your synced books, reading sessions, profile,
                  collections, goals, memories, import state, and photo-memory metadata. Restoring a recovery point
                  first saves the state you are replacing, so recovery itself can be reversed.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="quiet-shelf-icon-button" aria-label="Close Recovery Center">
                <X className="h-4 w-4" />
              </button>
            </div>

            <section className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
              <div className="flex items-start gap-3">
                {integrity.healthy
                  ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                  : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[var(--ink-ivory)]">Current library integrity</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                    {integrity.bookCount.toLocaleString()} books · {integrity.sessionCount.toLocaleString()} sessions · {integrity.activeCoverCount.toLocaleString()} active covers · {integrity.anyEditionCoverCount.toLocaleString()} books with a cover on any edition
                  </p>
                  <div className="mt-3 grid gap-2 text-xs text-[var(--ink-muted)] sm:grid-cols-2">
                    <span>{integrity.importedBookCount.toLocaleString()} imported books</span>
                    <span>{integrity.verifiedImportMetadataCount.toLocaleString()} metadata-verified imports</span>
                    <span>{integrity.visibleSummaryCount.toLocaleString()} visible summaries</span>
                    <span>{integrity.publisherSummaryCount.toLocaleString()} publisher summaries</span>
                    <span>{integrity.missingActiveCoverCount.toLocaleString()} missing active covers</span>
                    <span>{integrity.duplicateIdentityGroupCount.toLocaleString()} possible duplicate identity groups</span>
                  </div>
                  {!integrity.healthy && (
                    <p className="mt-3 text-xs leading-5 text-amber-300">
                      Structural warnings: {integrity.duplicateBookIdCount} duplicate book IDs, {integrity.duplicateSessionIdCount} duplicate session IDs, {integrity.missingActiveEditionCount} missing active editions, {integrity.orphanSessionCount} orphan sessions.
                    </p>
                  )}
                  <p className="mt-3 text-xs leading-5 text-[var(--ink-muted)]">
                    Cover counts here are the covers currently stored in your library. Import/retry messages such as “14 covers” report covers found during that run, not this total.
                  </p>
                </div>
              </div>
            </section>

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" disabled={loading} onClick={() => void createManualPoint()} className="quiet-shelf-primary-action disabled:opacity-50">
                <ShieldCheck className="h-4 w-4" /> Create recovery point now
              </button>
              <button type="button" disabled={loading} onClick={() => void refresh()} className="quiet-shelf-secondary-action disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {message && <p className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 py-3 text-sm text-[var(--ink-muted)]">{message}</p>}

            <div className="mt-6 space-y-3">
              {points.length === 0 && !loading ? (
                <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5 text-sm text-[var(--ink-muted)]">
                  No recovery points yet. Create one now; Inkbound also keeps a daily safety baseline and creates a recovery point immediately before imports.
                </div>
              ) : points.map((point) => (
                <article key={point.id} className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-ivory)]"><Clock3 className="h-4 w-4 text-[var(--ink-mauve)]" /> {formatRecoveryDate(point.createdAtClient)}</div>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">{point.reason}</p>
                      <p className="mt-2 text-xs text-[var(--ink-muted)]">{point.bookCount} books · {point.sessionCount} sessions · {point.auxiliaryCount} account records · {point.photoMemoryCount} photo-memory records · {point.runtimeStateCount} import-state records</p>
                    </div>
                    <button type="button" disabled={loading} onClick={() => { setSelected(point); setConfirmation(''); }} className="quiet-shelf-secondary-action shrink-0 justify-center disabled:opacity-50"><RotateCcw className="h-4 w-4" /> Restore</button>
                  </div>
                </article>
              ))}
            </div>

            {selected && (
              <div className="mt-6 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5">
                <h3 className="font-serif text-xl text-[var(--ink-ivory)]">Restore {formatRecoveryDate(selected.createdAtClient)}?</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Inkbound will restart into protected recovery mode, save a new recovery point of your current cloud state, then replace the synced account records with this copy before normal sync starts. Type <strong className="text-[var(--ink-ivory)]">RESTORE</strong> to continue.</p>
                <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-4 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-3 text-[var(--ink-ivory)] outline-none" placeholder="RESTORE" autoComplete="off" />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" disabled={loading || confirmation.trim().toUpperCase() !== RESTORE_PHRASE} onClick={restore} className="quiet-shelf-primary-action disabled:cursor-not-allowed disabled:opacity-45"><RotateCcw className="h-4 w-4" /> Restore this recovery point</button>
                  <button type="button" disabled={loading} onClick={() => setSelected(null)} className="quiet-shelf-secondary-action">Cancel</button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
};
