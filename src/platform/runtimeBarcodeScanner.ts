import { registerPlugin } from '@capacitor/core';
import { isAndroidRuntime, isIOSRuntime } from './runtimePlatform';

interface NativeBarcodeScannerPlugin {
  scan(): Promise<{ rawValue?: string; canceled?: boolean }>;
  confirmSuccess(): Promise<void>;
  recognizePhotoText(options: { base64: string }): Promise<{ text: string }>;
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

/** OCR stays on-device; only recognized ISBNs enter the existing catalog lookup. */
export async function recognizeBookPhotoText(base64: string): Promise<string | null> {
  if (!shouldUseNativeBarcodeScanner()) return null;
  const result = await NativeBarcodeScanner.recognizePhotoText({ base64 });
  return result.text ?? '';
}
