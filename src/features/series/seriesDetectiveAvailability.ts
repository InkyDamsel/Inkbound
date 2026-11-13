import { isNativeRuntime } from '../../platform/runtimePlatform';

/**
 * Series Detective is a web-only preview until Android and iOS release
 * validation is explicitly approved. Normal Series library features remain
 * available on every platform.
 *
 * Use the shared runtime boundary (including build-target stamping) rather
 * than checking user-agent strings or hiding buttons with CSS.
 */
export const isSeriesDetectiveAvailable = (): boolean => !isNativeRuntime();
