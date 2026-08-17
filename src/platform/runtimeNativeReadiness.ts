import { isNativeRuntime } from './runtimePlatform';

let nativeRuntimeReady = !isNativeRuntime();
let nativeRuntimeError: string | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

export function isNativeRuntimeReady(): boolean {
  return nativeRuntimeReady;
}

export function getNativeRuntimeError(): string | null {
  return nativeRuntimeError;
}

/**
 * Android calls this only after its required native adapters (at minimum App
 * Check and authentication plumbing) have been configured. Protected Firebase
 * effects stay gated until then so startup cannot race Play Integrity setup.
 */
export function markNativeRuntimeReady() {
  if (nativeRuntimeReady && !nativeRuntimeError) return;
  nativeRuntimeError = null;
  nativeRuntimeReady = true;
  notify();
}

/**
 * Native initialization failures are surfaced through the same startup gate
 * instead of leaving Inkbound on an endless loading screen. Do not mark the
 * runtime ready after a failure: protected Firebase providers must stay gated.
 */
export function markNativeRuntimeFailed(error: unknown) {
  nativeRuntimeReady = false;
  nativeRuntimeError = error instanceof Error ? error.message : 'Android services could not be initialized.';
  notify();
}

export function subscribeNativeRuntimeReadiness(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
