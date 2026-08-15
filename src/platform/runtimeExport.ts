export interface RuntimeTextExport {
  filename: string;
  mimeType: string;
  contents: string;
}

export interface RuntimeBinaryExport {
  filename: string;
  mimeType: string;
  contents: Blob;
}

export interface RuntimeShareExport extends RuntimeBinaryExport {
  title?: string;
  text?: string;
}

export interface RuntimeExportAdapter {
  exportTextFile(file: RuntimeTextExport): Promise<void> | void;
  exportBinaryFile(file: RuntimeBinaryExport): Promise<void> | void;
  shareBinaryFile(file: RuntimeShareExport): Promise<'shared' | 'saved'>;
}

const downloadBrowserBlob = (blob: Blob, filename: string) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
};

const browserExportAdapter: RuntimeExportAdapter = {
  exportTextFile: ({ filename, mimeType, contents }) => {
    downloadBrowserBlob(new Blob([contents], { type: mimeType }), filename);
  },
  exportBinaryFile: ({ filename, contents }) => {
    downloadBrowserBlob(contents, filename);
  },
  shareBinaryFile: async ({ filename, mimeType, contents, title, text }) => {
    if (typeof navigator !== 'undefined' && typeof File !== 'undefined') {
      const file = new File([contents], filename, { type: mimeType });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title, text });
        return 'shared';
      }
    }
    downloadBrowserBlob(contents, filename);
    return 'saved';
  },
};

let activeExportAdapter: RuntimeExportAdapter = browserExportAdapter;

/**
 * Platform boundary for exporting or sharing user-owned Inkbound data and media.
 * Web downloads files / uses Web Share where supported. Native shells can install
 * an adapter backed by the system share sheet and Files/document APIs without
 * changing feature code.
 */
export function configureRuntimeExport(adapter: RuntimeExportAdapter) {
  activeExportAdapter = adapter;
}

export async function exportRuntimeTextFile(file: RuntimeTextExport): Promise<void> {
  await activeExportAdapter.exportTextFile(file);
}

export async function exportRuntimeBinaryFile(file: RuntimeBinaryExport): Promise<void> {
  await activeExportAdapter.exportBinaryFile(file);
}

export function shareRuntimeBinaryFile(file: RuntimeShareExport): Promise<'shared' | 'saved'> {
  return activeExportAdapter.shareBinaryFile(file);
}
