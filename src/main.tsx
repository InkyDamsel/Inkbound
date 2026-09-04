import { PropsWithChildren, StrictMode, useSyncExternalStore } from 'react';
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
import { RecoverySafetyBridge } from './features/recovery/RecoverySafetyBridge.tsx';
import { AuxiliaryAccountSyncBridge } from './features/sync/AuxiliaryAccountSyncBridge.tsx';
import { CloudDataRefreshBoundary } from './features/sync/CloudDataRefreshBoundary.tsx';
import { CloudPersistenceBridge } from './features/sync/CloudPersistenceBridge.tsx';
import { CloudServerRefreshBridge } from './features/sync/CloudServerRefreshBridge.tsx';
import { LegacyBookCoverMigrationBridge } from './features/sync/LegacyBookCoverMigrationBridge.tsx';
import { ManualCoverLedgerBridge } from './features/sync/ManualCoverLedgerBridge.tsx';
import { ProtectedBookDetailsLedgerBridge } from './features/sync/ProtectedBookDetailsLedgerBridge.tsx';
import { ReadOnlyCloudHydrationBridge } from './features/sync/ReadOnlyCloudHydrationBridge.tsx';
import { isolateDevelopmentBrowserStorage } from './features/sync/runtimeStorageIsolation.ts';
import { ThemePersistenceBridge } from './features/sync/ThemePersistenceBridge.tsx';
import { BreakpointProvider } from './layout/responsive/BreakpointProvider.tsx';
import { hydrateLargeBrowserStorage } from './platform/largeBrowserStorage.ts';
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

  if (!isAuthReady) {
    return <OpeningScreen message="Restoring your saved account and library securely..." />;
  }

  return <>{children}</>;
};

const InkboundApplication = () => (
  <BreakpointProvider>
    <NativeRuntimeGate>
      <UserPlanProvider>
        <AccountSyncProvider>
          <AuthSessionGate>
            <SecurityBootstrap />
            <CloudPersistenceBridge />
            <CloudServerRefreshBridge />
            <ManualCoverLedgerBridge />
            <ProtectedBookDetailsLedgerBridge />
            <AuxiliaryAccountSyncBridge />
            <ReadOnlyCloudHydrationBridge />
            <PhotoMemoryAutoSyncBridge />
            <LegacyBookCoverMigrationBridge />
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
    // Load oversized account/library caches from IndexedDB before React or the
    // cloud bridge reads localStorage. The storage shim keeps existing feature
    // code synchronous while removing localStorage's practical size ceiling.
    await hydrateLargeBrowserStorage();
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

  createRoot(rootElement).render(
    <StrictMode>
      <AppErrorBoundary>
        {isPublicWebsite ? <PublicWebsite /> : <InkboundApplication />}
      </AppErrorBoundary>
    </StrictMode>,
  );

  if (import.meta.env.PROD && !isNativeRuntime() && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Offline/install support is an enhancement; a registration failure must
        // never prevent the reading journal itself from opening.
      });
    }, { once: true });
  }
}

void bootstrap().catch((error) => {
  console.error('Inkbound bootstrap failed.', error);
  createRoot(rootElement).render(
    <StrictMode>
      <AppErrorBoundary>
        <OpeningScreen message="Inkbound could not restore local storage. Refresh once to retry." />
      </AppErrorBoundary>
    </StrictMode>,
  );
});
