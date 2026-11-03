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
import { ImportHistoryCloudSyncBridge } from './features/import/ImportHistoryCloudSyncBridge.tsx';
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
import { SessionEvidenceRecoveryBridge } from './features/sync/SessionEvidenceRecoveryBridge.tsx';
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
import { initializeIOSRuntime } from './platform/initializeIOSRuntime.ts';
import {
  getNativeRuntimeError,
  isNativeRuntimeReady,
  markNativeRuntimeFailed,
  subscribeNativeRuntimeReadiness,
} from './platform/runtimeNativeReadiness.ts';
import { isAndroidRuntime, isIOSRuntime, isNativeRuntime } from './platform/runtimePlatform.ts';
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
    if (ready || error || !isNativeRuntime()) return undefined;

    const timer = window.setTimeout(() => {
      markNativeRuntimeFailed(new Error('Secure app services took too long to respond. Check your connection and try again.'));
    }, NATIVE_RUNTIME_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [ready, error]);

  if (error) {
    return (
      <OpeningScreen
        message={`App services could not start: ${error}`}
        actionLabel="Try Again"
        onAction={() => window.location.reload()}
      />
    );
  }

  if (!ready) return <OpeningScreen message="Preparing secure app services..." />;
  return <>{children}</>;
};

const AuthSessionGate = ({ children }: PropsWithChildren) => {
  const { isAuthReady } = useAccountSync();
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    if (isNativeRuntime()) {
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

  if (isNativeRuntime()) return <>{children}</>;
  if (!isAuthReady && !graceElapsed) return <OpeningScreen message="Restoring your saved account…" />;
  return <>{children}</>;
};

/**
 * Large browser libraries are restored from IndexedDB after first paint. The
 * storage bridge rejects writes to sync-critical keys until that restore is done
 * so an empty initial render cannot erase a reader's working copy. Sync bridges
 * must respect the same boundary or their valid cloud writes can be discarded
 * and then replaced by the older IndexedDB snapshot a moment later.
 *
 * The event is only a wake-up signal; readiness is also queried synchronously.
 * On fast browser instances (especially Safari/iPad) hydration can finish before
 * React's effect subscribes. Without the state probe that browser would wait for
 * an event that already fired and none of the cloud sync bridges would ever mount.
 *
 * Android currently uses the same WebView storage boundary unless/until a
 * dedicated native RuntimeStorageAdapter is installed. It must therefore use
 * the same protected IndexedDB hydration path as web; skipping it leaves large
 * local-only libraries exposed to WebView localStorage quota and startup races.
 */
const BrowserStorageHydrationGate = ({ children }: PropsWithChildren) => {
  const [ready, setReady] = useState(
    () => isLargeBrowserStorageHydrated(),
  );

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
            <BrowserStorageHydrationGate>
              <LibrarySyncCheckpointBridge />
              <AdaptiveCloudPersistenceBridge />
              <CloudServerRefreshBridge />
              <CrossDeviceDeltaSyncBridge />
              <SessionEvidenceRecoveryBridge />
              <ManualCoverLedgerBridge />
              <ProtectedBookDetailsLedgerBridge />
              <AuxiliaryAccountSyncBridge />
              <ReadingMemoryCloudSyncBridge />
              <ImportHistoryCloudSyncBridge />
              <ReadOnlyCloudHydrationBridge />
              <PhotoMemoryAutoSyncBridge />
              <LegacyBookCoverMigrationBridge />
              <CanonicalLibraryNormalizationBridge />
            </BrowserStorageHydrationGate>
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
  // All current runtimes use the canonical WebView/browser storage adapter.
  // Protect sync-critical local data before React can mount and write defaults.
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
  } else if (isIOSRuntime()) {
    void initializeIOSRuntime().catch(markNativeRuntimeFailed);
  }

  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <AppErrorBoundary>
        <InkboundApplication />
      </AppErrorBoundary>
    </StrictMode>,
  );

  window.setTimeout(() => {
    void hydrateLargeBrowserStorage()
      .then(() => hydrateDeferredLargeBrowserStorage())
      .catch((error) => {
        console.error('[Inkbound persistence] Startup halted to protect existing library data.', error);
        root.render(
          <OpeningScreen
            message="Saved library storage could not be opened. Inkbound has blocked changes to protect your books. Do not clear app data or reinstall. Try restarting the app."
            actionLabel="Try Again"
            onAction={() => window.location.reload()}
          />,
        );
      });
  }, 0);
}
