import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { httpsCallable } from 'firebase/functions';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CreditCard,
  Crown,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Gift,
  Moon,
  RotateCcw,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { PREMIUM_UPGRADE_REASON } from '../config/productPolicy';
import { useAccountSync } from '../context/AccountSyncContext';
import { useUserPlan } from '../context/UserPlanContext';
import { formatTrialDaysRemaining } from '../features/billing/trialAccess';
import { buildInkboundBackup, buildLibraryCsv } from '../features/export/libraryExport';
import { localDateKey } from '../features/reading/sessionAnalytics';
import {
  SERIES_OVERRIDES_STORAGE_KEY,
  type SeriesOverrides,
} from '../features/series/seriesOverrides';
import { ACCOUNT_DATA_STORAGE_KEYS, localClearIntentKey } from '../features/sync/storageKeys';
import { usePersistentState } from '../hooks/usePersistentState';
import { auth, functions } from '../lib/firebase';
import { ResponsiveGrid } from '../layout/responsive';
import { restartRuntimeApp } from '../platform/runtimeAppControl';
import { exportRuntimeTextFile } from '../platform/runtimeExport';
import {
  getRuntimeReauthenticationRequirement,
  reauthenticateRuntimeUser,
} from '../platform/runtimeReauthentication';
import {
  canManageRuntimeSubscription,
  openRuntimeSubscriptionManagement,
} from '../platform/runtimeSubscriptionManagement';
import { removeRuntimeValuesByPrefix, writeRuntimeValue } from '../platform/runtimeStorage';
import type { ReadingSession, UserBookRecord } from '../types';

interface SettingsScreenProps {
  books: UserBookRecord[];
  sessions: ReadingSession[];
  isDarkMode: boolean;
  setIsDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
  onResetData: () => void;
}

const CLEAR_DEVICE_PHRASE = 'CLEAR THIS DEVICE';
const DELETE_ACCOUNT_PHRASE = 'DELETE MY ACCOUNT';

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ books, sessions, isDarkMode, setIsDarkMode, onResetData }) => {
  const { userPlan, accessSource, trialPremiumUntil, openUpgradeModal } = useUserPlan();
  const { user, signOutAccount } = useAccountSync();
  const [annualGoal, setAnnualGoal] = usePersistentState(ACCOUNT_DATA_STORAGE_KEYS.annualReadingGoal, '25');
  const [dailyGoalMins, setDailyGoalMins] = usePersistentState(ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalMinutes, '30');
  const [dailyGoalPages, setDailyGoalPages] = usePersistentState(ACCOUNT_DATA_STORAGE_KEYS.dailyReadingGoalPages, '20');
  const [seriesOverrides] = usePersistentState<SeriesOverrides>(SERIES_OVERRIDES_STORAGE_KEY, {});
  const [exported, setExported] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [deleteSubscriptionAcknowledged, setDeleteSubscriptionAcknowledged] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState('');

  const deleteReauthenticationRequirement = user ? getRuntimeReauthenticationRequirement(user) : 'unsupported';
  const hasPaidSubscription = accessSource === 'subscription';
  const canManageSubscription = canManageRuntimeSubscription();
  const trialAccessLabel = accessSource === 'trial' ? formatTrialDaysRemaining(trialPremiumUntil) : null;

  const markExported = () => { setExported(true); window.setTimeout(() => setExported(false), 3000); };

  const handleExportJSON = async () => {
    const data = buildInkboundBackup(
      books,
      sessions,
      seriesOverrides,
      { annualGoal, dailyGoalMins, dailyGoalPages, theme: isDarkMode ? 'dark' : 'light' },
    );
    await exportRuntimeTextFile({ filename: `inkbound-library-backup-${localDateKey()}.json`, mimeType: 'application/json;charset=utf-8', contents: JSON.stringify(data, null, 2) });
    markExported();
  };

  const handleExportCSV = async () => {
    await exportRuntimeTextFile({ filename: `inkbound-library-${localDateKey()}.csv`, mimeType: 'text/csv;charset=utf-8', contents: buildLibraryCsv(books, seriesOverrides) });
    markExported();
  };

  const confirmReset = async () => {
    if (resetConfirmation.trim().toUpperCase() !== CLEAR_DEVICE_PHRASE || isClearing) return;
    setIsClearing(true);
    try {
      if (user) { writeRuntimeValue(localClearIntentKey(user.uid), '1'); await signOutAccount(); }
      onResetData(); setResetConfirmation(''); setResetDialogOpen(false);
    } finally { setIsClearing(false); }
  };

  const confirmDeleteAccount = async () => {
    if (deleteConfirmation.trim().toUpperCase() !== DELETE_ACCOUNT_PHRASE || !deleteAcknowledged || (hasPaidSubscription && !deleteSubscriptionAcknowledged) || (deleteReauthenticationRequirement === 'password' && !deletePassword) || isDeletingAccount || !user || !functions) return;
    setIsDeletingAccount(true);
    setDeleteAccountError('');
    let deletionStage: 'reauthentication' | 'callable' = 'reauthentication';
    try {
      if (!auth?.currentUser || auth.currentUser.uid !== user.uid) {
        throw new Error('Your account session is no longer active. Sign in again before deleting this account.');
      }
      await reauthenticateRuntimeUser(auth.currentUser, { password: deletePassword });
      // Ensure the callable uses the newly issued credentials rather than a cached token.
      await auth.currentUser.getIdToken(true);
      deletionStage = 'callable';
      const deleteAccount = httpsCallable(functions, 'deleteMyAccount');
      await deleteAccount({ confirmation: DELETE_ACCOUNT_PHRASE });
      onResetData();
      removeRuntimeValuesByPrefix('inkbound_');
      await restartRuntimeApp();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Inkbound could not delete this account.';
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      const authFailure = code === 'functions/unauthenticated' || code === 'auth/user-token-expired' || code === 'auth/user-disabled' || /^unauthenticated$/i.test(message.trim());
      setDeleteAccountError(authFailure
        ? deletionStage === 'callable'
          ? 'The secure deletion service rejected this authenticated request. Your account was not confirmed deleted. Please contact support to check the deployed deleteMyAccount function and Firebase App Check configuration. Error: ' + (code || 'unauthenticated')
          : 'Firebase could not verify your sign-in. Sign in again and retry. Error: ' + (code || 'unauthenticated')
        : message.replace(/^Firebase:\\s*/i, ''));
      setIsDeletingAccount(false);
    }
  };

  const accessLabel = accessSource === 'subscription'
    ? 'Paid subscription'
    : accessSource === 'vip'
      ? 'VIP access'
      : accessSource === 'courtesy'
        ? 'Courtesy Premium'
        : accessSource === 'trial'
          ? `Premium trial${trialAccessLabel ? ` · ${trialAccessLabel}` : ''}`
          : 'Free plan';

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-20">
      <header><p className="inkbound-kicker">Preferences & data</p><h1 className="mt-2 font-serif text-4xl text-[var(--ink-ivory)]">Settings</h1><p className="mt-2 text-sm text-[var(--ink-muted)]">Shape your reading experience, protect your records, and keep a portable copy of your library.</p></header>

      <section className="inkbound-panel space-y-5 rounded-3xl p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--ink-border-subtle)] pb-5 sm:flex-row sm:items-center">
          <div><p className="inkbound-eyebrow">Account access</p><h2 className="mt-2 flex items-center gap-2 font-serif text-2xl text-[var(--ink-ivory)]">{userPlan === 'premium' ? <><Crown className="h-5 w-5 text-[var(--ink-gold)]" /> Inkbound Premium</> : <><BookOpen className="h-5 w-5 text-[var(--ink-muted)]" /> Inkbound Free</>}</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">{accessLabel}</p></div>
          {userPlan === 'free' ? <button type="button" onClick={() => openUpgradeModal(PREMIUM_UPGRADE_REASON)} className="quiet-shelf-primary-action justify-center"><Sparkles className="h-4 w-4" /> View Premium</button> : <span className="inline-flex items-center gap-2 rounded-full border border-[var(--ink-gold)]/35 bg-[var(--ink-gold)]/10 px-4 py-2 text-xs font-bold text-[var(--ink-gold)]"><Check className="h-4 w-4" /> {accessSource === 'trial' ? 'Trial active' : 'Active access'}</span>}
        </div>
        <ResponsiveGrid minItemWidth={240} maxColumns={2} gap={16}>
          <article className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Library capacity</span><p className="mt-2 font-semibold text-[var(--ink-ivory)]">Unlimited reading material and imports</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{userPlan === 'premium' ? 'Premium adds deeper insights and extra tools, not extra library space.' : 'Included with Inkbound Free.'}</p></article>
          <article className="rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">Data ownership</span><p className="mt-2 font-semibold text-[var(--ink-ivory)]">Export at any time</p><p className="mt-1 text-xs text-[var(--ink-muted)]">Your library, notes, sessions, and memories remain yours.</p></article>
        </ResponsiveGrid>
        {userPlan === 'premium' && accessSource === 'subscription' && <div className="flex flex-col gap-4 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 font-semibold text-[var(--ink-ivory)]"><CreditCard className="h-4 w-4 text-[var(--ink-mauve)]" /> Subscription & billing</div><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Change your plan, update payment details, view invoices, or cancel Premium where you originally subscribed.</p>{!canManageSubscription && <p className="mt-2 text-xs text-amber-400">Subscription settings aren’t available on this device yet.</p>}</div><button type="button" disabled={!canManageSubscription} onClick={() => void openRuntimeSubscriptionManagement()} className="quiet-shelf-secondary-action shrink-0 justify-center disabled:cursor-not-allowed disabled:opacity-45"><ExternalLink className="h-4 w-4" /> Manage subscription</button></div>}
        {userPlan === 'premium' && (accessSource === 'vip' || accessSource === 'courtesy') && <div className="flex items-start gap-3 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4"><Gift className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ink-mauve)]" /><div><p className="font-semibold text-[var(--ink-ivory)]">No paid subscription to cancel</p><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Your Premium access is {accessSource === 'vip' ? 'VIP access granted by Inkbound' : 'courtesy access granted by Inkbound'}, so you are not being billed through a subscription.</p></div></div>}
      </section>

      <section className="inkbound-panel rounded-3xl p-6"><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Appearance</h2><div className="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="font-semibold text-[var(--ink-ivory)]">Color theme</p><p className="mt-1 text-sm text-[var(--ink-muted)]">Your choice is saved automatically and follows your account when you are signed in.</p></div><button type="button" onClick={() => setIsDarkMode((current) => !current)} className="quiet-shelf-secondary-action justify-center">{isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{isDarkMode ? 'Use light mode' : 'Use dark mode'}</button></div></section>

      <section className="inkbound-panel rounded-3xl p-6"><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Reading goals</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Changes save automatically.</p><ResponsiveGrid minItemWidth={220} maxColumns={3} gap={16} className="mt-5"><label className="text-sm font-semibold text-[var(--ink-ivory)]">Annual reading goal<input type="number" inputMode="numeric" min="1" max="1000" value={annualGoal} onChange={(event) => setAnnualGoal(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)] outline-none" /></label><label className="text-sm font-semibold text-[var(--ink-ivory)]">Daily page target<input type="number" inputMode="numeric" min="1" max="5000" value={dailyGoalPages} onChange={(event) => setDailyGoalPages(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)] outline-none" /><span className="mt-1 block text-xs font-normal text-[var(--ink-muted)]">Used for print and ebook activity.</span></label><label className="text-sm font-semibold text-[var(--ink-ivory)]">Daily time target in minutes<input type="number" inputMode="numeric" min="1" max="1440" value={dailyGoalMins} onChange={(event) => setDailyGoalMins(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface-soft)] px-3 text-[var(--ink-ivory)] outline-none" /><span className="mt-1 block text-xs font-normal text-[var(--ink-muted)]">Used for timed reading and audiobook activity.</span></label></ResponsiveGrid></section>

      <section className="inkbound-panel rounded-3xl p-6"><h2 className="font-serif text-2xl text-[var(--ink-ivory)]">Export your data</h2><p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Download a complete Inkbound backup, or a spreadsheet-friendly copy of your library. Series corrections, ownership, subscription access, and Collections are included.</p><div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap"><button type="button" onClick={() => void handleExportJSON()} className="quiet-shelf-primary-action justify-center"><Download className="h-4 w-4" /> Complete JSON backup</button><button type="button" onClick={() => void handleExportCSV()} className="quiet-shelf-secondary-action justify-center"><FileSpreadsheet className="h-4 w-4" /> Library CSV</button>{exported && <span className="inline-flex items-center gap-2 px-2 text-sm font-semibold text-emerald-400"><Check className="h-4 w-4" /> Export ready</span>}</div></section>

      <section className="rounded-3xl border border-[#c97b7b]/30 bg-[#c97b7b]/5 p-6"><h2 className="font-serif text-2xl text-[#e9b2b2]">Device & account data</h2><p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Clearing this device keeps your saved Inkbound account. Deleting your account permanently removes the account and Inkbound data associated with it.</p><div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap"><button type="button" onClick={() => { setResetConfirmation(''); setResetDialogOpen(true); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#c97b7b]/40 px-4 text-sm font-bold text-[#e9b2b2] hover:bg-[#c97b7b]/10"><RotateCcw className="h-4 w-4" /> {user ? 'Clear device & sign out' : 'Clear data on this device'}</button><button type="button" disabled={!user} onClick={() => { setDeleteAccountError(''); setDeleteConfirmation(''); setDeleteAcknowledged(false); setDeleteSubscriptionAcknowledged(false); setDeletePassword(''); setDeleteDialogOpen(true); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#a65050] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-4 w-4" /> Delete account & data</button></div>{!user && <p className="mt-3 text-xs text-[var(--ink-muted)]">Sign in before requesting permanent account deletion.</p>}</section>

      {resetDialogOpen && <div className="fixed inset-0 z-[250] grid place-items-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm" onClick={() => !isClearing && setResetDialogOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="clear-data-title" className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-3xl border border-[#c97b7b]/35 bg-[#17101b] p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}><button type="button" disabled={isClearing} onClick={() => setResetDialogOpen(false)} className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-black/25 text-[var(--ink-muted)] disabled:opacity-40" aria-label="Close confirmation"><X className="h-5 w-5" /></button><h3 id="clear-data-title" className="pr-12 font-serif text-3xl text-[var(--ink-ivory)]">Clear this device?</h3><p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">This removes only the Inkbound library and reading sessions saved on this device. Your account library stays intact. {user ? 'You will be signed out before this device is cleared. ' : ''}This action cannot start until you type the exact phrase below.</p><div className="mt-4 rounded-xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-3 text-sm text-[var(--ink-muted)]">Type <strong className="select-all text-[var(--ink-ivory)]">{CLEAR_DEVICE_PHRASE}</strong></div><input value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} autoComplete="off" spellCheck={false} placeholder={CLEAR_DEVICE_PHRASE} className="mt-4 min-h-12 w-full rounded-xl border border-[#c97b7b]/35 bg-[#0d0910] px-4 text-[var(--ink-ivory)] outline-none" /><div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={isClearing} onClick={() => setResetDialogOpen(false)} className="quiet-shelf-secondary-action justify-center disabled:opacity-40">Cancel</button><button type="button" onClick={() => void confirmReset()} disabled={resetConfirmation.trim().toUpperCase() !== CLEAR_DEVICE_PHRASE || isClearing} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#a65050] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{isClearing ? 'Clearing…' : user ? 'Clear this device & sign out' : 'Clear this device'}</button></div></section></div>}

      {deleteDialogOpen && createPortal(<div className="fixed inset-0 z-[260] flex items-start justify-center overflow-y-auto bg-black/85 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(4rem,env(safe-area-inset-top))] backdrop-blur-sm sm:items-center sm:p-4" onClick={() => !isDeletingAccount && setDeleteDialogOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="delete-account-title" className="relative my-auto max-h-[calc(100dvh-5rem)] w-full max-w-xl overflow-x-hidden overflow-y-auto overscroll-contain rounded-3xl border border-[#c97b7b]/45 bg-[#17101b] p-4 shadow-2xl sm:p-6" onClick={(event) => event.stopPropagation()}><button type="button" disabled={isDeletingAccount} onClick={() => setDeleteDialogOpen(false)} className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-black/25 text-[var(--ink-muted)] disabled:opacity-40" aria-label="Close confirmation"><X className="h-5 w-5" /></button><div className="flex items-start gap-3 pr-12"><AlertTriangle className="mt-1 h-6 w-6 shrink-0 text-[#e9b2b2]" /><div><h3 id="delete-account-title" className="font-serif text-3xl text-[var(--ink-ivory)]">Permanently delete your account?</h3><p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">This permanently removes your Inkbound login, saved library, reading sessions, profile, preferences, uploaded profile images, complimentary access, and Inkbound data on this device. This cannot be undone.</p></div></div>{hasPaidSubscription && <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"><p className="text-sm font-bold text-amber-300">Your subscription is managed separately</p><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Deleting your Inkbound account does not automatically cancel an App Store, Google Play, or other paid subscription. Your account can still be deleted now, but billing may continue until you cancel where you originally subscribed.</p>{canManageSubscription && <button type="button" onClick={() => void openRuntimeSubscriptionManagement()} className="quiet-shelf-secondary-action mt-3 justify-center"><ExternalLink className="h-4 w-4" /> Manage subscription</button>}</div>}<div className="mt-5 rounded-2xl border border-[var(--ink-border-subtle)] bg-[var(--ink-surface-soft)] p-4 text-xs leading-5 text-[var(--ink-muted)]">We recommend downloading a complete backup before continuing. Inkbound requires every confirmation below and a fresh sign-in check before permanent deletion begins.</div><label className="mt-5 flex items-start gap-3 rounded-xl border border-[#c97b7b]/30 bg-[#c97b7b]/5 p-4 text-sm leading-5 text-[var(--ink-muted)]"><input type="checkbox" checked={deleteAcknowledged} onChange={(event) => setDeleteAcknowledged(event.target.checked)} disabled={isDeletingAccount} className="mt-0.5 h-4 w-4 shrink-0" /><span>I understand that deleting my account permanently removes my Inkbound account and saved data and cannot be undone.</span></label>{hasPaidSubscription && <label className="mt-3 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm leading-5 text-[var(--ink-muted)]"><input type="checkbox" checked={deleteSubscriptionAcknowledged} onChange={(event) => setDeleteSubscriptionAcknowledged(event.target.checked)} disabled={isDeletingAccount} className="mt-0.5 h-4 w-4 shrink-0" /><span>I understand that deleting my Inkbound account does not cancel my paid subscription and I must manage that subscription separately.</span></label>}<label className="mt-5 block text-sm font-semibold text-[var(--ink-ivory)]">Type <span className="select-all">{DELETE_ACCOUNT_PHRASE}</span> to confirm<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} disabled={isDeletingAccount} autoComplete="off" spellCheck={false} placeholder={DELETE_ACCOUNT_PHRASE} className="mt-2 min-h-12 w-full rounded-xl border border-[#c97b7b]/40 bg-[#0d0910] px-4 text-[var(--ink-ivory)] outline-none disabled:opacity-45" /></label>{deleteReauthenticationRequirement === 'password' && <label className="mt-5 block text-sm font-semibold text-[var(--ink-ivory)]">Verify with your Inkbound password<input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} disabled={isDeletingAccount} autoComplete="current-password" placeholder="Account password" className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ink-border)] bg-[#0d0910] px-4 text-[var(--ink-ivory)] outline-none disabled:opacity-45" /></label>}{deleteReauthenticationRequirement === 'apple' && <p className="mt-4 text-xs leading-5 text-[var(--ink-muted)]">After you press the final delete button, Apple will ask you to verify this account again before Inkbound deletes it.</p>}{deleteReauthenticationRequirement === 'google' && <p className="mt-4 text-xs leading-5 text-[var(--ink-muted)]">After you press the final delete button, Google will ask you to verify this account again before Inkbound deletes it.</p>}{deleteReauthenticationRequirement === 'unsupported' && <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">Account deletion is not available for this sign-in method on this device yet. Please try another device or contact support.</p>}{deleteAccountError && <p className="mt-4 rounded-xl border border-[#c97b7b]/30 bg-[#c97b7b]/10 p-3 text-sm text-[#e9b2b2]" role="alert">{deleteAccountError}</p>}<div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={isDeletingAccount} onClick={() => setDeleteDialogOpen(false)} className="quiet-shelf-secondary-action justify-center disabled:opacity-40">Keep my account</button><button type="button" onClick={() => void confirmDeleteAccount()} disabled={deleteConfirmation.trim().toUpperCase() !== DELETE_ACCOUNT_PHRASE || !deleteAcknowledged || (hasPaidSubscription && !deleteSubscriptionAcknowledged) || (deleteReauthenticationRequirement === 'password' && !deletePassword) || deleteReauthenticationRequirement === 'unsupported' || isDeletingAccount} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#a65050] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-4 w-4" /> {isDeletingAccount ? 'Deleting account…' : 'Verify & permanently delete'}</button></div></section></div>, document.body)}
    </div>
  );
};
