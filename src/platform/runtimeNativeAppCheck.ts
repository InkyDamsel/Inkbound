export interface NativeAppCheckToken {
  token: string;
  expireTimeMillis: number;
}

export interface NativeAppCheckAdapter {
  getToken(forceRefresh?: boolean): Promise<NativeAppCheckToken>;
}

let activeNativeAppCheckAdapter: NativeAppCheckAdapter | null = null;

/**
 * Installs the Android Play Integrity token source used by Firebase's JS App
 * Check instance. The Firebase JS SDK remains the only client used by Inkbound
 * Functions/Firestore/Storage; native code supplies only the attestation token.
 */
export function configureNativeAppCheck(adapter: NativeAppCheckAdapter) {
  activeNativeAppCheckAdapter = adapter;
}

export async function getNativeAppCheckToken(forceRefresh = false): Promise<NativeAppCheckToken> {
  if (!activeNativeAppCheckAdapter) {
    throw new Error(
      'Android Play Integrity App Check is not initialized yet. Protected Firebase requests are unavailable until the native App Check adapter is ready.',
    );
  }

  const result = await activeNativeAppCheckAdapter.getToken(forceRefresh);
  if (!result.token || !Number.isFinite(result.expireTimeMillis) || result.expireTimeMillis <= Date.now()) {
    throw new Error('Android App Check returned an invalid or expired token.');
  }
  return result;
}
