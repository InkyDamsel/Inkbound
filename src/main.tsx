import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { UserPlanProvider } from './context/UserPlanContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UserPlanProvider>
      <App />
    </UserPlanProvider>
  </StrictMode>,
);

