type CapacitorRuntime = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

// Vite provides env in app bundles; Node-based regression runners do not.
const buildRuntimeTarget = import.meta.env?.VITE_RUNTIME_TARGET;

function getCapacitorRuntime(): CapacitorRuntime | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorRuntime }).Capacitor;
}

/**
 * Single platform boundary for browser-versus-native behavior.
 *
 * Android production bundles are stamped at build time so security-sensitive
 * modules fail closed from their first evaluation even before Capacitor's runtime
 * global is consulted. The runtime global remains the authority for normal web
 * development and future native shells that are not using the stamped build.
 */
export function isNativeRuntime(): boolean {
  if (buildRuntimeTarget === 'android' || buildRuntimeTarget === 'ios') return true;
  return getCapacitorRuntime()?.isNativePlatform?.() === true;
}

export function getRuntimePlatform(): 'android' | 'ios' | 'web' | 'native' {
  if (buildRuntimeTarget === 'android' || buildRuntimeTarget === 'ios') return buildRuntimeTarget;

  const capacitor = getCapacitorRuntime();
  if (capacitor?.isNativePlatform?.() !== true) return 'web';

  const platform = capacitor.getPlatform?.();
  if (platform === 'android' || platform === 'ios') return platform;
  return 'native';
}

export function isAndroidRuntime(): boolean {
  return getRuntimePlatform() === 'android';
}

export function isIOSRuntime(): boolean {
  return getRuntimePlatform() === 'ios';
}
