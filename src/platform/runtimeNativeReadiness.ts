import { isNativeRuntime } from './runtimePlatform';

let nativeRuntimeReady = !isNativeRuntime();
const listeners = new Set<() => void>();

export function isNativeRuntimeReady(): boolean {
  return nativeRuntimeReady;
}

/**
 * Android calls this only after its required native adapters (at minimum App
 * Check and authentication plumbing) have been configured. Protected Firebase
 * effects stay gated until then so startup cannot race Play Integrity setup.
 */
export function markNativeRuntimeReady() {
  if (nativeRuntimeReady) return;
  nativeRuntimeReady = true;
  listeners.forEach((listener) => listener());
}

export function subscribeNativeRuntimeReadiness(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
