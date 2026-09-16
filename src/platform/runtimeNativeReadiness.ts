import { isNativeRuntime } from './runtimePlatform';

const NATIVE_RUNTIME_FAIL_OPEN_MS = 5000;

let nativeRuntimeReady = !isNativeRuntime();
let nativeRuntimeError: string | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

/**
 * Native security services protect sync and other Firebase-backed work, but they
 * must never own the entire application launch. Google Play review devices and
 * slow/partially available Play Services can delay App Check initialization.
 * After a short grace period, release the UI so Inkbound can still open and let
 * individual protected features fail/retry normally instead of leaving the app
 * stranded on "Opening Inkbound" forever.
 */
if (isNativeRuntime()) {
  window.setTimeout(() => {
    if (nativeRuntimeReady) return;
    markNativeRuntimeFailed(new Error('Android security services did not finish starting in time. Inkbound opened in degraded mode.'));
  }, NATIVE_RUNTIME_FAIL_OPEN_MS);
}

export function isNativeRuntimeReady(): boolean {
  return nativeRuntimeReady;
}

export function getNativeRuntimeError(): string | null {
  // Startup failures are diagnostic once the fail-open path has released the UI.
  // Do not convert a recoverable native-service problem into a full-app blocker.
  return nativeRuntimeReady ? null : nativeRuntimeError;
}

/**
 * Android calls this after its required native adapters (at minimum App Check
 * and authentication plumbing) have been configured. A late success also clears
 * any degraded-start diagnostic produced by the startup watchdog.
 */
export function markNativeRuntimeReady() {
  if (nativeRuntimeReady && !nativeRuntimeError) return;
  nativeRuntimeError = null;
  nativeRuntimeReady = true;
  notify();
}

/**
 * Native initialization failures are recoverable startup conditions. Record the
 * failure for diagnostics, but release the application shell instead of trapping
 * readers (or Google Play review devices) on an endless opening screen.
 */
export function markNativeRuntimeFailed(error: unknown) {
  nativeRuntimeError = error instanceof Error ? error.message : 'Android services could not be initialized.';
  console.error('Inkbound Android native runtime entered degraded startup mode.', error);
  nativeRuntimeReady = true;
  notify();
}

export function subscribeNativeRuntimeReadiness(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
