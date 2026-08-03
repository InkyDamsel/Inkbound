import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { UpgradeModal } from './components/UpgradeModal.tsx';
import { AccountSyncProvider } from './context/AccountSyncContext.tsx';
import { UserPlanProvider } from './context/UserPlanContext.tsx';
import { CloudDataRefreshBoundary } from './features/sync/CloudDataRefreshBoundary.tsx';
import { CloudPersistenceBridge } from './features/sync/CloudPersistenceBridge.tsx';
import { BreakpointProvider } from './layout/responsive/BreakpointProvider.tsx';
import { SecurityBootstrap } from './security/SecurityBootstrap.tsx';
import './index.css';
import './styles/app-shell.css';
import './styles/responsive-navigation.css';
import './styles/theme-modes.css';
import './styles/core-pages.css';
import './styles/release-polish.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Inkbound could not find its application root.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <BreakpointProvider>
        <UserPlanProvider>
          <AccountSyncProvider>
            <SecurityBootstrap />
            <CloudPersistenceBridge />
            <CloudDataRefreshBoundary>
              <App />
            </CloudDataRefreshBoundary>
            <UpgradeModal />
          </AccountSyncProvider>
        </UserPlanProvider>
      </BreakpointProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
