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
 * After a short grace period, release the UI so Inkbound can still open while
 * protected background bridges remain withheld until native services recover.
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
  return nativeRuntimeError;
}

/**
 * Android calls this after its required native adapters (at minimum App Check
 * and authentication plumbing) have been configured. A late success clears the
 * degraded-start diagnostic and allows protected background bridges to mount.
 */
export function markNativeRuntimeReady() {
  if (nativeRuntimeReady && !nativeRuntimeError) return;
  nativeRuntimeError = null;
  nativeRuntimeReady = true;
  notify();
}

/**
 * Native initialization failures are recoverable startup conditions. Record the
 * failure for diagnostics and release the application shell, but leave the error
 * visible so protected background work stays paused until a late success occurs.
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
