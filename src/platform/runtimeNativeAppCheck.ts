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


/**
 * Safe, coarse native attestation failure category for diagnostic screenshots.
 * Never include raw error messages, Firebase tokens or URLs in user reports.
 */
export function classifyNativeAppCheckFailure(error: unknown): string {
  if (!error) return 'no error';
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  const signal = `${code} ${message}`.toLowerCase();
  if (/not initialized|adapter.*not.*ready/.test(signal)) return 'not initialized';
  if (/403|permission.denied|attestation|integrity|invalid app/.test(signal)) return 'attestation / permission denied';
  if (/429|resource.exhausted|quota/.test(signal)) return 'rate limit / quota';
  if (/network|timeout|unavailable|connection|503/.test(signal)) return 'network / service unavailable';
  if (/invalid.*token|expired.*token/.test(signal)) return 'invalid or expired token';
  return 'unknown native failure';
}

/**
 * Scanner-facing capability probe. Shared UI can ask whether native App Check
 * is available without branching on platform identity.
 */
export async function diagnoseNativeAppCheckFailure(): Promise<unknown | null> {
  if (!activeNativeAppCheckAdapter) return null;
  try {
    // A forced refresh on every unrelated scanner miss can itself fail or
    // hit attestation limits even when a valid cached token exists. Probe the
    // same cached/auto-refreshed path used by actual Firebase requests.
    await getNativeAppCheckToken(false);
    return null;
  } catch (error) {
    return error;
  }
}
