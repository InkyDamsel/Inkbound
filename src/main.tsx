import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { UpgradeModal } from './components/UpgradeModal.tsx';
import { AccountSyncProvider } from './context/AccountSyncContext.tsx';
import { UserPlanProvider } from './context/UserPlanContext.tsx';
import { BreakpointProvider } from './layout/responsive/BreakpointProvider.tsx';
import { SecurityBootstrap } from './security/SecurityBootstrap.tsx';
import './index.css';
import './styles/app-shell.css';
import './styles/responsive-navigation.css';
import './styles/theme-modes.css';
import './styles/core-pages.css';
import './styles/release-polish.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BreakpointProvider>
      <UserPlanProvider>
        <AccountSyncProvider>
          <SecurityBootstrap />
          <App />
          <UpgradeModal />
        </AccountSyncProvider>
      </UserPlanProvider>
    </BreakpointProvider>
  </StrictMode>,
);
