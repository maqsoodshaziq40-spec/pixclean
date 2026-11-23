import JSZip from 'jszip';
import {
  cloneEdits,
  createDefaultEdits,
  type ExportOptions,
  type ImageEditSettings,
  type MattingSettings,
  type StudioImageItem,
} from '../types/studio';
import { getBackdropCanvas } from './studioAssets';

export const MAX_WORKING_DIMENSION = 1024;

interface PipelineCache {
  maskKey: string;
  refinedMaskCanvas: HTMLCanvasElement;
  subjectKey: string;
  subjectCanvas: HTMLCanvasElement;
}

const pipelineCacheMap = new WeakMap<StudioImageItem, PipelineCache>();
const customBgImageCache = new Map<string, HTMLImageElement>();

export function preloadCustomBgImage(url: string): Promise<HTMLImageElement> {
  const existing = customBgImageCache.get(url);
  if (existing && existing.complete) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      customBgImageCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('Failed to load background image'));
    img.src = url;
  });
}

export function extractAlphaBytes(maskCanvas: HTMLCanvasElement): Uint8Array {
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return new Uint8Array(maskCanvas.width * maskCanvas.height).fill(255);
  const { data } = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  const alpha = new Uint8Array(maskCanvas.width * maskCanvas.height);
  for (let i = 0, p = 3; i < alpha.length; i++, p += 4) {
    alpha[i] = data[p];
  }
  return alpha;
}

export function writeAlphaBytes(maskCanvas: HTMLCanvasElement, alpha: Uint8Array): void {
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const imgData = ctx.createImageData(maskCanvas.width, maskCanvas.height);
  const d = imgData.data;
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    d[p] = 255;
    d[p + 1] = 255;
    d[p + 2] = 255;
    d[p + 3] = alpha[i];
  }
  ctx.putImageData(imgData, 0, 0);
}

export function createThumbnailDataUrl(canvas: HTMLCanvasElement, maxSize = 144): string {
  const scale = Math.min(1, maxSize / Math.max(canvas.width, canvas.height));
  const tw = Math.max(1, Math.round(canvas.width * scale));
  const th = Math.max(1, Math.round(canvas.height * scale));
  const thumb = document.createElement('canvas');
  thumb.width = tw;
  thumb.height = th;
  const ctx = thumb.getContext('2d');
  if (ctx) {
    ctx.drawImage(canvas, 0, 0, tw, th);
  }
  return thumb.toDataURL('image/png');
}

export async function loadBlobToStudioItem(
  blob: Blob,
  name: string,
  originalFileSize?: number
): Promise<StudioImageItem> {
  let bitmap: ImageBitmap | null = null;
  let fallbackUrl: string | null = null;
  let fallbackImg: HTMLImageElement | null = null;

  try {
    let natW = 0;
    let natH = 0;

    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(blob);
        natW = bitmap.width;
        natH = bitmap.height;
      } catch {
        bitmap = null;
      }
    }

    if (!bitmap) {
      fallbackUrl = URL.createObjectURL(blob);
      fallbackImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`Could not decode image "${name}"`));
        el.src = fallbackUrl!;
      });
      natW = fallbackImg.naturalWidth || fallbackImg.width;
      natH = fallbackImg.naturalHeight || fallbackImg.height;
    }

    // Automatically downscale any uploaded image larger than 1024px BEFORE any BG removal or editing
    const scale = Math.min(1, MAX_WORKING_DIMENSION / Math.max(natW, natH));
    const width = Math.max(1, Math.round(natW * scale));
    const height = Math.max(1, Math.round(natH * scale));

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sCtx) throw new Error('2D Canvas context unavailable');
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';
    sCtx.drawImage(bitmap ?? fallbackImg!, 0, 0, width, height);

    if (bitmap) {
      bitmap.close();
      bitmap = null;
    }

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const mCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!mCtx) throw new Error('2D Canvas context unavailable');

    const srcData = sCtx.getImageData(0, 0, width, height).data;
    const initialAlpha = new Uint8Array(width * height);
    let hasTransparency = false;
    for (let i = 0, p = 3; i < initialAlpha.length; i++, p += 4) {
      initialAlpha[i] = srcData[p];
      if (srcData[p] < 250) hasTransparency = true;
    }
    writeAlphaBytes(maskCanvas, initialAlpha);

    const edits = createDefaultEdits(width, height);
    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return {
      id,
      name,
      originalFileSize: originalFileSize ?? blob.size,
      width,
      height,
      sourceCanvas,
      maskCanvas,
      maskRevision: 0,
      aiMaskSnapshot: null,
      hasRemovedBg: hasTransparency,
      status: hasTransparency ? 'done' : 'idle',
      thumbnailUrl: createThumbnailDataUrl(sourceCanvas),
      edits,
      history: [
        {
          id: `hist_${Date.now()}`,
          label: 'Original Image',
          timestamp: Date.now(),
          edits: cloneEdits(edits),
          alphaSnapshot: initialAlpha,
          hasRemovedBg: hasTransparency,
        },
      ],
      historyIndex: 0,
    };
  } finally {
    if (bitmap) bitmap.close();
    if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
  }
}

export function getRotatedDimensions(item: StudioImageItem): { width: number; height: number } {
  const swap = item.edits.transform.rotate90 === 90 || item.edits.transform.rotate90 === 270;
  return {
    width: swap ? item.height : item.width,
    height: swap ? item.width : item.height,
  };
}

export function getOutputDimensions(
  item: StudioImageItem,
  ignoreResize = false
): { width: number; height: number } {
  const rot = getRotatedDimensions(item);
  const crop = item.edits.transform.crop;
  const croppedW = Math.max(1, Math.round(crop ? rot.width * crop.width : rot.width));
  const croppedH = Math.max(1, Math.round(crop ? rot.height * crop.height : rot.height));

  if (!ignoreResize && item.edits.transform.resize.enabled) {
    return {
      width: Math.max(1, Math.round(item.edits.transform.resize.width)),
      height: Math.max(1, Math.round(item.edits.transform.resize.height)),
    };
  }

  return { width: croppedW, height: croppedH };
}

export function outputNormToSourcePixel(
  normX: number,
  normY: number,
  item: StudioImageItem
): { x: number; y: number } {
  const rot = getRotatedDimensions(item);
  const { crop, rotate90, straighten, flipH, flipV, offsetX, offsetY } = item.edits.transform;

  const adjX = normX - (offsetX || 0);
  const adjY = normY - (offsetY || 0);

  const rx = (crop ? crop.x + adjX * crop.width : adjX) * rot.width;
  const ry = (crop ? crop.y + adjY * crop.height : adjY) * rot.height;

  const dx = rx - rot.width / 2;
  const dy = ry - rot.height / 2;

  const theta = ((rotate90 + straighten) * Math.PI) / 180;
  const cos = Math.cos(-theta);
  const sin = Math.sin(-theta);

  let ux = dx * cos - dy * sin;
  let uy = dx * sin + dy * cos;

  if (flipH) ux = -ux;
  if (flipV) uy = -uy;

  return {
    x: ux + item.width / 2,
    y: uy + item.height / 2,
  };
}

export function paintMaskStroke(
  maskCanvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mode: 'erase' | 'restore',
  diameter: number,
  hardness: number
): void {
  const ctx = maskCanvas.getContext('2d');
  if (!ctx) return;

  const radius = Math.max(1, diameter / 2);
  const innerRadius = radius * Math.min(0.98, Math.max(0, hardness / 100));
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(1, radius * 0.22);
  const steps = Math.max(1, Math.ceil(dist / step));

  ctx.save();
  ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 1 : i / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;

    const grad = ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, radius);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function buildRefinedMaskCanvas(
  rawMaskCanvas: HTMLCanvasElement,
  matting: MattingSettings
): HTMLCanvasElement {
  const w = rawMaskCanvas.width;
  const h = rawMaskCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return rawMaskCanvas;

  const shiftAbs = Math.abs(matting.maskShift);
  const smoothBlur = (matting.edgeSmooth / 100) * 2.5 + shiftAbs * 0.7;

  if (smoothBlur > 0.05) {
    ctx.filter = `blur(${smoothBlur.toFixed(2)}px)`;
  }
  ctx.drawImage(rawMaskCanvas, 0, 0);
  ctx.filter = 'none';

  const needsPixelPass =
    matting.invertMask || matting.maskShift !== 0 || matting.edgeSmooth > 0;

  if (needsPixelPass) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    const midpoint = 127.5 - matting.maskShift * 10.5;
    const slope = 1 + (matting.edgeSmooth / 100) * 2.2 + shiftAbs * 0.25;

    for (let i = 3; i < d.length; i += 4) {
      let a = d[i];
      if (matting.invertMask) {
        a = 255 - a;
      }
      if (matting.maskShift !== 0 || matting.edgeSmooth > 0) {
        let mapped = (a - midpoint) * slope + 127.5;
        if (mapped < 0) mapped = 0;
        else if (mapped > 255) mapped = 255;
        a = mapped;
      }
      d[i - 3] = 255;
      d[i - 2] = 255;
      d[i - 1] = 255;
      d[i] = a;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  if (matting.feather > 0.05) {
    const feathered = document.createElement('canvas');
    feathered.width = w;
    feathered.height = h;
    const fCtx = feathered.getContext('2d');
    if (fCtx) {
      fCtx.filter = `blur(${matting.feather.toFixed(2)}px)`;
      fCtx.drawImage(out, 0, 0);
      fCtx.filter = 'none';
      return feathered;
    }
  }

  return out;
}

function applyColorDecontamination(
  subjectCtx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  const imgData = subjectCtx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const copy = new Uint8ClampedArray(d);
  const offsets = [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
    [-5, 0],
    [5, 0],
    [0, -5],
    [0, 5],
  ];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const a = copy[idx + 3];
      if (a > 8 && a < 238) {
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let wSum = 0;

        for (let k = 0; k < offsets.length; k++) {
          const nx = x + offsets[k][0];
          const ny = y + offsets[k][1];
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nIdx = (ny * w + nx) * 4;
          const na = copy[nIdx + 3];
          if (na > 235) {
            rSum += copy[nIdx] * na;
            gSum += copy[nIdx + 1] * na;
            bSum += copy[nIdx + 2] * na;
            wSum += na;
          }
        }

        if (wSum > 0) {
          const blend = (1 - a / 255) * 0.72;
          d[idx] = Math.round(copy[idx] * (1 - blend) + (rSum / wSum) * blend);
          d[idx + 1] = Math.round(copy[idx + 1] * (1 - blend) + (gSum / wSum) * blend);
          d[idx + 2] = Math.round(copy[idx + 2] * (1 - blend) + (bSum / wSum) * blend);
        }
      }
    }
  }

  subjectCtx.putImageData(imgData, 0, 0);
}

function buildFilterString(adj: ImageEditSettings['adjustments']): string {
  const parts: string[] = [];
  if (adj.brightness !== 100) parts.push(`brightness(${adj.brightness}%)`);
  if (adj.contrast !== 100) parts.push(`contrast(${adj.contrast}%)`);
  if (adj.saturation !== 100) parts.push(`saturate(${adj.saturation}%)`);
  if (adj.warmth > 0) parts.push(`sepia(${(adj.warmth * 0.65).toFixed(1)}%)`);
  if (adj.warmth < 0) parts.push(`hue-rotate(${(adj.warmth * 0.4).toFixed(1)}deg)`);
  if (adj.blur > 0) parts.push(`blur(${adj.blur.toFixed(1)}px)`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

function hasPixelEnhancements(adj: ImageEditSettings['adjustments']): boolean {
  return (
    adj.exposure !== 0 ||
    adj.highlights !== 0 ||
    adj.shadows !== 0 ||
    adj.vibrance !== 0 ||
    adj.clarity > 0 ||
    adj.sharpness > 0 ||
    adj.denoise > 0
  );
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Separable box blur on RGB channels (used for Unsharp Mask sharpening & Clarity local contrast).
 */
function boxBlurRgb(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number
): Float32Array {
  const tmp = new Float32Array(w * h * 3);
  const out = new Float32Array(w * h * 3);
  const r = Math.max(1, Math.min(8, Math.round(radius)));
  const invSpan = 1 / (2 * r + 1);

  // Horizontal sliding-window pass (O(1) per pixel)
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    const firstP = rowOff * 4;
    let sr = src[firstP] * (r + 1);
    let sg = src[firstP + 1] * (r + 1);
    let sb = src[firstP + 2] * (r + 1);

    for (let k = 1; k <= r; k++) {
      const p = (rowOff + (k < w ? k : w - 1)) * 4;
      sr += src[p];
      sg += src[p + 1];
      sb += src[p + 2];
    }

    for (let x = 0; x < w; x++) {
      const q = (rowOff + x) * 3;
      tmp[q] = sr * invSpan;
      tmp[q + 1] = sg * invSpan;
      tmp[q + 2] = sb * invSpan;

      const addX = x + r + 1 < w ? x + r + 1 : w - 1;
      const subX = x - r >= 0 ? x - r : 0;
      const pAdd = (rowOff + addX) * 4;
      const pSub = (rowOff + subX) * 4;
      sr += src[pAdd] - src[pSub];
      sg += src[pAdd + 1] - src[pSub + 1];
      sb += src[pAdd + 2] - src[pSub + 2];
    }
  }

  // Vertical sliding-window pass (O(1) per pixel)
  for (let x = 0; x < w; x++) {
    const firstP = x * 3;
    let sr = tmp[firstP] * (r + 1);
    let sg = tmp[firstP + 1] * (r + 1);
    let sb = tmp[firstP + 2] * (r + 1);

    for (let k = 1; k <= r; k++) {
      const p = ((k < h ? k : h - 1) * w + x) * 3;
      sr += tmp[p];
      sg += tmp[p + 1];
      sb += tmp[p + 2];
    }

    for (let y = 0; y < h; y++) {
      const q = (y * w + x) * 3;
      out[q] = sr * invSpan;
      out[q + 1] = sg * invSpan;
      out[q + 2] = sb * invSpan;

      const addY = y + r + 1 < h ? y + r + 1 : h - 1;
      const subY = y - r >= 0 ? y - r : 0;
      const pAdd = (addY * w + x) * 3;
      const pSub = (subY * w + x) * 3;
      sr += tmp[pAdd] - tmp[pSub];
      sg += tmp[pAdd + 1] - tmp[pSub + 1];
      sb += tmp[pAdd + 2] - tmp[pSub + 2];
    }
  }

  return out;
}

/**
 * Applies real local pixel-level image enhancements (Edge-preserving Denoise, Exposure,
 * Shadows/Highlights tone curve, Smart Vibrance, Clarity local contrast, and Unsharp Mask sharpening)
 * while strictly preserving the alpha channel.
 */
function applyPixelEnhancements(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  adj: ImageEditSettings['adjustments'],
  fastPreview = false
): void {
  if (!hasPixelEnhancements(adj) || w <= 0 || h <= 0) return;

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // 1. Edge-preserving spatial denoise (bilateral-inspired 3x3)
  if (adj.denoise > 0 && !fastPreview) {
    const strength = Math.min(1, adj.denoise / 100);
    const colorThresh = 14 + strength * 42;
    const invTwoSigma2 = 1 / (2 * colorThresh * colorThresh);
    const srcCopy = new Uint8ClampedArray(d);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        if (srcCopy[idx + 3] === 0) continue;

        const cr = srcCopy[idx];
        const cg = srcCopy[idx + 1];
        const cb = srcCopy[idx + 2];

        let rSum = cr;
        let gSum = cg;
        let bSum = cb;
        let wSum = 1;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nIdx = ((y + dy) * w + (x + dx)) * 4;
            if (srcCopy[nIdx + 3] < 20) continue;
            const dr = srcCopy[nIdx] - cr;
            const dg = srcCopy[nIdx + 1] - cg;
            const db = srcCopy[nIdx + 2] - cb;
            const dist2 = dr * dr + dg * dg + db * db;
            const wt = Math.exp(-dist2 * invTwoSigma2) * (dx === 0 || dy === 0 ? 0.75 : 0.45);
            rSum += srcCopy[nIdx] * wt;
            gSum += srcCopy[nIdx + 1] * wt;
            bSum += srcCopy[nIdx + 2] * wt;
            wSum += wt;
          }
        }

        const nr = rSum / wSum;
        const ng = gSum / wSum;
        const nb = bSum / wSum;
        d[idx] = clampByte(cr + (nr - cr) * strength);
        d[idx + 1] = clampByte(cg + (ng - cg) * strength);
        d[idx + 2] = clampByte(cb + (nb - cb) * strength);
      }
    }
  }

  // 2. Photographic Exposure, Shadows/Highlights recovery & Smart Vibrance
  const hasTonePass =
    adj.exposure !== 0 || adj.highlights !== 0 || adj.shadows !== 0 || adj.vibrance !== 0;

  if (hasTonePass) {
    const expMul = Math.pow(2, adj.exposure / 55);
    const shAmt = (adj.shadows / 100) * 0.55;
    const hiAmt = (adj.highlights / 100) * 0.55;
    const vibAmt = adj.vibrance / 100;

    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;

      let r = d[i] / 255;
      let g = d[i + 1] / 255;
      let b = d[i + 2] / 255;

      if (adj.exposure !== 0) {
        r *= expMul;
        g *= expMul;
        b *= expMul;
      }

      if (adj.shadows !== 0 || adj.highlights !== 0) {
        const lum = Math.max(0, Math.min(1, 0.2126 * r + 0.7152 * g + 0.0722 * b));
        const shadowWeight = (1 - lum) * (1 - lum);
        const highlightWeight = lum * lum;
        const delta = shAmt * shadowWeight + hiAmt * highlightWeight;
        r += delta;
        g += delta;
        b += delta;
      }

      if (adj.vibrance !== 0) {
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const avg = (r + g + b) / 3;
        const sat = maxC - minC;
        const boost = vibAmt * (1 - Math.min(1, sat)) * 0.85;
        r += (r - avg) * boost;
        g += (g - avg) * boost;
        b += (b - avg) * boost;
      }

      d[i] = clampByte(r * 255);
      d[i + 1] = clampByte(g * 255);
      d[i + 2] = clampByte(b * 255);
    }
  }

  // 3. Clarity (mid-tone local micro-contrast)
  if (adj.clarity > 0 && !fastPreview) {
    const blur = boxBlurRgb(d, w, h, 3);
    const amt = (adj.clarity / 100) * 0.95;
    for (let i = 0, q = 0; i < d.length; i += 4, q += 3) {
      if (d[i + 3] === 0) continue;
      const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      // Mid-tone bell weight protects clipped highlights and crushed blacks
      const midWeight = 4 * lum * (1 - lum);
      const scale = amt * (0.35 + 0.65 * midWeight);
      d[i] = clampByte(d[i] + (d[i] - blur[q]) * scale);
      d[i + 1] = clampByte(d[i + 1] + (d[i + 1] - blur[q + 1]) * scale);
      d[i + 2] = clampByte(d[i + 2] + (d[i + 2] - blur[q + 2]) * scale);
    }
  }

  // 4. Unsharp Mask Sharpening
  if (adj.sharpness > 0 && !fastPreview) {
    const blur = boxBlurRgb(d, w, h, 1);
    const amt = (adj.sharpness / 100) * 1.45;
    for (let i = 0, q = 0; i < d.length; i += 4, q += 3) {
      if (d[i + 3] === 0) continue;
      const dr = d[i] - blur[q];
      const dg = d[i + 1] - blur[q + 1];
      const db = d[i + 2] - blur[q + 2];
      // Threshold prevents amplifying flat noise
      if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) < 6) continue;
      d[i] = clampByte(d[i] + dr * amt);
      d[i + 1] = clampByte(d[i + 1] + dg * amt);
      d[i + 2] = clampByte(d[i + 2] + db * amt);
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Analyzes the actual image histogram, dynamic range, white balance, and color saturation
 * to compute tailored one-click Auto Enhance settings.
 */
export function analyzeImageForAutoEnhance(item: StudioImageItem): ImageEditSettings['adjustments'] {
  const sampleSize = 192;
  const c = document.createElement('canvas');
  c.width = sampleSize;
  c.height = sampleSize;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      ...item.edits.adjustments,
      brightness: 104,
      contrast: 112,
      saturation: 106,
      exposure: 4,
      shadows: 18,
      highlights: -10,
      vibrance: 22,
      clarity: 24,
      sharpness: 32,
      denoise: 0,
    };
  }

  ctx.drawImage(item.sourceCanvas, 0, 0, sampleSize, sampleSize);
  const srcData = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

  let maskData: Uint8ClampedArray | null = null;
  if (item.hasRemovedBg && item.edits.adjustments.applyTo === 'subject') {
    const mc = document.createElement('canvas');
    mc.width = sampleSize;
    mc.height = sampleSize;
    const mCtx = mc.getContext('2d', { willReadFrequently: true });
    if (mCtx) {
      mCtx.drawImage(item.maskCanvas, 0, 0, sampleSize, sampleSize);
      maskData = mCtx.getImageData(0, 0, sampleSize, sampleSize).data;
    }
  }

  const hist = new Uint32Array(256);
  let totalPixels = 0;
  let sumLum = 0;
  let sumSat = 0;
  let sumR = 0;
  let sumB = 0;

  for (let i = 0; i < srcData.length; i += 4) {
    if (maskData && maskData[i + 3] < 80) continue;
    const r = srcData[i];
    const g = srcData[i + 1];
    const b = srcData[i + 2];
    const lum = Math.min(255, Math.max(0, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));
    hist[lum]++;
    totalPixels++;
    sumLum += lum;
    sumR += r;
    sumB += b;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    sumSat += maxC > 0 ? (maxC - minC) / maxC : 0;
  }

  if (totalPixels < 32) {
    return {
      ...item.edits.adjustments,
      brightness: 104,
      contrast: 112,
      saturation: 106,
      exposure: 4,
      shadows: 18,
      highlights: -10,
      vibrance: 22,
      clarity: 24,
      sharpness: 32,
      denoise: 0,
    };
  }

  // Find p2 and p98 luminance bounds
  let acc = 0;
  let p2 = 0;
  let p98 = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= totalPixels * 0.02) {
      p2 = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= totalPixels * 0.02) {
      p98 = i;
      break;
    }
  }

  const meanLum = sumLum / totalPixels; // 0..255
  const meanSat = sumSat / totalPixels; // 0..1
  const dynamicSpan = Math.max(40, p98 - p2);

  // Compute balanced corrections
  const targetMean = 128;
  const exposure = Math.max(-16, Math.min(22, Math.round((targetMean - meanLum) * 0.24)));
  const contrastBoost = Math.max(104, Math.min(126, Math.round(100 + (225 - dynamicSpan) * 0.16)));
  const shadows = meanLum < 120 ? Math.min(42, Math.round((125 - meanLum) * 0.55)) : 12;
  const highlights = p98 > 238 ? -Math.min(35, Math.round((p98 - 225) * 1.1)) : -6;
  const vibrance = Math.max(10, Math.min(38, Math.round((0.46 - meanSat) * 65 + 14)));

  // Subtle neutral white balance nudge
  const rbDiff = (sumR - sumB) / totalPixels;
  const warmth = Math.max(-10, Math.min(10, Math.round(-rbDiff * 0.12)));

  return {
    ...item.edits.adjustments,
    brightness: 102,
    contrast: contrastBoost,
    saturation: 104,
    warmth,
    exposure,
    highlights,
    shadows,
    vibrance,
    clarity: 26,
    sharpness: 34,
    denoise: 12,
  };
}

function getOrBuildSubjectLayer(
  item: StudioImageItem,
  fastPreview = false
): {
  refinedMaskCanvas: HTMLCanvasElement;
  subjectCanvas: HTMLCanvasElement;
} {
  const { matting, adjustments } = item.edits;
  const useDecontam = matting.decontaminate && item.hasRemovedBg && !fastPreview;
  const maskKey = `${item.maskRevision}_${matting.feather}_${matting.edgeSmooth}_${matting.maskShift}_${matting.invertMask}`;
  const adjKey = `${adjustments.applyTo}_${adjustments.brightness}_${adjustments.contrast}_${adjustments.saturation}_${adjustments.warmth}_${adjustments.exposure}_${adjustments.highlights}_${adjustments.shadows}_${adjustments.vibrance}_${adjustments.clarity}_${adjustments.sharpness}_${adjustments.denoise}_${adjustments.blur}_${fastPreview}`;
  const subjectKey = `${maskKey}_${useDecontam}_${adjKey}`;

  const cached = pipelineCacheMap.get(item);
  let refinedMaskCanvas: HTMLCanvasElement;

  if (cached && cached.maskKey === maskKey) {
    refinedMaskCanvas = cached.refinedMaskCanvas;
  } else {
    refinedMaskCanvas = buildRefinedMaskCanvas(item.maskCanvas, matting);
  }

  if (cached && cached.subjectKey === subjectKey) {
    return { refinedMaskCanvas, subjectCanvas: cached.subjectCanvas };
  }

  const subjectCanvas = document.createElement('canvas');
  subjectCanvas.width = item.width;
  subjectCanvas.height = item.height;
  const sCtx = subjectCanvas.getContext('2d', { willReadFrequently: true });
  if (sCtx) {
    if (adjustments.applyTo === 'subject') {
      sCtx.filter = buildFilterString(adjustments);
    }
    sCtx.drawImage(item.sourceCanvas, 0, 0);
    sCtx.filter = 'none';

    sCtx.globalCompositeOperation = 'destination-in';
    sCtx.drawImage(refinedMaskCanvas, 0, 0);
    sCtx.globalCompositeOperation = 'source-over';

    if (useDecontam) {
      applyColorDecontamination(sCtx, item.width, item.height);
    }

    if (adjustments.applyTo === 'subject' && hasPixelEnhancements(adjustments)) {
      applyPixelEnhancements(sCtx, item.width, item.height, adjustments, fastPreview);
    }
  }

  pipelineCacheMap.set(item, {
    maskKey,
    refinedMaskCanvas,
    subjectKey,
    subjectCanvas,
  });

  return { refinedMaskCanvas, subjectCanvas };
}

function drawTransformedSource(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement | HTMLImageElement,
  item: StudioImageItem,
  outW: number,
  outH: number,
  extraFilter?: string
): void {
  const rot = getRotatedDimensions(item);
  const { rotate90, straighten, flipH, flipV, crop } = item.edits.transform;

  const cropX = crop ? crop.x * rot.width : 0;
  const cropY = crop ? crop.y * rot.height : 0;
  const cropW = crop ? crop.width * rot.width : rot.width;
  const cropH = crop ? crop.height * rot.height : rot.height;

  const scaleX = outW / cropW;
  const scaleY = outH / cropH;

  ctx.save();
  if (extraFilter && extraFilter !== 'none') {
    ctx.filter = extraFilter;
  }
  ctx.scale(scaleX, scaleY);
  ctx.translate(-cropX, -cropY);
  ctx.translate(rot.width / 2, rot.height / 2);
  ctx.rotate(((rotate90 + straighten) * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(source, -item.width / 2, -item.height / 2, item.width, item.height);
  ctx.restore();
}

function drawImageFitted(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement | HTMLImageElement,
  outW: number,
  outH: number,
  fit: ImageEditSettings['background']['imageFit'],
  blurPx: number
): void {
  const imgW = img instanceof HTMLImageElement ? img.naturalWidth || img.width : img.width;
  const imgH = img instanceof HTMLImageElement ? img.naturalHeight || img.height : img.height;
  if (!imgW || !imgH) return;

  const pad = blurPx > 0 ? blurPx * 2 : 0;
  const targetW = outW + pad * 2;
  const targetH = outH + pad * 2;

  let dx = -pad;
  let dy = -pad;
  let dw = targetW;
  let dh = targetH;

  if (fit === 'cover') {
    const scale = Math.max(targetW / imgW, targetH / imgH);
    dw = imgW * scale;
    dh = imgH * scale;
    dx = (outW - dw) / 2;
    dy = (outH - dh) / 2;
  } else if (fit === 'contain') {
    const scale = Math.min(outW / imgW, outH / imgH);
    dw = imgW * scale;
    dh = imgH * scale;
    dx = (outW - dw) / 2;
    dy = (outH - dh) / 2;
  }

  ctx.save();
  if (blurPx > 0) {
    ctx.filter = `blur(${blurPx}px)`;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function drawOutlineAroundSubject(
  ctx: CanvasRenderingContext2D,
  subjectTransformedCanvas: HTMLCanvasElement,
  widthPx: number,
  color: string,
  opacityPercent: number
): void {
  const w = subjectTransformedCanvas.width;
  const h = subjectTransformedCanvas.height;

  const sil = document.createElement('canvas');
  sil.width = w;
  sil.height = h;
  const sCtx = sil.getContext('2d');
  if (!sCtx) return;

  sCtx.drawImage(subjectTransformedCanvas, 0, 0);
  sCtx.globalCompositeOperation = 'source-in';
  sCtx.fillStyle = color;
  sCtx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacityPercent / 100));

  const rings = widthPx > 14 ? [widthPx * 0.5, widthPx] : [widthPx];
  for (const r of rings) {
    const steps = Math.max(16, Math.min(48, Math.round(r * 2.5)));
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      ctx.drawImage(sil, Math.cos(angle) * r, Math.sin(angle) * r);
    }
  }
  ctx.restore();
}

export interface RenderCompositeOptions {
  mode: 'result' | 'original' | 'mask';
  targetWidth?: number;
  targetHeight?: number;
  forceOpaqueBgColor?: string;
  fastPreview?: boolean;
}

export function renderStudioComposite(
  item: StudioImageItem,
  targetCanvas: HTMLCanvasElement,
  options: RenderCompositeOptions
): void {
  const baseDims = getOutputDimensions(item, false);
  const outW = Math.max(1, Math.round(options.targetWidth ?? baseDims.width));
  const outH = Math.max(1, Math.round(options.targetHeight ?? baseDims.height));

  if (targetCanvas.width !== outW || targetCanvas.height !== outH) {
    targetCanvas.width = outW;
    targetCanvas.height = outH;
  }

  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, outW, outH);

  if (options.mode === 'original') {
    drawTransformedSource(ctx, item.sourceCanvas, item, outW, outH);
    return;
  }

  const { refinedMaskCanvas, subjectCanvas } = getOrBuildSubjectLayer(item, options.fastPreview);

  const shiftPxX = (item.edits.transform.offsetX || 0) * outW;
  const shiftPxY = (item.edits.transform.offsetY || 0) * outH;

  if (options.mode === 'mask') {
    ctx.save();
    ctx.translate(shiftPxX, shiftPxY);
    drawTransformedSource(ctx, item.sourceCanvas, item, outW, outH);
    ctx.restore();

    const overlay = document.createElement('canvas');
    overlay.width = outW;
    overlay.height = outH;
    const oCtx = overlay.getContext('2d');
    if (oCtx) {
      oCtx.fillStyle = 'rgba(239, 68, 68, 0.56)';
      oCtx.fillRect(0, 0, outW, outH);
      oCtx.globalCompositeOperation = 'destination-out';
      oCtx.save();
      oCtx.translate(shiftPxX, shiftPxY);
      drawTransformedSource(oCtx, refinedMaskCanvas, item, outW, outH);
      oCtx.restore();
      ctx.drawImage(overlay, 0, 0);
    }
    return;
  }

  const { background, effects, adjustments } = item.edits;
  const fullFilter = adjustments.applyTo === 'all' ? buildFilterString(adjustments) : 'none';

  const workCanvas = fullFilter !== 'none' ? document.createElement('canvas') : targetCanvas;
  if (workCanvas !== targetCanvas) {
    workCanvas.width = outW;
    workCanvas.height = outH;
  }
  const wCtx = workCanvas.getContext('2d')!;
  if (workCanvas !== targetCanvas) {
    wCtx.clearRect(0, 0, outW, outH);
  }

  if (background.type === 'transparent') {
    if (options.forceOpaqueBgColor) {
      wCtx.fillStyle = options.forceOpaqueBgColor;
      wCtx.fillRect(0, 0, outW, outH);
    }
  } else if (background.type === 'original-blur') {
    const blurPx = Math.max(0, background.blur * (outW / Math.max(1, item.width)));
    wCtx.save();
    if (blurPx > 0) {
      const padScale = 1 + (blurPx * 2.4) / Math.min(outW, outH);
      wCtx.translate(outW / 2, outH / 2);
      wCtx.scale(padScale, padScale);
      wCtx.translate(-outW / 2, -outH / 2);
    }
    drawTransformedSource(
      wCtx,
      item.sourceCanvas,
      item,
      outW,
      outH,
      blurPx > 0 ? `blur(${blurPx.toFixed(1)}px)` : undefined
    );
    wCtx.restore();
  } else if (background.type === 'color') {
    wCtx.fillStyle = background.color;
    wCtx.fillRect(0, 0, outW, outH);
  } else if (background.type === 'gradient') {
    const { type, angle, color1, color2 } = background.gradient;
    let grad: CanvasGradient;
    if (type === 'radial') {
      const r = Math.hypot(outW, outH) / 2;
      grad = wCtx.createRadialGradient(outW / 2, outH / 2, 0, outW / 2, outH / 2, r);
    } else {
      const rad = ((angle - 90) * Math.PI) / 180;
      const halfDiag = Math.hypot(outW, outH) / 2;
      const x1 = outW / 2 - Math.cos(rad) * halfDiag;
      const y1 = outH / 2 - Math.sin(rad) * halfDiag;
      const x2 = outW / 2 + Math.cos(rad) * halfDiag;
      const y2 = outH / 2 + Math.sin(rad) * halfDiag;
      grad = wCtx.createLinearGradient(x1, y1, x2, y2);
    }
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    wCtx.fillStyle = grad;
    wCtx.fillRect(0, 0, outW, outH);
  } else if (background.type === 'image') {
    if (options.forceOpaqueBgColor) {
      wCtx.fillStyle = options.forceOpaqueBgColor;
      wCtx.fillRect(0, 0, outW, outH);
    }
    const blurPx = Math.max(0, background.blur * (outW / Math.max(1, item.width)));
    if (background.imageId === 'custom' && background.customImageUrl) {
      const customImg = customBgImageCache.get(background.customImageUrl);
      if (customImg && customImg.complete) {
        drawImageFitted(wCtx, customImg, outW, outH, background.imageFit, blurPx);
      }
    } else if (background.imageId) {
      const presetCanvas = getBackdropCanvas(background.imageId);
      if (presetCanvas) {
        drawImageFitted(wCtx, presetCanvas, outW, outH, background.imageFit, blurPx);
      }
    }
  }

  const subjectOut = document.createElement('canvas');
  subjectOut.width = outW;
  subjectOut.height = outH;
  const soCtx = subjectOut.getContext('2d');
  if (soCtx) {
    soCtx.save();
    soCtx.translate(shiftPxX, shiftPxY);
    drawTransformedSource(soCtx, subjectCanvas, item, outW, outH);
    soCtx.restore();
  }

  const effectScale = outW / Math.max(1, baseDims.width);
  const hasOutline = effects.outline.enabled && effects.outline.width > 0 && effects.outline.opacity > 0;
  const hasShadow = effects.shadow.enabled && effects.shadow.opacity > 0;

  let foregroundLayer: HTMLCanvasElement = subjectOut;
  if (hasOutline) {
    const outlined = document.createElement('canvas');
    outlined.width = outW;
    outlined.height = outH;
    const oCtx = outlined.getContext('2d');
    if (oCtx) {
      drawOutlineAroundSubject(
        oCtx,
        subjectOut,
        Math.max(1, effects.outline.width * effectScale),
        effects.outline.color,
        effects.outline.opacity
      );
      oCtx.drawImage(subjectOut, 0, 0);
      foregroundLayer = outlined;
    }
  }

  if (hasShadow) {
    const sh = effects.shadow;
    wCtx.save();
    wCtx.shadowColor = hexToRgba(sh.color, sh.opacity / 100);
    wCtx.shadowBlur = sh.blur * effectScale;
    wCtx.shadowOffsetX = sh.offsetX * effectScale;
    wCtx.shadowOffsetY = sh.offsetY * effectScale;
    wCtx.drawImage(foregroundLayer, 0, 0);
    wCtx.restore();
  } else {
    wCtx.drawImage(foregroundLayer, 0, 0);
  }

  if (workCanvas !== targetCanvas) {
    ctx.save();
    ctx.filter = fullFilter;
    ctx.drawImage(workCanvas, 0, 0);
    ctx.restore();
  }

  if (adjustments.applyTo === 'all' && hasPixelEnhancements(adjustments)) {
    applyPixelEnhancements(ctx, outW, outH, adjustments, Boolean(options.fastPreview));
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

export function computeExportDimensions(
  item: StudioImageItem,
  options: ExportOptions
): { width: number; height: number } {
  const base = getOutputDimensions(item, false);
  if (options.scaleMode === '2x') {
    return {
      width: Math.min(4096, base.width * 2),
      height: Math.min(4096, base.height * 2),
    };
  }
  if (options.scaleMode === '0.5x') {
    return {
      width: Math.max(1, Math.round(base.width * 0.5)),
      height: Math.max(1, Math.round(base.height * 0.5)),
    };
  }
  if (options.scaleMode === 'custom') {
    return {
      width: Math.max(1, Math.min(4096, Math.round(options.customWidth || base.width))),
      height: Math.max(1, Math.min(4096, Math.round(options.customHeight || base.height))),
    };
  }
  return base;
}

export async function exportItemToBlob(
  item: StudioImageItem,
  options: ExportOptions
): Promise<Blob> {
  if (item.edits.background.type === 'image' && item.edits.background.customImageUrl) {
    await preloadCustomBgImage(item.edits.background.customImageUrl).catch(() => {});
  }

  const { width, height } = computeExportDimensions(item, options);
  const canvas = document.createElement('canvas');
  renderStudioComposite(item, canvas, {
    mode: 'result',
    targetWidth: width,
    targetHeight: height,
    forceOpaqueBgColor: options.format === 'image/jpeg' ? '#FFFFFF' : undefined,
  });

  const quality =
    options.format === 'image/png' ? undefined : Math.max(0.1, Math.min(1, options.quality / 100));

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode exported image'));
      },
      options.format,
      quality
    );
  });
}

export function getExtensionForFormat(format: ExportOptions['format']): string {
  if (format === 'image/jpeg') return 'jpg';
  if (format === 'image/webp') return 'webp';
  return 'png';
}

export function stripFileExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function exportBatchToZip(
  items: StudioImageItem[],
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  const zip = new JSZip();
  const ext = getExtensionForFormat(options.format);
  const usedNames = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(i + 1, items.length);

    const itemOpts: ExportOptions =
      options.scaleMode === 'custom' && items.length > 1
        ? { ...options, scaleMode: 'original' }
        : options;

    const blob = await exportItemToBlob(item, itemOpts);
    const base = stripFileExtension(item.name) || `image_${i + 1}`;
    let fileName = `${base}_cutout.${ext}`;
    let counter = 2;
    while (usedNames.has(fileName.toLowerCase())) {
      fileName = `${base}_cutout_${counter}.${ext}`;
      counter++;
    }
    usedNames.add(fileName.toLowerCase());
    zip.file(fileName, blob);
  }

  return zip.generateAsync({ type: 'blob' });
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
