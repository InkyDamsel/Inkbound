import { PropsWithChildren, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { UpgradeModal } from './components/UpgradeModal.tsx';
import { AccountSyncProvider, useAccountSync } from './context/AccountSyncContext.tsx';
import { UserPlanProvider } from './context/UserPlanContext.tsx';
import { CloudDataRefreshBoundary } from './features/sync/CloudDataRefreshBoundary.tsx';
import { CloudPersistenceBridge } from './features/sync/CloudPersistenceBridge.tsx';
import { ThemePersistenceBridge } from './features/sync/ThemePersistenceBridge.tsx';
import { BreakpointProvider } from './layout/responsive/BreakpointProvider.tsx';
import { SecurityBootstrap } from './security/SecurityBootstrap.tsx';
import './index.css';
import './styles/app-shell.css';
import './styles/responsive-navigation.css';
import './styles/theme-modes.css';
import './styles/core-pages.css';
import './styles/release-polish.css';
import './styles/light-theme-2.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Inkbound could not find its application root.');
}

const AuthSessionGate = ({ children }: PropsWithChildren) => {
  const { isAuthReady } = useAccountSync();

  if (!isAuthReady) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--ink-page)] px-6 text-center">
        <div className="max-w-sm">
          <div className="mx-auto h-9 w-9 animate-pulse rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-soft)]" />
          <p className="mt-4 font-serif text-xl text-[var(--ink-ivory)]">Opening Inkbound</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Restoring your saved account and library securely...</p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
};

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <BreakpointProvider>
        <UserPlanProvider>
          <AccountSyncProvider>
            <AuthSessionGate>
              <SecurityBootstrap />
              <CloudPersistenceBridge />
              <ThemePersistenceBridge />
              <CloudDataRefreshBoundary>
                <App />
              </CloudDataRefreshBoundary>
              <UpgradeModal />
            </AuthSessionGate>
          </AccountSyncProvider>
        </UserPlanProvider>
      </BreakpointProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
