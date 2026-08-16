import { initializeNativeFirebaseAppCheck } from '../lib/firebase';
import {
  type NativeAppCheckAdapter,
  configureNativeAppCheck,
} from './runtimeNativeAppCheck';
import { markNativeRuntimeReady } from './runtimeNativeReadiness';
import { isNativeRuntime } from './runtimePlatform';

/**
 * Single startup sequence for Android security services.
 *
 * The native Capacitor adapter should obtain/configure Play Integrity first and
 * pass its token adapter here. Only after Firebase's JS App Check instance is
 * bound to that adapter do we release the providers that make protected calls.
 */
export function initializeNativeSecurityRuntime(appCheckAdapter: NativeAppCheckAdapter) {
  if (!isNativeRuntime()) return;
  configureNativeAppCheck(appCheckAdapter);
  const appCheck = initializeNativeFirebaseAppCheck();
  if (!appCheck) {
    throw new Error('Inkbound could not initialize Android Firebase App Check.');
  }
  markNativeRuntimeReady();
}
