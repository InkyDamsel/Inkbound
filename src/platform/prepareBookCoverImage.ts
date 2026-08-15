const MAX_COVER_DATA_LENGTH = 120_000;
const INITIAL_MAX_WIDTH = 600;
const INITIAL_MAX_HEIGHT = 900;

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

/**
 * Prepares user-selected cover art before it enters canonical book state.
 *
 * IMPORTANT: manual book covers are still temporarily represented inside the
 * edition record so older clients remain compatible. Keep this payload tightly
 * bounded until the dedicated book-cover Storage migration is completed.
 * Phone camera originals must never enter book/Firestore state directly.
 */
export async function prepareBookCoverImage(file: File): Promise<string> {
  const decoded = await decodeImage(file);

  try {
    let maximumWidth = INITIAL_MAX_WIDTH;
    let maximumHeight = INITIAL_MAX_HEIGHT;
    let quality = 0.72;
    let bestResult = '';

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
      const result = canvas.toDataURL('image/jpeg', quality);
      bestResult = result;
      if (result.length <= MAX_COVER_DATA_LENGTH) return result;

      maximumWidth = Math.round(maximumWidth * 0.82);
      maximumHeight = Math.round(maximumHeight * 0.82);
      quality = Math.max(0.40, quality - 0.07);
    }

    if (bestResult.length > MAX_COVER_DATA_LENGTH) {
      throw new Error('That cover image is still too large after optimization. Try a smaller image.');
    }
    return bestResult;
  } finally {
    decoded.release();
  }
}
