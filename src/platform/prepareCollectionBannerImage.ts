import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from '../lib/firebase';

const BANNER_WIDTH = 1200;
const BANNER_HEIGHT = 400;
const MAX_BANNER_BLOB_BYTES = 450 * 1024;
const MAX_LOCAL_DATA_LENGTH = 180_000;

interface BannerCropOptions {
  offsetX?: number;
  offsetY?: number;
  zoom?: number;
}

async function decodeImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Inkbound could not read that banner image.'));
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
      (blob) => blob ? resolve(blob) : reject(new Error('Inkbound could not prepare that banner image.')),
      'image/webp',
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Inkbound could not prepare that banner image.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function drawCrop(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: BannerCropOptions = {},
) {
  const targetAspect = BANNER_WIDTH / BANNER_HEIGHT;
  const sourceAspect = sourceWidth / sourceHeight;
  let baseWidth = sourceWidth;
  let baseHeight = sourceHeight;

  if (sourceAspect > targetAspect) {
    baseWidth = sourceHeight * targetAspect;
  } else if (sourceAspect < targetAspect) {
    baseHeight = sourceWidth / targetAspect;
  }

  const zoom = clamp(options.zoom ?? 1, 1, 2);
  const cropWidth = baseWidth / zoom;
  const cropHeight = baseHeight / zoom;
  const maxX = Math.max(0, sourceWidth - cropWidth);
  const maxY = Math.max(0, sourceHeight - cropHeight);
  const normalizedX = clamp(options.offsetX ?? 0, -1, 1);
  const normalizedY = clamp(options.offsetY ?? 0, -1, 1);
  const sx = maxX * ((normalizedX + 1) / 2);
  const sy = maxY * ((normalizedY + 1) / 2);

  context.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, BANNER_WIDTH, BANNER_HEIGHT);
}

/**
 * Converts a reader-selected image into Inkbound's fixed 3:1 collection
 * banner. Readers can position and zoom the crop before the final WebP is
 * generated. The optimized result is bounded before upload so collection
 * customization cannot create runaway Storage usage.
 */
export async function prepareCollectionBannerImage(
  file: File,
  collectionId: string,
  options: BannerCropOptions = {},
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file for the collection banner.');
  const decoded = await decodeImage(file);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = BANNER_WIDTH;
    canvas.height = BANNER_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable on this device.');
    drawCrop(context, decoded.source, decoded.width, decoded.height, options);

    let quality = 0.82;
    let bannerBlob = await canvasToBlob(canvas, quality);
    while (bannerBlob.size > MAX_BANNER_BLOB_BYTES && quality > 0.44) {
      quality -= 0.08;
      bannerBlob = await canvasToBlob(canvas, quality);
    }
    if (bannerBlob.size > MAX_BANNER_BLOB_BYTES) {
      throw new Error('That image is still too large after optimization. Try another image.');
    }

    const user = auth?.currentUser;
    if (user && storage) {
      const imageRef = ref(storage, `users/${user.uid}/collection-banners/${collectionId}/${crypto.randomUUID()}.webp`);
      try {
        await uploadBytes(imageRef, bannerBlob, {
          contentType: 'image/webp',
          cacheControl: 'private,max-age=31536000,immutable',
        });
        return await getDownloadURL(imageRef);
      } catch {
        throw new Error('Inkbound could not securely upload that banner. Check your connection and try again.');
      }
    }

    const dataUrl = await blobToDataUrl(bannerBlob);
    if (dataUrl.length > MAX_LOCAL_DATA_LENGTH) {
      throw new Error('That banner is too large for local-only storage. Sign in or try a simpler image.');
    }
    return dataUrl;
  } finally {
    decoded.release();
  }
}
