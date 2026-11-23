/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import type { ProcessingProgress } from '../types/studio';

const MODEL_ENDPOINT = '/api/model/rmbg-1.4.onnx';
const ORT_MJS_ENDPOINT = '/api/ort/ort-wasm-simd-threaded.mjs';
const ORT_WASM_ENDPOINT = '/api/ort/ort-wasm-simd-threaded.wasm';
const MODEL_CACHE_NAME = 'chromacut-rmbg-onnx-v1';
const MODEL_INPUT_SIZE = 1024;
const PIXEL_COUNT = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;

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

let cachedSession: ort.InferenceSession | null = null;
let sessionInitPromise: Promise<ort.InferenceSession> | null = null;
let lastInitProgress: ProcessingProgress | null = null;
const initProgressListeners = new Set<(p: ProcessingProgress) => void>();

// Reusable worker buffers to avoid large GC allocations on repeated images
let reusableOffscreen: OffscreenCanvas | null = null;
let reusableOffscreenCtx: OffscreenCanvasRenderingContext2D | null = null;
let reusableFloatInput: Float32Array | null = null;

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function broadcastInitProgress(progress: ProcessingProgress): void {
  lastInitProgress = progress;
  for (const listener of initProgressListeners) {
    listener(progress);
  }
}

async function openModelCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(MODEL_CACHE_NAME);
  } catch {
    return null;
  }
}

/**
 * Loads a binary asset from Browser Cache Storage if present; otherwise streams it
 * from the network with real byte-level download progress and saves it to Cache Storage.
 */
async function loadCachedBinary(
  url: string,
  minValidBytes: number,
  contentType: string,
  onDownloadProgress?: (received: number, total: number) => void
): Promise<Uint8Array> {
  const cache = await openModelCache();
  if (cache) {
    try {
      const cached = await cache.match(url);
      if (cached) {
        const buf = await cached.arrayBuffer();
        if (buf.byteLength >= minValidBytes) {
          return new Uint8Array(buf);
        }
      }
    } catch {
      // Cache read failed; fall back to network fetch
    }
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
  }

  const headerLen = Number(res.headers.get('content-length') || 0);
  const reader = res.body?.getReader();
  let bytes: Uint8Array;

  if (reader && onDownloadProgress) {
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastEmit = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        const now = performance.now();
        if (now - lastEmit >= 75 || (headerLen > 0 && received >= headerLen)) {
          lastEmit = now;
          onDownloadProgress(received, headerLen);
        }
      }
    }

    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }

  if (bytes.byteLength < minValidBytes) {
    throw new Error(`Incomplete download for ${url} (${bytes.byteLength} bytes)`);
  }

  if (cache) {
    try {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      await cache.put(
        url,
        new Response(copy.buffer, {
          headers: { 'Content-Type': contentType },
        })
      );
    } catch {
      // Non-fatal if cache storage quota is exceeded
    }
  }

  return bytes;
}

/**
 * Initializes and caches the RMBG-1.4 ONNX Runtime Web session inside the Web Worker.
 * Runs once per browser tab lifecycle and persists binaries in Cache Storage across reloads.
 */
async function ensureOnnxSession(
  onProgress?: (p: ProcessingProgress) => void
): Promise<ort.InferenceSession> {
  if (cachedSession) {
    return cachedSession;
  }

  if (onProgress) {
    initProgressListeners.add(onProgress);
    if (lastInitProgress) {
      onProgress(lastInitProgress);
    }
  }

  try {
    if (!sessionInitPromise) {
      sessionInitPromise = (async () => {
        const cache = await openModelCache();
        const modelInCache = cache ? Boolean(await cache.match(MODEL_ENDPOINT)) : false;

        if (modelInCache) {
          broadcastInitProgress({
            stage: 'Warming up saved model...',
            percent: null,
          });
        } else {
          broadcastInitProgress({
            stage: 'Getting things ready (first time only)...',
            percent: 0,
          });
        }

        // Load model + ORT runtime files in parallel (all cached in Browser Cache Storage)
        const [modelBytes, mjsBytes, wasmBytes] = await Promise.all([
          loadCachedBinary(
            MODEL_ENDPOINT,
            10_000_000,
            'application/octet-stream',
            modelInCache
              ? undefined
              : (received, total) => {
                  const totalKnown = total > 0 ? total : 44_403_226;
                  const pct = Math.min(99, Math.round((received / totalKnown) * 100));
                  broadcastInitProgress({
                    stage: 'Downloading model...',
                    percent: pct,
                    detail: `${formatMb(received)} / ${formatMb(totalKnown)}`,
                  });
                }
          ),
          loadCachedBinary(ORT_MJS_ENDPOINT, 4_000, 'text/javascript; charset=utf-8'),
          loadCachedBinary(ORT_WASM_ENDPOINT, 1_000_000, 'application/wasm'),
        ]);

        broadcastInitProgress({
          stage: 'Almost ready...',
          percent: null,
        });

        const mjsBlobUrl = URL.createObjectURL(
          new Blob([mjsBytes.buffer as ArrayBuffer], { type: 'text/javascript' })
        );

        // Use multi-threading automatically if crossOriginIsolated; otherwise fast SIMD single-thread
        const canUseThreads =
          typeof self !== 'undefined' &&
          Boolean((self as DedicatedWorkerGlobalScope).crossOriginIsolated) &&
          typeof SharedArrayBuffer !== 'undefined';

        ort.env.wasm.numThreads = canUseThreads
          ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2))
          : 1;
        ort.env.wasm.proxy = false;
        ort.env.wasm.wasmBinary = wasmBytes.buffer as ArrayBuffer;
        ort.env.wasm.wasmPaths = { mjs: mjsBlobUrl };

        const session = await ort.InferenceSession.create(modelBytes, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });

        cachedSession = session;
        lastInitProgress = null;
        return session;
      })();
    }

    return await sessionInitPromise;
  } catch (err) {
    sessionInitPromise = null;
    lastInitProgress = null;
    throw err;
  } finally {
    if (onProgress) {
      initProgressListeners.delete(onProgress);
    }
  }
}

function get1024RgbaFromBitmap(bitmap: ImageBitmap): Uint8ClampedArray {
  if (!reusableOffscreen) {
    reusableOffscreen = new OffscreenCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    reusableOffscreenCtx = reusableOffscreen.getContext('2d', { willReadFrequently: true });
  }
  if (!reusableOffscreenCtx) {
    throw new Error('OffscreenCanvas 2D context unavailable in worker');
  }

  reusableOffscreenCtx.imageSmoothingEnabled = true;
  reusableOffscreenCtx.imageSmoothingQuality = 'high';
  reusableOffscreenCtx.clearRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  reusableOffscreenCtx.drawImage(bitmap, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  return reusableOffscreenCtx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE).data;
}

/**
 * Fast pure typed-array bilinear resize for single-channel alpha mask inside the worker.
 * Avoids extra DOM canvases and executes in ~2-4ms for <=1024px targets.
 */
function resizeAlphaMaskBilinear(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  if (srcW === dstW && srcH === dstH) {
    return src;
  }

  const dst = new Uint8Array(dstW * dstH);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  const maxSrcX = srcW - 1;
  const maxSrcY = srcH - 1;

  // Precompute horizontal indices & weights once
  const x0Arr = new Int32Array(dstW);
  const x1Arr = new Int32Array(dstW);
  const fxArr = new Float32Array(dstW);
  for (let x = 0; x < dstW; x++) {
    const gx = (x + 0.5) * scaleX - 0.5;
    const clamped = gx < 0 ? 0 : gx > maxSrcX ? maxSrcX : gx;
    const x0 = clamped | 0;
    const x1 = x0 < maxSrcX ? x0 + 1 : maxSrcX;
    x0Arr[x] = x0;
    x1Arr[x] = x1;
    fxArr[x] = clamped - x0;
  }

  for (let y = 0; y < dstH; y++) {
    const gy = (y + 0.5) * scaleY - 0.5;
    const clampedY = gy < 0 ? 0 : gy > maxSrcY ? maxSrcY : gy;
    const y0 = clampedY | 0;
    const y1 = y0 < maxSrcY ? y0 + 1 : maxSrcY;
    const fy = clampedY - y0;
    const invFy = 1 - fy;

    const row0 = y0 * srcW;
    const row1 = y1 * srcW;
    const dstRow = y * dstW;

    for (let x = 0; x < dstW; x++) {
      const x0 = x0Arr[x];
      const x1 = x1Arr[x];
      const fx = fxArr[x];
      const top = src[row0 + x0] + (src[row0 + x1] - src[row0 + x0]) * fx;
      const bot = src[row1 + x0] + (src[row1 + x1] - src[row1 + x0]) * fx;
      dst[dstRow + x] = (top * invFy + bot * fy + 0.5) | 0;
    }
  }

  return dst;
}

function rgbaToRgbBytes(rgba: Uint8ClampedArray): Uint8Array {
  const rgb = new Uint8Array(PIXEL_COUNT * 3);
  for (let i = 0, p = 0, q = 0; i < PIXEL_COUNT; i++, p += 4, q += 3) {
    rgb[q] = rgba[p];
    rgb[q + 1] = rgba[p + 1];
    rgb[q + 2] = rgba[p + 2];
  }
  return rgb;
}

const workerScope = self as DedicatedWorkerGlobalScope;

function postProgress(id: number, progress: ProcessingProgress): void {
  const msg: WorkerOutboundMessage = { type: 'progress', id, progress };
  workerScope.postMessage(msg);
}

workerScope.onmessage = async (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;

  if (msg.type === 'preload') {
    try {
      await ensureOnnxSession();
      workerScope.postMessage({ type: 'preloaded', ok: true } satisfies WorkerOutboundMessage);
    } catch {
      workerScope.postMessage({ type: 'preloaded', ok: false } satisfies WorkerOutboundMessage);
    }
    return;
  }

  if (msg.type === 'remove') {
    const { id, targetWidth, targetHeight, imageBitmap, rgba1024Buffer } = msg;
    let rgba1024: Uint8ClampedArray;

    try {
      if (imageBitmap) {
        try {
          rgba1024 = get1024RgbaFromBitmap(imageBitmap);
        } finally {
          imageBitmap.close();
        }
      } else if (rgba1024Buffer) {
        rgba1024 = new Uint8ClampedArray(rgba1024Buffer);
      } else {
        throw new Error('No image payload provided to background removal worker');
      }

      // Attempt 1: Local browser ONNX Runtime Web inside the Web Worker (zero UI freeze)
      try {
        const session = await ensureOnnxSession((progress) => postProgress(id, progress));

        postProgress(id, {
          stage: 'Working on it, give me a second...',
          percent: null,
        });

        if (!reusableFloatInput) {
          reusableFloatInput = new Float32Array(3 * PIXEL_COUNT);
        }
        const floatData = reusableFloatInput;
        const inv255 = 1 / 255;
        const gOffset = PIXEL_COUNT;
        const bOffset = PIXEL_COUNT * 2;

        for (let i = 0, p = 0; i < PIXEL_COUNT; i++, p += 4) {
          floatData[i] = rgba1024[p] * inv255 - 0.5;
          floatData[gOffset + i] = rgba1024[p + 1] * inv255 - 0.5;
          floatData[bOffset + i] = rgba1024[p + 2] * inv255 - 0.5;
        }

        const inputTensor = new ort.Tensor('float32', floatData, [
          1,
          3,
          MODEL_INPUT_SIZE,
          MODEL_INPUT_SIZE,
        ]);
        const inputName = session.inputNames[0];
        const outputName = session.outputNames[0];
        const results = await session.run({ [inputName]: inputTensor });
        const raw = results[outputName].data as Float32Array;

        let minVal = Infinity;
        let maxVal = -Infinity;
        for (let i = 0; i < PIXEL_COUNT; i++) {
          const v = raw[i];
          if (v < minVal) minVal = v;
          if (v > maxVal) maxVal = v;
        }
        const scale = maxVal - minVal > 1e-6 ? 255 / (maxVal - minVal) : 255;

        const alpha1024 = new Uint8Array(PIXEL_COUNT);
        for (let i = 0; i < PIXEL_COUNT; i++) {
          const v = (raw[i] - minVal) * scale;
          alpha1024[i] = v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
        }

        const finalAlpha = resizeAlphaMaskBilinear(
          alpha1024,
          MODEL_INPUT_SIZE,
          MODEL_INPUT_SIZE,
          targetWidth,
          targetHeight
        );

        const outBuffer = finalAlpha.buffer as ArrayBuffer;
        const resultMsg: WorkerOutboundMessage = {
          type: 'result',
          id,
          alphaBuffer: outBuffer,
          engine: 'browser-onnx',
        };
        // Immediately transfer result back — zero waiting for 100%
        workerScope.postMessage(resultMsg, [outBuffer]);
        return;
      } catch (browserErr) {
        // Attempt 2: Off-thread fallback to same-origin ONNX Runtime server endpoint
        postProgress(id, {
          stage: 'Working on it, give me a second...',
          percent: null,
        });

        const rgb1024 = rgbaToRgbBytes(rgba1024);
        const resp = await fetch('/api/remove-bg-mask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: rgb1024.buffer as ArrayBuffer,
        });

        if (!resp.ok) {
          const errTxt = await resp.text().catch(() => '');
          throw new Error(
            `AI background removal failed (HTTP ${resp.status}): ${errTxt || String(browserErr)}`
          );
        }

        const alphaBuf = await resp.arrayBuffer();
        const alpha1024 = new Uint8Array(alphaBuf);
        if (alpha1024.length !== PIXEL_COUNT) {
          throw new Error('Invalid alpha mask size returned by ONNX engine');
        }

        const finalAlpha = resizeAlphaMaskBilinear(
          alpha1024,
          MODEL_INPUT_SIZE,
          MODEL_INPUT_SIZE,
          targetWidth,
          targetHeight
        );

        const outBuffer = finalAlpha.buffer as ArrayBuffer;
        const resultMsg: WorkerOutboundMessage = {
          type: 'result',
          id,
          alphaBuffer: outBuffer,
          engine: 'server-onnx',
        };
        workerScope.postMessage(resultMsg, [outBuffer]);
      }
    } catch (err) {
      const errorMsg: WorkerOutboundMessage = {
        type: 'error',
        id,
        message: err instanceof Error ? err.message : 'Background removal failed unexpectedly',
      };
      workerScope.postMessage(errorMsg);
    }
  }
};
