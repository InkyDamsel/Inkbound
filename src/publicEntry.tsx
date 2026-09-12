import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { FaqPage } from './components/FaqPage.tsx';
import { PublicWebsite } from './components/PublicWebsite.tsx';
import './styles/public-website.css';

export function mountPublicSurface(rootElement: HTMLElement, surface: 'marketing' | 'faq') {
  createRoot(rootElement).render(
    <StrictMode>
      <AppErrorBoundary>
        {surface === 'faq' ? <FaqPage /> : <PublicWebsite />}
      </AppErrorBoundary>
    </StrictMode>,
  );
}
