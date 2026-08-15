export interface RuntimeLifecycleAdapter {
  subscribeToResume(listener: () => void): () => void;
}

const browserLifecycleAdapter: RuntimeLifecycleAdapter = {
  subscribeToResume: (listener) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') listener();
    };
    const handlePageShow = () => listener();
    const handleOnline = () => listener();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('online', handleOnline);
    };
  },
};

let activeLifecycleAdapter: RuntimeLifecycleAdapter = browserLifecycleAdapter;

/**
 * Platform boundary for foreground/resume behavior.
 *
 * Native shells can replace this with AppState/Capacitor lifecycle events while
 * feature code continues to react to a single Inkbound resume signal.
 */
export function configureRuntimeLifecycle(adapter: RuntimeLifecycleAdapter) {
  activeLifecycleAdapter = adapter;
}

export function subscribeToRuntimeResume(listener: () => void): () => void {
  return activeLifecycleAdapter.subscribeToResume(listener);
}
