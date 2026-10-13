import { isNativeRuntime } from './runtimePlatform';

export const usesEmbeddedBookDetailsToolbar = (): boolean => isNativeRuntime();
