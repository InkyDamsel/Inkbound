import { isNativeRuntime } from './platform/runtimePlatform.ts';
import './index.css';

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

async function bootstrap() {
  if (publicSurface) {
    const { mountPublicSurface } = await import('./publicEntry.tsx');
    mountPublicSurface(rootElement, publicSurface);
    return;
  }

  const { mountApplication } = await import('./applicationEntry.tsx');
  await mountApplication(rootElement);
}

void bootstrap().catch((error) => {
  console.error('Inkbound bootstrap failed.', error);
  rootElement.innerHTML = `
    <main style="min-height:100dvh;display:grid;place-items:center;padding:24px;background:#0b090d;color:#f6edf0;text-align:center;font-family:system-ui,sans-serif">
      <div style="max-width:420px">
        <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:500;margin:0 0 12px">Inkbound could not open</h1>
        <p style="margin:0 0 20px;color:#c6aebb;line-height:1.6">Reload to try again. Your saved library data is safe.</p>
        <button type="button" id="inkbound-bootstrap-reload" style="min-height:44px;padding:0 18px;border-radius:12px;border:1px solid #6a526d;background:#2a1c2d;color:#f6edf0;font-weight:700;cursor:pointer">Reload Inkbound</button>
      </div>
    </main>
  `;
  document.getElementById('inkbound-bootstrap-reload')?.addEventListener('click', () => window.location.reload());
});
