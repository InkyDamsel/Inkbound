import { PropsWithChildren, StrictMode, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { UpgradeModal } from './components/UpgradeModal.tsx';
import { AccountSyncProvider, useAccountSync } from './context/AccountSyncContext.tsx';
import { UserPlanProvider } from './context/UserPlanContext.tsx';
import { readImportEnrichmentRetryProgress } from './features/import/importHistory.ts';
import { purgeUnverifiedLegacyImportMetadata } from './features/import/purgeLegacyImportMetadata.ts';
import { CanonicalLibraryNormalizationBridge } from './features/library/CanonicalLibraryNormalizationBridge.tsx';
import { PhotoMemoryAutoSyncBridge } from './features/memories/PhotoMemoryAutoSyncBridge.tsx';
import { ReadingMemoryCloudSyncBridge } from './features/memories/ReadingMemoryCloudSyncBridge.tsx';
import { RecoverySafetyBridge } from './features/recovery/RecoverySafetyBridge.tsx';
import { AdaptiveCloudPersistenceBridge } from './features/sync/AdaptiveCloudPersistenceBridge.tsx';
import { AuxiliaryAccountSyncBridge } from './features/sync/AuxiliaryAccountSyncBridge.tsx';
import { CloudDataRefreshBoundary } from './features/sync/CloudDataRefreshBoundary.tsx';
import { CloudServerRefreshBridge } from './features/sync/CloudServerRefreshBridge.tsx';
import { CrossDeviceDeltaSyncBridge } from './features/sync/CrossDeviceDeltaSyncBridge.tsx';
import { LegacyBookCoverMigrationBridge } from './features/sync/LegacyBookCoverMigrationBridge.tsx';
import { LibrarySyncCheckpointBridge } from './features/sync/LibrarySyncCheckpointBridge.tsx';
import { ManualCoverLedgerBridge } from './features/sync/ManualCoverLedgerBridge.tsx';
import { ProtectedBookDetailsLedgerBridge } from './features/sync/ProtectedBookDetailsLedgerBridge.tsx';
import { ReadOnlyCloudHydrationBridge } from './features/sync/ReadOnlyCloudHydrationBridge.tsx';
import { isolateDevelopmentBrowserStorage } from './features/sync/runtimeStorageIsolation.ts';
import { ThemePersistenceBridge } from './features/sync/ThemePersistenceBridge.tsx';
import { BreakpointProvider } from './layout/responsive/BreakpointProvider.tsx';
import {
  hydrateDeferredLargeBrowserStorage,
  hydrateLargeBrowserStorage,
  isLargeBrowserStorageHydrated,
  LARGE_BROWSER_STORAGE_HYDRATED_EVENT,
  prepareLargeBrowserStorageForStartup,
} from './platform/largeBrowserStorage.ts';
import { initializeAndroidRuntime } from './platform/initializeAndroidRuntime.ts';
import {
  getNativeRuntimeError,
  isNativeRuntimeReady,
  markNativeRuntimeFailed,
  subscribeNativeRuntimeReadiness,
} from './platform/runtimeNativeReadiness.ts';
import { isAndroidRuntime, isNativeRuntime } from './platform/runtimePlatform.ts';
import { SecurityBootstrap } from './security/SecurityBootstrap.tsx';
import './styles/app-shell.css';
import './styles/branding.css';
import './styles/responsive-navigation.css';
import './styles/theme-modes.css';
import './styles/core-pages.css';
import './styles/release-polish.css';
import './styles/light-theme-2.css';
import './styles/mobile-app.css';
import './styles/mobile-help-position.css';
import './styles/mobile-landscape.css';
import './styles/responsive-parity.css';
import './styles/light-theme-contrast.css';

const AUTH_OPEN_GRACE_MS = 1800;
const NATIVE_RUNTIME_TIMEOUT_MS = 15000;

type OpeningScreenProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

const OpeningScreen = ({ message, actionLabel, onAction }: OpeningScreenProps) => (
  <main className="grid min-h-[100dvh] place-items-center bg-[var(--ink-page)] px-[max(1.5rem,env(safe-area-inset-left))] py-[max(1.5rem,env(safe-area-inset-top))] text-center">
    <div className="max-w-sm">
      <div className="mx-auto h-9 w-9 animate-pulse rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-soft)]" />
      <p className="mt-4 font-serif text-xl text-[var(--ink-ivory)]">Opening Inkbound</p>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">{message}</p>
      {actionLabel && onAction && (
        <button type="button" className="quiet-shelf-secondary-action mt-5 justify-center" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  </main>
);

const NativeRuntimeGate = ({ children }: PropsWithChildren) => {
  const ready = useSyncExternalStore(
    subscribeNativeRuntimeReadiness,
    isNativeRuntimeReady,
    isNativeRuntimeReady,
  );
  const error = useSyncExternalStore(
    subscribeNativeRuntimeReadiness,
    getNativeRuntimeError,
    getNativeRuntimeError,
  );

  useEffect(() => {
    if (ready || error || !isAndroidRuntime()) return undefined;

    const timer = window.setTimeout(() => {
      markNativeRuntimeFailed(new Error('Secure Android services took too long to respond. Check your connection and try again.'));
    }, NATIVE_RUNTIME_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [ready, error]);

  if (error) {
    return (
      <OpeningScreen
        message={`Android services could not start: ${error}`}
        actionLabel="Try Again"
        onAction={() => window.location.reload()}
      />
    );
  }

  if (!ready) return <OpeningScreen message="Preparing secure Android services..." />;
  return <>{children}</>;
};

const AuthSessionGate = ({ children }: PropsWithChildren) => {
  const { isAuthReady } = useAccountSync();
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    if (isAndroidRuntime()) {
      setGraceElapsed(true);
      return undefined;
    }

    if (isAuthReady) {
      setGraceElapsed(false);
      return undefined;
    }

    const timer = window.setTimeout(() => setGraceElapsed(true), AUTH_OPEN_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [isAuthReady]);

  if (isAndroidRuntime()) return <>{children}</>;
  if (!isAuthReady && !graceElapsed) return <OpeningScreen message="Restoring your saved account…" />;
  return <>{children}</>;
};

/**
 * Large libraries must use the same IndexedDB-backed storage boundary on web and
 * Android. Keeping Android on raw localStorage made a fresh device fail forever
 * at "Opening Inkbound" when a monster cloud library exceeded WebView storage
 * quota: cloud hydration succeeded, but persisting inkbound_books threw before
 * the canonical owner/hydration markers could be completed.
 *
 * Install the bridge before React mounts, hydrate the startup keys, then release
 * every cloud consumer through this one gate. The bridge keeps a synchronous
 * cache in front of IndexedDB, so existing runtime-storage consumers retain one
 * source of truth without an Android-specific library implementation.
 */
const RuntimeStorageHydrationGate = ({ children }: PropsWithChildren) => {
  const [ready, setReady] = useState(() => isLargeBrowserStorageHydrated());

  useEffect(() => {
    const handleHydrated = () => setReady(true);
    window.addEventListener(LARGE_BROWSER_STORAGE_HYDRATED_EVENT, handleHydrated);

    // Close the subscribe-after-event race. Hydration may have completed between
    // the initial render and this effect attaching its listener.
    if (isLargeBrowserStorageHydrated()) setReady(true);

    return () => window.removeEventListener(LARGE_BROWSER_STORAGE_HYDRATED_EVENT, handleHydrated);
  }, []);

  return ready ? <>{children}</> : null;
};

const InkboundApplication = () => (
  <BreakpointProvider>
    <NativeRuntimeGate>
      <UserPlanProvider>
        <AccountSyncProvider>
          <AuthSessionGate>
            <SecurityBootstrap />
            <RuntimeStorageHydrationGate>
              <LibrarySyncCheckpointBridge />
              <AdaptiveCloudPersistenceBridge />
              <CloudServerRefreshBridge />
              <CrossDeviceDeltaSyncBridge />
              <ManualCoverLedgerBridge />
              <ProtectedBookDetailsLedgerBridge />
              <AuxiliaryAccountSyncBridge />
              <ReadingMemoryCloudSyncBridge />
              <ReadOnlyCloudHydrationBridge />
              <PhotoMemoryAutoSyncBridge />
              <LegacyBookCoverMigrationBridge />
              <CanonicalLibraryNormalizationBridge />
            </RuntimeStorageHydrationGate>
            <ThemePersistenceBridge />
            <CloudDataRefreshBoundary>
              <RecoverySafetyBridge />
              <App />
            </CloudDataRefreshBoundary>
            <UpgradeModal />
          </AuthSessionGate>
        </AccountSyncProvider>
      </UserPlanProvider>
    </NativeRuntimeGate>
  </BreakpointProvider>
);

export async function mountApplication(rootElement: HTMLElement) {
  // The same large-library storage owner is used by web and the Android WebView.
  // This must run before React so an empty initial state cannot overwrite a
  // durable IndexedDB copy while startup hydration is still in flight.
  prepareLargeBrowserStorageForStartup();

  isolateDevelopmentBrowserStorage();
  purgeUnverifiedLegacyImportMetadata();

  if (!isNativeRuntime()) {
    window.addEventListener('beforeunload', (event) => {
      const retry = readImportEnrichmentRetryProgress();
      if (!retry || (retry.status !== 'queued' && retry.status !== 'running')) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  if (isAndroidRuntime()) {
    void initializeAndroidRuntime().catch(markNativeRuntimeFailed);
  }

  createRoot(rootElement).render(
    <StrictMode>
      <AppErrorBoundary>
        <InkboundApplication />
      </AppErrorBoundary>
    </StrictMode>,
  );

  window.setTimeout(() => {
    void hydrateLargeBrowserStorage().finally(() => {
      void hydrateDeferredLargeBrowserStorage();
    });
  }, 0);
}
