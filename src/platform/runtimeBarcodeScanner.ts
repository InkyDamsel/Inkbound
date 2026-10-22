import { registerPlugin } from '@capacitor/core';
import { isAndroidRuntime, isIOSRuntime } from './runtimePlatform';

interface NativeBarcodeScannerPlugin {
  scan(): Promise<{ rawValue?: string; canceled?: boolean }>;
  recognizeCover(options: { image: string }): Promise<{ lines: string[] }>;
  confirmSuccess(): Promise<void>;
  getBuildInfo(): Promise<{ debug?: boolean }>;
}

const NativeBarcodeScanner = registerPlugin<NativeBarcodeScannerPlugin>('InkboundBarcodeScanner');

export async function isNativeDebugBuild(): Promise<boolean> {
  if (!shouldUseNativeBarcodeScanner()) return false;
  const result = await NativeBarcodeScanner.getBuildInfo();
  return result.debug === true;
}

export async function recognizeBookCover(image: string): Promise<string[]> {
  if (!shouldUseNativeBarcodeScanner()) {
    throw new Error('Cover text recognition requires the native iOS or Android app.');
  }
  const result = await NativeBarcodeScanner.recognizeCover({ image });
  return result.lines.filter((line) => typeof line === 'string' && line.trim().length > 1);
}

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

export async function playScannerSuccessFeedbackOnNativeAndroid(): Promise<boolean> {
  if (!shouldUseNativeBarcodeScanner()) return false;
  await NativeBarcodeScanner.confirmSuccess();
  return true;
}

export async function confirmNativeBarcodeScanSuccess(): Promise<void> {
  if (!isAndroidRuntime()) return;
  await NativeBarcodeScanner.confirmSuccess();
}

// Backward-compatible alias while older call sites migrate.
export const scanBarcodeWithNativeAndroid = scanBarcodeWithNativeRuntime;
