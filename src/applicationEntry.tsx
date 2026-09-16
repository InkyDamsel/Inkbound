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
const BACKGROUND_START_DELAY_MS = 1200;

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

/**
 * Android native security protects cloud operations, not first paint. A Play
 * Integrity/App Check delay must never strand the reader on "Opening Inkbound".
 * When native services are unavailable we simply withhold protected background
 * bridges; the local UI remains usable and the services can recover later.
 */
const NativeBackgroundServicesGate = ({ children }: PropsWithChildren) => {
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

  if (!isAndroidRuntime()) return <>{children}</>;
  if (error) {
    console.warn('[Inkbound startup] Android secure background services are unavailable; opening local UI.', error);
    return null;
  }
  return ready ? <>{children}</> : null;
};

/**
 * Large accounts can contain tens of thousands of books. Sync reconciliation,
 * migrations, ledgers, and normalization are background work and must not all
 * compete with React's first useful paint. Give the shell a full frame plus a
 * short grace period before mounting those bridges.
 */
const DeferredBackgroundBridges = () => {
  const [start, setStart] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let idleId: number | undefined;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const requestIdle = window.requestIdleCallback;
      if (typeof requestIdle === 'function') {
        idleId = requestIdle(() => {
          if (!cancelled) setStart(true);
        }, { timeout: 1200 });
      } else {
        setStart(true);
      }
    }, BACKGROUND_START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleId !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
    };
  }, []);

  if (!start) return null;

  return (
    <NativeBackgroundServicesGate>
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
    </NativeBackgroundServicesGate>
  );
};

const InkboundApplication = () => (
  <BreakpointProvider>
    <UserPlanProvider>
      <AccountSyncProvider>
        <AuthSessionGate>
          <DeferredBackgroundBridges />
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
    void initializeAndroidRuntime().catch(markNativeRuntimeFailed);
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
