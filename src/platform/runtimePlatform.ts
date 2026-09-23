type CapacitorRuntime = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

const viteEnv = ((import.meta as ImportMeta & {
  env?: Record<string, string | boolean | undefined>;
}).env ?? {});
const viteDev = viteEnv.DEV === true || viteEnv.DEV === 'true';
const buildRuntimeTarget =
  typeof viteEnv.VITE_RUNTIME_TARGET === 'string'
    ? viteEnv.VITE_RUNTIME_TARGET
    : undefined;

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
  // Vite's development server is always a browser runtime. This hard boundary
  // prevents stale native build stamps or Capacitor globals from trapping
  // localhost behind Android-only startup services.
  if (viteDev) return false;
  if (buildRuntimeTarget === 'android' || buildRuntimeTarget === 'ios') return true;
  return getCapacitorRuntime()?.isNativePlatform?.() === true;
}

export function getRuntimePlatform(): 'android' | 'ios' | 'web' | 'native' {
  if (viteDev) return 'web';
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
