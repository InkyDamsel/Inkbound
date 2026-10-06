import { registerPlugin } from '@capacitor/core';
import { isAndroidRuntime, isIOSRuntime } from './runtimePlatform';

interface NativeBarcodeScannerPlugin {
  scan(): Promise<{ rawValue?: string; canceled?: boolean }>;
}

const NativeBarcodeScanner = registerPlugin<NativeBarcodeScannerPlugin>('InkboundBarcodeScanner');

export function shouldUseNativeBarcodeScanner(): boolean {
  return isAndroidRuntime() || isIOSRuntime();
}

export async function scanBarcodeWithNativeRuntime(): Promise<string | null> {
  if (!shouldUseNativeBarcodeScanner()) return null;
  const result = await NativeBarcodeScanner.scan();
  if (result.canceled) return null;
  const raw = result.rawValue?.trim() ?? '';
  return raw || null;
}

// Backward-compatible alias while older call sites migrate.
export const scanBarcodeWithNativeAndroid = scanBarcodeWithNativeRuntime;
