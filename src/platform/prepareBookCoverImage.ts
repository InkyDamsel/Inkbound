import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from '../lib/firebase';

const MAX_COVER_DATA_LENGTH = 120_000;
const INITIAL_MAX_WIDTH = 600;
const INITIAL_MAX_HEIGHT = 900;
const MAX_COVER_BLOB_BYTES = 420 * 1024;

async function decodeImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Inkbound could not read that cover image.'));
    image.src = objectUrl;
  });

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(objectUrl),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Inkbound could not prepare that cover image.')),
      'image/webp',
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Inkbound could not prepare that cover image.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function uploadSignedInCover(blob: Blob): Promise<string | null> {
  const user = auth?.currentUser;
  if (!user || !storage) return null;

  const fileName = `${crypto.randomUUID()}.webp`;
  const imageRef = ref(storage, `users/${user.uid}/book-covers/manual/${fileName}`);
  await uploadBytes(imageRef, blob, {
    contentType: 'image/webp',
    cacheControl: 'private,max-age=31536000,immutable',
  });
  return getDownloadURL(imageRef);
}

/**
 * Prepares user-selected cover art before it enters canonical book state.
 *
 * Signed-in readers store the binary in Firebase Storage and the canonical
 * Edition receives only the resulting URL. This keeps Firestore/library sync
 * lightweight on web, phone, and tablet. Signed-out local-only readers retain a
 * tightly bounded data URL so cover editing still works without an account.
 *
 * NOTE: Existing legacy data-URL covers remain readable and can be migrated by
 * the account-sync layer separately; new signed-in uploads no longer add more
 * embedded image payloads to canonical book records.
 */
export async function prepareBookCoverImage(file: File): Promise<string> {
  const decoded = await decodeImage(file);

  try {
    let maximumWidth = INITIAL_MAX_WIDTH;
    let maximumHeight = INITIAL_MAX_HEIGHT;
    let quality = 0.76;
    let bestBlob: Blob | null = null;

    for (let attempt = 0; attempt < 7; attempt += 1) {
      const scale = Math.min(1, maximumWidth / decoded.width, maximumHeight / decoded.height);
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing is unavailable on this device.');

      context.drawImage(decoded.source, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, quality);
      bestBlob = blob;
      if (blob.size <= MAX_COVER_BLOB_BYTES) break;

      maximumWidth = Math.round(maximumWidth * 0.82);
      maximumHeight = Math.round(maximumHeight * 0.82);
      quality = Math.max(0.42, quality - 0.07);
    }

    if (!bestBlob || bestBlob.size > MAX_COVER_BLOB_BYTES) {
      throw new Error('That cover image is still too large after optimization. Try a smaller image.');
    }

    // Keep authenticated canonical records free of embedded binary payloads.
    // If Storage is configured for this signed-in account, an upload failure is
    // surfaced to the reader rather than silently falling back to base64.
    if (auth?.currentUser && storage) {
      try {
        const downloadUrl = await uploadSignedInCover(bestBlob);
        if (downloadUrl) return downloadUrl;
      } catch {
        throw new Error('Inkbound could not securely upload that cover. Check your connection and try again.');
      }
    }

    const localDataUrl = await blobToDataUrl(bestBlob);
    if (localDataUrl.length > MAX_COVER_DATA_LENGTH) {
      throw new Error('That cover image is still too large for local-only storage. Try a smaller image.');
    }
    return localDataUrl;
  } finally {
    decoded.release();
  }
}
