import React from 'react';
import { Apple, CloudDownload, CloudUpload, LogOut, ShieldCheck } from 'lucide-react';
import { useAccountSync } from '../../context/AccountSyncContext';

const ProviderButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex min-h-12 items-center justify-center gap-3 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-4 text-sm font-semibold text-[var(--ink-ivory)] transition hover:border-[var(--ink-border-strong)]"
  >
    {children}
    {label}
  </button>
);

export const AccountSyncCard: React.FC = () => {
  const sync = useAccountSync();

  return (
    <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="inkbound-kicker">Optional Cloud Sync</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Take Inkbound with you</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
            Connect an account to back up this device and restore your library, sessions, profile, goals, and preferences elsewhere. Inkbound still works locally without an account.
          </p>
        </div>
        <ShieldCheck className="h-7 w-7 shrink-0 text-[var(--ink-gold)]" />
      </div>

      {!sync.isConfigured && (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-[var(--ink-muted)]">
          Cloud credentials have not been added to this deployment yet. The interface is ready, but sign-in remains disabled until Firebase and provider credentials are configured.
        </div>
      )}

      {!sync.user ? (
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <ProviderButton label="Continue with Google" onClick={() => void sync.signInWithGoogle()}>
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-sm font-bold text-[#4285f4]">G</span>
          </ProviderButton>
          <ProviderButton label="Continue with Apple" onClick={() => void sync.signInWithApple()}>
            <Apple className="h-5 w-5" />
          </ProviderButton>
          <ProviderButton label="Continue with Amazon" onClick={sync.signInWithAmazon}>
            <span className="text-lg font-bold">a</span>
          </ProviderButton>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-[var(--ink-ivory)]">{sync.user.displayName || 'Connected reader'}</p>
              <p className="text-xs text-[var(--ink-muted)]">{sync.user.email || 'Private relay account'}</p>
            </div>
            <button
              type="button"
              onClick={() => void sync.signOutAccount()}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--ink-border)] px-4 text-xs font-semibold text-[var(--ink-muted)]"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void sync.uploadSnapshot()}
              className="quiet-shelf-primary-action min-h-12 justify-center"
            >
              <CloudUpload className="h-4 w-4" /> Sync this device
            </button>
            <button
              type="button"
              onClick={() => void sync.restoreSnapshot()}
              className="quiet-shelf-secondary-action min-h-12 justify-center"
            >
              <CloudDownload className="h-4 w-4" /> Restore from cloud
            </button>
          </div>
        </div>
      )}

      {sync.message && (
        <p
          className={`mt-4 text-sm ${
            sync.status === 'error' ? 'text-rose-500' : 'text-[var(--ink-muted)]'
          }`}
          role="status"
        >
          {sync.message}
        </p>
      )}
    </section>
  );
};
