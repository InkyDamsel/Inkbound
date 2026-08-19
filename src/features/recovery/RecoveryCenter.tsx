import React, { useEffect, useState } from 'react';
import { Clock3, RefreshCw, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useAccountSync } from '../../context/AccountSyncContext';
import {
  createRecoveryPoint,
  listRecoveryPoints,
  restoreRecoveryPoint,
  type RecoveryPointSummary,
} from './dataRecovery';

const RESTORE_PHRASE = 'RESTORE';

function formatRecoveryDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown time';
  return parsed.toLocaleString();
}

export const RecoveryCenter: React.FC = () => {
  const { user } = useAccountSync();
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState<RecoveryPointSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<RecoveryPointSummary | null>(null);
  const [confirmation, setConfirmation] = useState('');

  const refresh = async () => {
    if (!user) return;
    setLoading(true);
    setMessage('');
    try {
      setPoints(await listRecoveryPoints(user.uid));
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

  const createManualPoint = async () => {
    setLoading(true);
    setMessage('Creating a full safety copy...');
    try {
      await createRecoveryPoint(user.uid, 'Manual recovery point', { force: true });
      setMessage('Recovery point created.');
      setPoints(await listRecoveryPoints(user.uid));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create a recovery point.');
    } finally {
      setLoading(false);
    }
  };

  const restore = async () => {
    if (!selected || confirmation.trim().toUpperCase() !== RESTORE_PHRASE) return;
    setLoading(true);
    setMessage('Restoring this recovery point and preserving the current state first...');
    try {
      await restoreRecoveryPoint(user.uid, selected.id);
      setMessage('Recovery complete. Reloading Inkbound...');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Recovery failed. Nothing was intentionally cleared.');
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-[140] inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-4 text-xs font-bold text-[var(--ink-muted)] shadow-2xl transition hover:text-[var(--ink-ivory)]"
        aria-label="Open Inkbound Recovery Center"
      >
        <ShieldCheck className="h-4 w-4 text-[var(--ink-mauve)]" /> Data Safety
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
                <p className="inkbound-eyebrow">Data protection</p>
                <h2 className="mt-2 flex items-center gap-2 font-serif text-3xl text-[var(--ink-ivory)]">
                  <ShieldCheck className="h-6 w-6 text-[var(--ink-mauve)]" /> Recovery Center
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
                  Inkbound keeps separate recovery points for your synced books, reading sessions, profile,
                  collections, goals, memories, and photo-memory metadata. Restoring a recovery point first
                  saves the state you are replacing, so recovery itself can be reversed.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="quiet-shelf-icon-button" aria-label="Close Recovery Center">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" disabled={loading} onClick={() => void createManualPoint()} className="quiet-shelf-primary-action disabled:opacity-50">
                <ShieldCheck className="h-4 w-4" /> Create recovery point now
              </button>
              <button type="button" disabled={loading} onClick={() => void refresh()} className="quiet-shelf-secondary-action disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {message && (
              <p className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] px-4 py-3 text-sm text-[var(--ink-muted)]">
                {message}
              </p>
            )}

            <div className="mt-6 space-y-3">
              {points.length === 0 && !loading ? (
                <div className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-5 text-sm text-[var(--ink-muted)]">
                  No recovery points yet. Create one now; automatic safety copies are also created while you use a signed-in Inkbound account.
                </div>
              ) : points.map((point) => (
                <article key={point.id} className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-ivory)]">
                        <Clock3 className="h-4 w-4 text-[var(--ink-mauve)]" /> {formatRecoveryDate(point.createdAtClient)}
                      </div>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">{point.reason}</p>
                      <p className="mt-2 text-xs text-[var(--ink-muted)]">
                        {point.bookCount} books · {point.sessionCount} sessions · {point.auxiliaryCount} account records · {point.photoMemoryCount} photo-memory records
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => { setSelected(point); setConfirmation(''); }}
                      className="quiet-shelf-secondary-action shrink-0 justify-center disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" /> Restore
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {selected && (
              <div className="mt-6 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5">
                <h3 className="font-serif text-xl text-[var(--ink-ivory)]">Restore {formatRecoveryDate(selected.createdAtClient)}?</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                  Inkbound will create a new recovery point of your current cloud state first, then replace the synced account records with this copy.
                  Type <strong className="text-[var(--ink-ivory)]">RESTORE</strong> to continue.
                </p>
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className="mt-4 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-raised)] px-3 text-[var(--ink-ivory)] outline-none"
                  placeholder="RESTORE"
                  autoComplete="off"
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={loading || confirmation.trim().toUpperCase() !== RESTORE_PHRASE}
                    onClick={() => void restore()}
                    className="quiet-shelf-primary-action disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <RotateCcw className="h-4 w-4" /> Restore this recovery point
                  </button>
                  <button type="button" disabled={loading} onClick={() => setSelected(null)} className="quiet-shelf-secondary-action">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
};
