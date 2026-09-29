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
      const response = await fetch(url, { mode: 'cors' });
      return response.ok ? await blobToDataUrl(await response.blob()) : '';
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
