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

    let browserFailure = 'Browser request did not return an image.';
    try {
      const response = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
      if (response.ok) {
        const blob = await response.blob();
        if (blob.type.startsWith('image/')) return await blobToDataUrl(blob);
        browserFailure = 'Cover URL did not return image content.';
      } else browserFailure = `Cover host returned HTTP ${response.status}.`;
    } catch {
      browserFailure = 'Browser could not retrieve cover (possibly CORS or network).';
    }

    if (!functions || !auth?.currentUser) throw new Error(`${browserFailure} Signed-in image proxy unavailable.`);
    try {
      const proxy = httpsCallable<{ url: string }, { dataUrl?: string }>(functions, 'fetchShareImage');
      const response = await proxy({ url });
      if (typeof response.data.dataUrl === 'string' && response.data.dataUrl.startsWith('data:image/')) return response.data.dataUrl;
      throw new Error('Image proxy returned no usable image.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown proxy failure';
      throw new Error(`${browserFailure} Image proxy: ${reason}`);
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
