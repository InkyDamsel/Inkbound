import React, { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { useAccountSync } from '../../context/AccountSyncContext';
import {
  clearScheduledRecoveryRestore,
  readScheduledRecoveryRestore,
  restoreRecoveryPoint,
} from './dataRecovery';

export const RecoveryRestoreGate: React.FC<PropsWithChildren> = ({ children }) => {
  const { user } = useAccountSync();
  const [state, setState] = useState<'idle' | 'restoring' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const restoreStarted = useRef(false);

  const scheduled = user ? readScheduledRecoveryRestore(user.uid) : null;

  useEffect(() => {
    if (!user || !scheduled || restoreStarted.current) return;
    restoreStarted.current = true;
    setState('restoring');
    void restoreRecoveryPoint(user.uid, scheduled.snapshotId)
      .then(() => {
        clearScheduledRecoveryRestore();
        // A clean navigation gives all sync bridges fresh in-memory fingerprints
        // built from the restored cloud/local state.
        window.location.replace(window.location.href);
      })
      .catch((error) => {
        clearScheduledRecoveryRestore();
        setErrorMessage(error instanceof Error ? error.message : 'Inkbound could not restore this recovery point.');
        setState('error');
      });
  }, [user?.uid, scheduled?.snapshotId]);

  if (scheduled || state === 'restoring') {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[var(--ink-page)] px-6 text-center">
        <div className="max-w-md">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-soft)]" />
          <h1 className="mt-5 font-serif text-2xl text-[var(--ink-ivory)]">Restoring your Inkbound library</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Your current state was preserved first. Keep Inkbound open while the selected recovery point is restored.</p>
        </div>
      </main>
    );
  }

  if (state === 'error') {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[var(--ink-page)] px-6 text-center">
        <div className="max-w-md">
          <h1 className="font-serif text-2xl text-[var(--ink-ivory)]">Recovery could not finish</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{errorMessage}</p>
          <button type="button" className="quiet-shelf-primary-action mt-5" onClick={() => window.location.reload()}>Return to Inkbound</button>
        </div>
      </main>
    );
  }

  return <>{children}</>;
};