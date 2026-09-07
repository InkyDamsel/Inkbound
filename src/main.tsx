import { PropsWithChildren, StrictMode, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { FaqPage } from './components/FaqPage.tsx';
import { PublicWebsite } from './components/PublicWebsite.tsx';
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

const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
const publicSurface = !isNativeRuntime()
  ? normalizedPath === '/'
    ? 'marketing'
    : normalizedPath === '/faq'
      ? 'faq'
      : null
  : null;
const isPublicSurface = publicSurface !== null;
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

    const timer = window.setTimeout(() => setGraceElapsed(true), AUTH_OPEN_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [isAuthReady]);

  if (!isAuthReady && !graceElapsed) {
    return <OpeningScreen message="Restoring your saved account…" />;
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
            <CanonicalLibraryNormalizationBridge />
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

const PublicSurface = () => {
  if (publicSurface === 'faq') return <FaqPage />;
  return <PublicWebsite />;
};

async function bootstrap() {
  if (!isPublicSurface && !isNativeRuntime()) {
    prepareLargeBrowserStorageForStartup();
  }

  if (!isPublicSurface) {
    isolateDevelopmentBrowserStorage();
    purgeUnverifiedLegacyImportMetadata();
  }

  if (!isPublicSurface && !isNativeRuntime()) {
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
        {isPublicSurface ? <PublicSurface /> : <InkboundApplication />}
      </AppErrorBoundary>
    </StrictMode>,
  );

  if (!isPublicSurface && !isNativeRuntime()) {
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
        <OpeningScreen
          message="Inkbound hit a startup problem. Reload to try again; your library data is safe."
          actionLabel="Reload Inkbound"
          onAction={() => window.location.reload()}
        />
      </AppErrorBoundary>
    </StrictMode>,
  );
});
