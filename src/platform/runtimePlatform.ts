type CapacitorRuntime = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function getCapacitorRuntime(): CapacitorRuntime | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorRuntime }).Capacitor;
}

/**
 * Single platform boundary for browser-versus-native behavior.
 *
 * Keep feature components unaware of Capacitor directly. Native Android adapters
 * should be installed through the platform modules while the browser remains a
 * supported development and fallback runtime.
 */
export function isNativeRuntime(): boolean {
  return getCapacitorRuntime()?.isNativePlatform?.() === true;
}

export function getRuntimePlatform(): 'android' | 'ios' | 'web' | 'native' {
  const capacitor = getCapacitorRuntime();
  if (capacitor?.isNativePlatform?.() !== true) return 'web';

  const platform = capacitor.getPlatform?.();
  if (platform === 'android' || platform === 'ios') return platform;
  return 'native';
}

export function isAndroidRuntime(): boolean {
  return getRuntimePlatform() === 'android';
}
