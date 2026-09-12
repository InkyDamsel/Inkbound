import { PropsWithChildren, StrictMode, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { PublicWebsite } from './components/PublicWebsite.tsx';
import { UpgradeModal } from './components/UpgradeModal.tsx';
import { AccountSyncProvider, useAccountSync } from './context/AccountSyncContext.tsx';
import { UserPlanProvider } from './context/UserPlanContext.tsx';
import { readImportEnrichmentRetryProgress } from './features/import/importHistory.ts';
import { purgeUnverifiedLegacyImportMetadata } from './features/import/purgeLegacyImportMetadata.ts';
import { PhotoMemoryAutoSyncBridge } from './features/memories/PhotoMemoryAutoSyncBridge.tsx';
import { ReadingMemoryCloudSyncBridge } from './features/memories/ReadingMemoryCloudSyncBridge.tsx';
import { RecoverySafetyBridge } from './features/recovery/RecoverySafetyBridge.tsx';
import { AdaptiveCloudPersistenceBridge } from './features/sync/AdaptiveCloudPersistenceBridge.tsx';
import { AuxiliaryAccountSyncBridge } from './features/sync/AuxiliaryAccountSyncBridge.tsx';
import { CloudDataRefreshBoundary } from './features/sync/CloudDataRefreshBoundary.tsx';
import { CloudServerRefreshBridge } from './features/sync/CloudServerRefreshBridge.tsx';
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
import './index.css';
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
import './styles/public-website.css';
// Keep this last: it protects intentionally dark artwork/hero surfaces from
// broad light-theme utility remapping and strengthens parchment-mode contrast.
import './styles/light-theme-contrast.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Inkbound could not find its application root.');
}

const isPublicWebsite = !isNativeRuntime() && window.location.pathname === '/';
const AUTH_OPEN_GRACE_MS = 1800;

const OpeningScreen = ({ message }: { message: string }) => (
  <main className="grid min-h-[100dvh] place-items-center bg-[var(--ink-page)] px-[max(1.5rem,env(safe-area-inset-left))] py-[max(1.5rem,env(safe-area-inset-top))] text-center">
    <div className="max-w-sm">
      <div className="mx-auto h-9 w-9 animate-pulse rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-soft)]" />
      <p className="mt-4 font-serif text-xl text-[var(--ink-ivory)]">Opening Inkbound</p>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">{message}</p>
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

  if (error) {
    return <OpeningScreen message={`Android services could not start: ${error}`} />;
  }

  if (!ready) {
    return <OpeningScreen message="Preparing secure Android services..." />;
  }

  return <>{children}</>;
};

const AuthSessionGate = ({ children }: PropsWithChildren) => {
  const { isAuthReady } = useAccountSync();
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    if (isAuthReady) {
      setGraceElapsed(false);
      return undefined;
    }

    // Firebase Auth can take an unexpectedly long time to restore a browser
    // session when IndexedDB, App Check, captive Wi-Fi, or an auth endpoint is
    // unavailable. Account restoration is useful, but it must never make the
    // web app itself inaccessible. After a short grace period, open Inkbound
    // and let auth/sync finish in the background.
    const timer = window.setTimeout(() => setGraceElapsed(true), AUTH_OPEN_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [isAuthReady]);

  if (!isAuthReady && !graceElapsed) {
    return <OpeningScreen message="Restoring your saved account…" />;
  }

  return <>{children}</>;
};

/**
 * Large browser libraries are restored from IndexedDB after first paint. The
 * storage bridge deliberately rejects writes to books/pending/baseline while
 * that restore is in progress so an empty first React render cannot erase a
 * reader's library. Cloud sync must obey the same boundary: if it starts early,
 * a valid server reconciliation is rejected by that protection and the older
 * IndexedDB cache can appear to "win" after reload.
 *
 * Keep the application UI available immediately, but do not mount persistence
 * bridges until the browser working copy is hydrated. Native Android does not
 * use this IndexedDB startup path and may sync immediately.
 */
const BrowserStorageHydrationGate = ({ children }: PropsWithChildren) => {
  const nativeRuntime = isNativeRuntime();
  const [ready, setReady] = useState(nativeRuntime);

  useEffect(() => {
    if (nativeRuntime) {
      setReady(true);
      return undefined;
    }

    const handleHydrated = () => setReady(true);
    window.addEventListener(LARGE_BROWSER_STORAGE_HYDRATED_EVENT, handleHydrated);
    return () => window.removeEventListener(LARGE_BROWSER_STORAGE_HYDRATED_EVENT, handleHydrated);
  }, [nativeRuntime]);

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
              <ManualCoverLedgerBridge />
              <ProtectedBookDetailsLedgerBridge />
              <AuxiliaryAccountSyncBridge />
              <ReadingMemoryCloudSyncBridge />
              <ReadOnlyCloudHydrationBridge />
              <PhotoMemoryAutoSyncBridge />
              <LegacyBookCoverMigrationBridge />
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

async function bootstrap() {
  if (!isPublicWebsite && !isNativeRuntime()) {
    // Install the storage compatibility layer synchronously, but do not touch
    // IndexedDB before first paint. This protects an existing large library from
    // early React writes while guaranteeing browser database work can never block
    // Inkbound from opening.
    prepareLargeBrowserStorageForStartup();
  }

  if (!isPublicWebsite) {
    isolateDevelopmentBrowserStorage();
    purgeUnverifiedLegacyImportMetadata();
  }

  if (!isPublicWebsite && !isNativeRuntime()) {
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

  // First paint comes before IndexedDB/library restoration. Returning users must
  // always get a usable application shell even if Safari/Chrome has a blocked or
  // unhealthy browser database. Hydration refreshes App's canonical books state
  // through the existing cloud-data event when it completes. Persistence bridges
  // now wait for that hydration boundary before comparing local and cloud state.
  createRoot(rootElement).render(
    <StrictMode>
      <AppErrorBoundary>
        {isPublicWebsite ? <PublicWebsite /> : <InkboundApplication />}
      </AppErrorBoundary>
    </StrictMode>,
  );

  if (!isPublicWebsite && !isNativeRuntime()) {
    window.setTimeout(() => {
      void hydrateLargeBrowserStorage().finally(() => {
        void hydrateDeferredLargeBrowserStorage();
      });
    }, 0);
  }
}

void bootstrap().catch((error) => {
  console.error('Inkbound bootstrap failed.', error);
  createRoot(rootElement).render(
    <StrictMode>
      <AppErrorBoundary>
        <OpeningScreen message="Inkbound hit a startup problem. Reload to try again; your library data is safe." />
      </AppErrorBoundary>
    </StrictMode>,
  );
});