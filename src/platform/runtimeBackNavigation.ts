export interface RuntimeBackNavigationAdapter {
  subscribe(listener: () => void): () => void;
}

const browserBackNavigationAdapter: RuntimeBackNavigationAdapter = {
  subscribe: () => () => undefined,
};

let activeBackNavigationAdapter: RuntimeBackNavigationAdapter = browserBackNavigationAdapter;

/**
 * Platform boundary for native system-back navigation.
 *
 * Feature code subscribes here instead of importing Capacitor directly so web
 * remains a no-op and native shells can provide platform-appropriate behavior.
 */
export function configureRuntimeBackNavigation(adapter: RuntimeBackNavigationAdapter) {
  activeBackNavigationAdapter = adapter;
}

export function subscribeToRuntimeBackNavigation(listener: () => void): () => void {
  return activeBackNavigationAdapter.subscribe(listener);
}
