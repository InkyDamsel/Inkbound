export interface RuntimeAppControlAdapter {
  restartApp(): Promise<void> | void;
}

const browserAppControlAdapter: RuntimeAppControlAdapter = {
  restartApp: () => {
    if (typeof window === 'undefined') return;
    window.location.reload();
  },
};

let activeAppControlAdapter: RuntimeAppControlAdapter = browserAppControlAdapter;

/**
 * Platform boundary for restarting Inkbound after an unrecoverable UI failure.
 *
 * Web reloads the document. Native shells can install an adapter that reloads
 * their WebView/root activity without exposing browser semantics to features.
 */
export function configureRuntimeAppControl(adapter: RuntimeAppControlAdapter) {
  activeAppControlAdapter = adapter;
}

export async function restartRuntimeApp(): Promise<void> {
  await activeAppControlAdapter.restartApp();
}
