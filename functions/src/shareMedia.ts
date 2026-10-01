import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';

const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';
const MAX_IMAGE_BYTES = 1_500_000;
const ALLOWED_HOST_SUFFIXES = [
  'googleusercontent.com',
  'googleapis.com',
  'books.google.com',
  'openlibrary.org',
  'hardcover.app',
  'penguinrandomhouse.com',
  'prh.com',
];

function requireAllowedImageUrl(value: unknown): URL {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'Image URL is required.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new HttpsError('invalid-argument', 'Image URL is invalid.');
  }
  if (parsed.protocol !== 'https:') {
    throw new HttpsError('invalid-argument', 'Only HTTPS image URLs are supported.');
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!allowed) {
    throw new HttpsError('permission-denied', 'This image host is not approved for Inkbound exports.');
  }
  return parsed;
}

export const fetchShareImage = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    timeoutSeconds: 20,
    memory: '256MiB',
  },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to export remote cover art.');
    const input = request.data as { url?: unknown } | undefined;
    const url = requireAllowedImageUrl(input?.url);

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'follow',
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
          'User-Agent': 'Inkbound/1.0 share-image-export',
        },
      });
    } catch {
      throw new HttpsError('unavailable', 'Inkbound could not retrieve this cover image.');
    }

    if (!response.ok) {
      throw new HttpsError('unavailable', `Cover image returned HTTP ${response.status}.`);
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new HttpsError('failed-precondition', 'The cover URL did not return an image.');
    }

    const length = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
      throw new HttpsError('resource-exhausted', 'This cover image is too large to export.');
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new HttpsError('resource-exhausted', 'This cover image is empty or too large to export.');
    }

    return {
      dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`,
    };
  },
);
