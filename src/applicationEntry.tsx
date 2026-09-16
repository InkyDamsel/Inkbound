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
const NATIVE_SERVICES_FAIL_OPEN_MS = 2500;

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

/**
 * Android native services may initialize a fraction later than the WebView.
 * They must never hold the entire application behind a startup screen: a slow or
 * missed readiness signal previously left production installs on "Opening
 * Inkbound" forever even though MainActivity, Firebase, Capacitor and the WebView
 * were already alive.
 *
 * Protected/cloud bridges still get a short head start so App Check can finish
 * wiring normally. If the readiness signal is delayed or lost, fail open after a
 * bounded delay and let the bridges use their own error/retry behavior. The main
 * UI, local library and sign-in surface are never blocked by this adapter state.
 */
const NativeServicesGate = ({ children }: PropsWithChildren) => {
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
  const [failOpen, setFailOpen] = useState(false);

  useEffect(() => {
    if (!isAndroidRuntime() || ready || error) {
      setFailOpen(false);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      console.warn('Inkbound Android native-service readiness was delayed; continuing startup and allowing normal cloud retry behavior.');
      setFailOpen(true);
    }, NATIVE_SERVICES_FAIL_OPEN_MS);

    return () => window.clearTimeout(timer);
  }, [ready, error]);

  if (!isAndroidRuntime() || ready || error || failOpen) return <>{children}</>;
  return null;
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
 * Native Android does not use this browser IndexedDB startup path.
 */
const BrowserStorageHydrationGate = ({ children }: PropsWithChildren) => {
  const nativeRuntime = isNativeRuntime();
  const [ready, setReady] = useState(
    () => nativeRuntime || isLargeBrowserStorageHydrated(),
  );

  useEffect(() => {
    if (nativeRuntime) {
      setReady(true);
      return undefined;
    }

    const handleHydrated = () => setReady(true);
    window.addEventListener(LARGE_BROWSER_STORAGE_HYDRATED_EVENT, handleHydrated);

    if (isLargeBrowserStorageHydrated()) setReady(true);

    return () => window.removeEventListener(LARGE_BROWSER_STORAGE_HYDRATED_EVENT, handleHydrated);
  }, [nativeRuntime]);

  return ready ? <>{children}</> : null;
};

const InkboundApplication = () => (
  <BreakpointProvider>
    <UserPlanProvider>
      <AccountSyncProvider>
        <AuthSessionGate>
          <NativeServicesGate>
            <SecurityBootstrap />
            <BrowserStorageHydrationGate>
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
            </BrowserStorageHydrationGate>
          </NativeServicesGate>
          <ThemePersistenceBridge />
          <CloudDataRefreshBoundary>
            <RecoverySafetyBridge />
            <App />
          </CloudDataRefreshBoundary>
          <UpgradeModal />
        </AuthSessionGate>
      </AccountSyncProvider>
    </UserPlanProvider>
  </BreakpointProvider>
);

export async function mountApplication(rootElement: HTMLElement) {
  if (!isNativeRuntime()) prepareLargeBrowserStorageForStartup();

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
    void initializeAndroidRuntime().catch((error) => {
      console.error('Inkbound Android native services could not initialize. Continuing with local UI and normal retry behavior.', error);
      markNativeRuntimeFailed(error);
    });
  }

  createRoot(rootElement).render(
    <StrictMode>
      <AppErrorBoundary>
        <InkboundApplication />
      </AppErrorBoundary>
    </StrictMode>,
  );

  if (!isNativeRuntime()) {
    window.setTimeout(() => {
      void hydrateLargeBrowserStorage().finally(() => {
        void hydrateDeferredLargeBrowserStorage();
      });
    }, 0);
  }
}
