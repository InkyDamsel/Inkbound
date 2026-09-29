import { registerPlugin } from '@capacitor/core';
import { isAndroidRuntime } from './runtimePlatform';

interface NativeBarcodeScannerPlugin {
  scan(): Promise<{ rawValue?: string; canceled?: boolean }>;
}

const NativeBarcodeScanner = registerPlugin<NativeBarcodeScannerPlugin>('InkboundBarcodeScanner');

export function shouldUseNativeBarcodeScanner(): boolean {
  return isAndroidRuntime();
}

export async function scanBarcodeWithNativeAndroid(): Promise<string | null> {
  if (!isAndroidRuntime()) return null;
  const result = await NativeBarcodeScanner.scan();
  if (result.canceled) return null;
  const raw = result.rawValue?.trim() ?? '';
  return raw || null;
}
