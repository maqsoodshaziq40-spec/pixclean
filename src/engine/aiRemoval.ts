import {
  preload as imglyPreload,
  removeBackground as imglyRemoveBackground,
  type Config as ImglyConfig,
} from '@imgly/background-removal';
import type { ProcessingProgress } from '../types/studio';

/**
 * Official @imgly/background-removal CDN (Cloudflare, CORS Access-Control-Allow-Origin: *).
 * 100% client-side in the browser — zero backend, zero /api calls, Netlify static hosting ready.
 */
const IMGLY_CDN_PUBLIC_PATH =
  'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/';

/**
 * Shared base config passed to both preload() and removeBackground() so @imgly's internal
 * JSON.stringify(config) memoization reuses the exact same ONNX session across runs.
 */
const BASE_IMGLY_CONFIG: Omit<ImglyConfig, 'progress'> = {
  publicPath: IMGLY_CDN_PUBLIC_PATH,
  model: 'isnet_quint8',
  device: 'cpu',
  output: {
    format: 'image/png',
    quality: 1,
  },
};

export interface BgRemovalResult {
  alphaMask: Uint8Array;
  engine: 'imgly-cdn';
}

let preloadPromise: Promise<void> | null = null;

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not prepare photo for background removal'));
      },
      'image/png'
    );
  });
}

async function extractAlphaFromPngBlob(
  pngBlob: Blob,
  targetWidth: number,
  targetHeight: number
): Promise<Uint8Array> {
  const outCanvas = document.createElement('canvas');
  outCanvas.width = targetWidth;
  outCanvas.height = targetHeight;
  const ctx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('2D Canvas context unavailable');
  }

  let bitmap: ImageBitmap | null = null;
  let objectUrl: string | null = null;

  try {
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(pngBlob);
      } catch {
        bitmap = null;
      }
    }

    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (bitmap) {
      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    } else {
      objectUrl = URL.createObjectURL(pngBlob);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not read cutout PNG result'));
        el.src = objectUrl!;
      });
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    }

    const { data } = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const alphaMask = new Uint8Array(targetWidth * targetHeight);
    for (let i = 0, p = 3; i < alphaMask.length; i++, p += 4) {
      alphaMask[i] = data[p];
    }
    return alphaMask;
  } finally {
    if (bitmap) bitmap.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Warms up @imgly/background-removal model & WASM assets from CDN in the browser.
 * Safe to call multiple times; deduplicated via preloadPromise.
 */
export function preloadBackgroundModel(): void {
  if (preloadPromise) return;
  preloadPromise = imglyPreload({ ...BASE_IMGLY_CONFIG }).catch(() => {
    preloadPromise = null;
  });
}

/**
 * No-op startup hook retained for compatibility; @imgly leverages the browser's HTTP cache
 * and internal session memoization automatically without hitting any backend API.
 */
export async function preloadCachedModelIfAvailable(): Promise<void> {
  // Intentionally empty on initial page load so no unnecessary CDN bytes are fetched
  // until the user actually uploads or opens a photo.
}

/**
 * Runs 100% client-side AI background removal directly in the browser using
 * @imgly/background-removal loaded from CDN. Zero server / API / Netlify Function calls.
 */
export async function runOnnxBackgroundRemoval(
  sourceCanvas: HTMLCanvasElement,
  onProgress?: (progress: ProcessingProgress) => void
): Promise<BgRemovalResult> {
  const targetWidth = sourceCanvas.width;
  const targetHeight = sourceCanvas.height;

  onProgress?.({
    stage: 'Preparing your photo...',
    percent: null,
  });

  const inputBlob = await canvasToPngBlob(sourceCanvas);

  const config: ImglyConfig = {
    ...BASE_IMGLY_CONFIG,
    progress: (key: string, current: number, total: number) => {
      if (!onProgress) return;

      if (key.startsWith('fetch:')) {
        if (total > 0) {
          const pct = Math.min(99, Math.max(0, Math.round((current / total) * 100)));
          const isModel = key.includes('/models/');
          onProgress({
            stage: isModel ? 'Downloading AI model (cached for next time)...' : 'Loading browser engine...',
            percent: pct,
            detail: `${formatMb(current)} / ${formatMb(total)}`,
          });
        } else {
          onProgress({
            stage: 'Loading AI model from CDN...',
            percent: null,
          });
        }
        return;
      }

      if (key === 'compute:inference') {
        onProgress({
          stage: 'Removing background in browser...',
          percent: null,
        });
      } else if (key === 'compute:mask' || key === 'compute:encode') {
        onProgress({
          stage: 'Finishing transparent PNG...',
          percent: null,
        });
      } else {
        onProgress({
          stage: 'Working on it, give me a second...',
          percent: null,
        });
      }
    },
  };

  const resultPngBlob = await imglyRemoveBackground(inputBlob, config);
  const alphaMask = await extractAlphaFromPngBlob(resultPngBlob, targetWidth, targetHeight);

  return {
    alphaMask,
    engine: 'imgly-cdn',
  };
}
