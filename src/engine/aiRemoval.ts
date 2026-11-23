import type { ProcessingProgress } from '../types/studio';

const MODEL_ENDPOINT = '/api/model/rmbg-1.4.onnx';
const MODEL_CACHE_NAME = 'chromacut-rmbg-onnx-v1';
const MODEL_INPUT_SIZE = 1024;

export interface BgRemovalResult {
  alphaMask: Uint8Array;
  engine: 'browser-onnx' | 'server-onnx';
}

interface PendingJob {
  resolve: (result: BgRemovalResult) => void;
  reject: (err: Error) => void;
  onProgress?: (progress: ProcessingProgress) => void;
}

type WorkerInboundMessage =
  | { type: 'preload' }
  | {
      type: 'remove';
      id: number;
      targetWidth: number;
      targetHeight: number;
      imageBitmap?: ImageBitmap;
      rgba1024Buffer?: ArrayBuffer;
    };

type WorkerOutboundMessage =
  | { type: 'progress'; id: number; progress: ProcessingProgress }
  | { type: 'result'; id: number; alphaBuffer: ArrayBuffer; engine: 'browser-onnx' | 'server-onnx' }
  | { type: 'error'; id: number; message: string }
  | { type: 'preloaded'; ok: boolean };

let bgWorker: Worker | null = null;
let workerUnavailable = false;
let preloadRequested = false;
let nextJobId = 1;
const pendingJobs = new Map<number, PendingJob>();

function getOrCreateWorker(): Worker | null {
  if (workerUnavailable || typeof Worker === 'undefined') {
    return null;
  }
  if (bgWorker) return bgWorker;

  try {
    const worker = new Worker(new URL('./bgRemoval.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;
      if (msg.type === 'preloaded') return;

      const job = pendingJobs.get(msg.id);
      if (!job) return;

      if (msg.type === 'progress') {
        job.onProgress?.(msg.progress);
      } else if (msg.type === 'result') {
        pendingJobs.delete(msg.id);
        job.resolve({
          alphaMask: new Uint8Array(msg.alphaBuffer),
          engine: msg.engine,
        });
      } else if (msg.type === 'error') {
        pendingJobs.delete(msg.id);
        job.reject(new Error(msg.message));
      }
    };

    worker.onerror = (err) => {
      console.warn('BG removal worker error:', err);
      const failure = new Error('Background worker encountered an error');
      for (const [, job] of pendingJobs) {
        job.reject(failure);
      }
      pendingJobs.clear();
      worker.terminate();
      bgWorker = null;
      workerUnavailable = true;
    };

    bgWorker = worker;
    return worker;
  } catch (err) {
    console.warn('Failed to spawn BG removal worker:', err);
    workerUnavailable = true;
    return null;
  }
}

/**
 * Starts loading & initializing the RMBG-1.4 ONNX session inside the Web Worker
 * in the background (e.g. right after image upload) so Remove Background runs immediately.
 */
export function preloadBackgroundModel(): void {
  if (preloadRequested) return;
  const worker = getOrCreateWorker();
  if (!worker) return;
  preloadRequested = true;
  worker.postMessage({ type: 'preload' } satisfies WorkerInboundMessage);
}

/**
 * If the model is already cached in Browser Cache Storage from an earlier visit,
 * immediately warm up the Web Worker session on app startup (zero network traffic).
 */
export async function preloadCachedModelIfAvailable(): Promise<void> {
  if (preloadRequested || typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const cached = await cache.match(MODEL_ENDPOINT);
    if (cached) {
      preloadBackgroundModel();
    }
  } catch {
    // Ignore storage restriction
  }
}

function extract1024RgbaBuffer(sourceCanvas: HTMLCanvasElement): ArrayBuffer {
  const prep = document.createElement('canvas');
  prep.width = MODEL_INPUT_SIZE;
  prep.height = MODEL_INPUT_SIZE;
  const ctx = prep.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D Canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const { data } = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

async function runDirectServerFallback(
  sourceCanvas: HTMLCanvasElement,
  onProgress?: (progress: ProcessingProgress) => void
): Promise<BgRemovalResult> {
  onProgress?.({ stage: 'Working on it, give me a second...', percent: null });

  const rgba = new Uint8ClampedArray(extract1024RgbaBuffer(sourceCanvas));
  const pixelCount = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const rgb = new Uint8Array(pixelCount * 3);
  for (let i = 0, p = 0, q = 0; i < pixelCount; i++, p += 4, q += 3) {
    rgb[q] = rgba[p];
    rgb[q + 1] = rgba[p + 1];
    rgb[q + 2] = rgba[p + 2];
  }

  const resp = await fetch('/api/remove-bg-mask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: rgb.buffer as ArrayBuffer,
  });

  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    throw new Error(`AI background removal failed (HTTP ${resp.status}): ${errTxt}`);
  }

  const alpha1024 = new Uint8Array(await resp.arrayBuffer());
  const targetW = sourceCanvas.width;
  const targetH = sourceCanvas.height;

  if (targetW === MODEL_INPUT_SIZE && targetH === MODEL_INPUT_SIZE) {
    return { alphaMask: alpha1024, engine: 'server-onnx' };
  }

  const small = document.createElement('canvas');
  small.width = MODEL_INPUT_SIZE;
  small.height = MODEL_INPUT_SIZE;
  const sCtx = small.getContext('2d')!;
  const imgData = sCtx.createImageData(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  for (let i = 0, p = 0; i < alpha1024.length; i++, p += 4) {
    imgData.data[p] = 255;
    imgData.data[p + 1] = 255;
    imgData.data[p + 2] = 255;
    imgData.data[p + 3] = alpha1024[i];
  }
  sCtx.putImageData(imgData, 0, 0);

  const full = document.createElement('canvas');
  full.width = targetW;
  full.height = targetH;
  const fCtx = full.getContext('2d', { willReadFrequently: true })!;
  fCtx.imageSmoothingEnabled = true;
  fCtx.imageSmoothingQuality = 'high';
  fCtx.drawImage(small, 0, 0, targetW, targetH);

  const fullData = fCtx.getImageData(0, 0, targetW, targetH).data;
  const alphaMask = new Uint8Array(targetW * targetH);
  for (let i = 0, p = 3; i < alphaMask.length; i++, p += 4) {
    alphaMask[i] = fullData[p];
  }

  return { alphaMask, engine: 'server-onnx' };
}

/**
 * Runs real RMBG-1.4 ONNX background removal inside a dedicated Web Worker
 * so the UI never freezes or hangs. Returns the alpha mask immediately upon completion.
 */
export async function runOnnxBackgroundRemoval(
  sourceCanvas: HTMLCanvasElement,
  onProgress?: (progress: ProcessingProgress) => void
): Promise<BgRemovalResult> {
  const worker = getOrCreateWorker();
  if (!worker) {
    return runDirectServerFallback(sourceCanvas, onProgress);
  }

  const id = nextJobId++;
  const targetWidth = sourceCanvas.width;
  const targetHeight = sourceCanvas.height;

  const canTransferBitmap =
    typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';

  let payload: WorkerInboundMessage;
  let transferables: Transferable[];

  if (canTransferBitmap) {
    const bitmap = await createImageBitmap(sourceCanvas);
    payload = {
      type: 'remove',
      id,
      targetWidth,
      targetHeight,
      imageBitmap: bitmap,
    };
    transferables = [bitmap];
  } else {
    const rgba1024Buffer = extract1024RgbaBuffer(sourceCanvas);
    payload = {
      type: 'remove',
      id,
      targetWidth,
      targetHeight,
      rgba1024Buffer,
    };
    transferables = [rgba1024Buffer];
  }

  preloadRequested = true;

  return new Promise<BgRemovalResult>((resolve, reject) => {
    pendingJobs.set(id, { resolve, reject, onProgress });
    worker.postMessage(payload, transferables);
  }).catch((err) => {
    // If the worker crashed during startup, seamlessly fall back so removal still succeeds
    if (workerUnavailable) {
      return runDirectServerFallback(sourceCanvas, onProgress);
    }
    throw err;
  });
}
