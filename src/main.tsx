import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { UserPlanProvider } from './context/UserPlanContext.tsx';
import { BreakpointProvider } from './layout/responsive/BreakpointProvider.tsx';
import './index.css';
import './styles/app-shell.css';
import './styles/responsive-navigation.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BreakpointProvider>
      <UserPlanProvider>
        <App />
      </UserPlanProvider>
    </BreakpointProvider>
  </StrictMode>,
);
