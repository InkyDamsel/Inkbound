import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';

export interface RuntimeMediaAdapter {
  fetchDataUrl(url: string): Promise<string>;
}

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'));
  reader.readAsDataURL(blob);
});

const browserMediaAdapter: RuntimeMediaAdapter = {
  fetchDataUrl: async (url) => {
    if (!url) return '';
    if (url.startsWith('data:')) return url;

    try {
      const response = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
      if (response.ok) return await blobToDataUrl(await response.blob());
    } catch {
      // Many catalog cover hosts permit <img> display but block browser CORS.
      // Signed-in exports can use the protected server proxy below.
    }

    if (!functions || !auth?.currentUser) return '';
    try {
      const proxy = httpsCallable<{ url: string }, { dataUrl?: string }>(functions, 'fetchShareImage');
      const response = await proxy({ url });
      return typeof response.data.dataUrl === 'string' ? response.data.dataUrl : '';
    } catch {
      return '';
    }
  },
};

let activeMediaAdapter: RuntimeMediaAdapter = browserMediaAdapter;

/**
 * Platform boundary for loading media that will be embedded into generated
 * Inkbound exports. Shared UI never needs to know whether the bytes came from
 * browser fetch or a native transport.
 */
export function configureRuntimeMedia(adapter: RuntimeMediaAdapter) {
  activeMediaAdapter = adapter;
}

export function fetchRuntimeMediaDataUrl(url: string): Promise<string> {
  return activeMediaAdapter.fetchDataUrl(url);
}
