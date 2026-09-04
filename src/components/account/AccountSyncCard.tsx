import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { Cloud, KeyRound, LogOut, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAccountSync } from '../../context/AccountSyncContext';
import {
  getCloudSyncHealth,
  INKBOUND_CLOUD_SYNC_HEALTH_EVENT,
  requestCloudRefresh,
  type CloudSyncHealth,
} from '../../features/sync/cloudSyncHealth';

const formatLastSync = (value: string | null) => {
  if (!value) return 'No completed account update on this device yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Updated previously' : date.toLocaleString();
};

export const AccountSyncCard: React.FC = () => {
  const sync = useAccountSync();
  const isWorking = sync.status === 'working';
  const [authMode, setAuthMode] = useState<'signin' | 'create'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkPassword, setLinkPassword] = useState('');
  const [cloudHealth, setCloudHealth] = useState<CloudSyncHealth>(() => getCloudSyncHealth());

  useEffect(() => {
    const handleHealth = (event: Event) => {
      setCloudHealth((event as CustomEvent<CloudSyncHealth>).detail);
    };
    window.addEventListener(INKBOUND_CLOUD_SYNC_HEALTH_EVENT, handleHealth);
    return () => window.removeEventListener(INKBOUND_CLOUD_SYNC_HEALTH_EVENT, handleHealth);
  }, []);

  const hasPasswordProvider = useMemo(
    () => sync.user?.providerData.some((provider) => provider.providerId === 'password') ?? false,
    [sync.user],
  );

  const submitEmailAuth = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    if (authMode === 'signin') void sync.signInWithEmail(email, password);
    else void sync.createEmailAccount(email, password);
  };

  return (
    <section className="inkbound-panel rounded-3xl p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="inkbound-kicker">Your Inkbound account</p>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink-ivory)]">Take Inkbound with you</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
            Sign in with Google or email to keep your books, reading sessions, profile, and Photo Memories up to date
            across your devices. Your library belongs to your Inkbound account, not one particular device.
          </p>
        </div>
        <ShieldCheck className="h-7 w-7 shrink-0 text-[var(--ink-gold)]" />
      </div>

      {!sync.isConfigured && (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-[var(--ink-muted)]">
          Account syncing is temporarily unavailable in this version of Inkbound. Please try again after updating the app or contact support.
        </div>
      )}

      {!sync.isAuthReady ? (
        <div className="mt-6 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 text-sm text-[var(--ink-muted)]">
          Restoring your saved account...
        </div>
      ) : !sync.user ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 sm:p-5">
            <button
              type="button"
              onClick={() => void sync.signInWithGoogle()}
              disabled={!sync.isConfigured || isWorking}
              className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-page)] px-4 text-sm font-semibold text-[var(--ink-ivory)] transition hover:border-[var(--ink-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-sm font-bold text-[#4285f4]">G</span>
              Continue with Google
            </button>

            <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
              <span className="h-px flex-1 bg-[var(--ink-border)]" /> or <span className="h-px flex-1 bg-[var(--ink-border)]" />
            </div>

            <div className="mb-4 grid grid-cols-2 rounded-xl bg-[var(--ink-page)] p-1">
              <button type="button" onClick={() => setAuthMode('signin')} className={`min-h-11 rounded-lg px-3 py-2 text-xs font-semibold ${authMode === 'signin' ? 'bg-[var(--ink-surface)] text-[var(--ink-ivory)]' : 'text-[var(--ink-muted)]'}`}>
                Sign in
              </button>
              <button type="button" onClick={() => setAuthMode('create')} className={`min-h-11 rounded-lg px-3 py-2 text-xs font-semibold ${authMode === 'create' ? 'bg-[var(--ink-surface)] text-[var(--ink-ivory)]' : 'text-[var(--ink-muted)]'}`}>
                Create account
              </button>
            </div>

            <form className="space-y-3" onSubmit={submitEmailAuth}>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[var(--ink-muted)]">Email</span>
                <input type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="reader@example.com" className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-page)] px-3 text-sm text-[var(--ink-ivory)] outline-none focus:border-[var(--ink-border-strong)]" required />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[var(--ink-muted)]">Password</span>
                <input type="password" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} className="min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-page)] px-3 text-sm text-[var(--ink-ivory)] outline-none focus:border-[var(--ink-border-strong)]" required />
              </label>
              <button type="submit" disabled={!sync.isConfigured || isWorking} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink-gold)] px-4 text-sm font-bold text-[#20170d] disabled:cursor-not-allowed disabled:opacity-50">
                <Mail className="h-4 w-4" />
                {isWorking ? 'Please wait...' : authMode === 'signin' ? 'Sign in with email' : 'Create Inkbound account'}
              </button>
            </form>

            {authMode === 'signin' && (
              <button type="button" onClick={() => email.trim() && void sync.sendPasswordReset(email)} disabled={!email.trim() || isWorking} className="mt-3 min-h-11 px-1 text-xs font-semibold text-[var(--ink-muted)] underline decoration-[var(--ink-border)] underline-offset-4 disabled:opacity-40">
                Forgot password?
              </button>
            )}
          </div>

          <div className="min-w-0 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-page)] p-4 sm:p-5">
            <p className="text-sm font-bold text-[var(--ink-ivory)]">One account, every device</p>
            <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
              Books, reading sessions, and Photo Memories added on your phone, computer, tablet, or the web stay with the same Inkbound account and appear on your other devices.
            </p>
            <p className="mt-4 text-xs leading-5 text-[var(--ink-muted)]">
              Already use Google? Keep using it. After signing in with Google, you can add an email/password login to the same account instead of creating a second library.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {sync.user.photoURL ? (
                <img src={sync.user.photoURL} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--ink-page)] text-base font-bold text-[var(--ink-gold)]">
                  {(sync.user.email?.[0] || sync.user.displayName?.[0] || 'I').toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[var(--ink-ivory)]">{sync.user.displayName || 'Connected reader'}</p>
                <p className="break-all text-xs text-[var(--ink-muted)]">{sync.user.email || 'Inkbound account connected'}</p>
                <p className="mt-1 break-words text-[11px] text-[var(--ink-faint)]">Signed in on this device · {formatLastSync(cloudHealth.lastSuccessfulSyncAt ?? sync.lastSyncedAt)}</p>
              </div>
            </div>

            <button type="button" onClick={() => void sync.signOutAccount()} disabled={isWorking} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--ink-border)] px-4 text-xs font-semibold text-[var(--ink-muted)] disabled:opacity-50">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>

          {!hasPasswordProvider && sync.user.email && (
            <div className="rounded-2xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] p-4">
              <div className="flex min-w-0 items-start gap-3">
                <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ink-gold)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[var(--ink-ivory)]">Add email/password sign-in</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Add a password to this existing account so you can sign in with either Google or email without creating a second library.</p>
                  {!showLinkForm ? (
                    <button type="button" onClick={() => setShowLinkForm(true)} className="mt-3 min-h-11 rounded-xl border border-[var(--ink-border)] px-4 py-2 text-xs font-semibold text-[var(--ink-ivory)]">Add email login</button>
                  ) : (
                    <form className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); if (sync.user?.email && linkPassword) void sync.linkEmailPassword(sync.user.email, linkPassword); }}>
                      <input type="password" value={linkPassword} onChange={(event) => setLinkPassword(event.target.value)} minLength={6} autoComplete="new-password" placeholder="Choose a password" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-page)] px-3 text-sm text-[var(--ink-ivory)] outline-none focus:border-[var(--ink-border-strong)]" required />
                      <button type="submit" disabled={isWorking} className="min-h-12 shrink-0 rounded-xl bg-[var(--ink-gold)] px-4 text-xs font-bold text-[#20170d] disabled:opacity-50">Link login</button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}

          {!sync.user.emailVerified && sync.user.providerData.some((provider) => provider.providerId === 'password') && (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs text-[var(--ink-muted)]">
              Your email has not been verified yet.{' '}
              <button type="button" onClick={() => void sync.resendVerificationEmail()} disabled={isWorking} className="min-h-11 font-semibold text-[var(--ink-ivory)] underline underline-offset-4">Resend verification email</button>
            </div>
          )}

          <div className={`flex items-start gap-3 rounded-2xl border p-4 ${cloudHealth.status === 'error' ? 'border-rose-500/30 bg-rose-950/15' : cloudHealth.status === 'checking' ? 'border-amber-500/25 bg-amber-950/10' : 'border-emerald-500/25 bg-emerald-950/15'}`}>
            <Cloud className={`mt-0.5 h-5 w-5 shrink-0 ${cloudHealth.status === 'error' ? 'text-rose-300' : cloudHealth.status === 'checking' ? 'text-amber-300' : 'text-emerald-300'}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[var(--ink-ivory)]">
                {cloudHealth.status === 'error' ? 'Your library needs attention' : cloudHealth.status === 'checking' ? 'Checking your saved library…' : cloudHealth.status === 'healthy' ? 'Your library is up to date' : 'Getting your library ready'}
              </p>
              <p className="mt-1 break-words text-xs leading-5 text-[var(--ink-muted)]">{cloudHealth.message}</p>
              <button type="button" onClick={requestCloudRefresh} disabled={cloudHealth.status === 'checking'} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--ink-border)] px-3 text-xs font-semibold text-[var(--ink-ivory)] disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${cloudHealth.status === 'checking' ? 'animate-spin' : ''}`} />
                Try again
              </button>
            </div>
          </div>

          <p className="text-xs text-[var(--ink-faint)]">When you sign in on another device, Inkbound restores your saved library and Photo Memories before adding changes from that device.</p>
        </div>
      )}

      {sync.message && (
        <p className={`mt-4 break-words text-sm ${sync.status === 'error' ? 'text-rose-500' : 'text-[var(--ink-muted)]'}`} role="status">
          {sync.message}
        </p>
      )}
    </section>
  );
};
