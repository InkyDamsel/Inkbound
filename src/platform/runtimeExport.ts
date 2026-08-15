export interface RuntimeTextExport {
  filename: string;
  mimeType: string;
  contents: string;
}

export interface RuntimeExportAdapter {
  exportTextFile(file: RuntimeTextExport): Promise<void> | void;
}

const browserExportAdapter: RuntimeExportAdapter = {
  exportTextFile: ({ filename, mimeType, contents }) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  },
};

let activeExportAdapter: RuntimeExportAdapter = browserExportAdapter;

/**
 * Platform boundary for exporting or sharing user-owned Inkbound data.
 *
 * Web downloads a file. Native shells can install an adapter backed by the
 * platform share sheet / Files document APIs without changing feature code.
 */
export function configureRuntimeExport(adapter: RuntimeExportAdapter) {
  activeExportAdapter = adapter;
}

export async function exportRuntimeTextFile(file: RuntimeTextExport): Promise<void> {
  await activeExportAdapter.exportTextFile(file);
}
