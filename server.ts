import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as ort from 'onnxruntime-web/wasm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

const RMBG_REMOTE_URL =
  'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx';
const MODEL_CACHE_FILE = '/tmp/chromacut-rmbg-1.4-quantized.onnx';
const ORT_DIST_DIR = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist');
const ALLOWED_ORT_FILES = new Set([
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
]);

let modelDownloadPromise: Promise<string> | null = null;
let serverOrtSession: ort.InferenceSession | null = null;
let serverOrtSessionPromise: Promise<ort.InferenceSession> | null = null;

async function ensureModelCachedOnDisk(): Promise<string> {
  if (fs.existsSync(MODEL_CACHE_FILE)) {
    const stat = fs.statSync(MODEL_CACHE_FILE);
    if (stat.size > 10_000_000) {
      return MODEL_CACHE_FILE;
    }
  }

  if (modelDownloadPromise) {
    return modelDownloadPromise;
  }

  modelDownloadPromise = (async () => {
    const tmpFile = `${MODEL_CACHE_FILE}.${Date.now()}.tmp`;
    const res = await fetch(RMBG_REMOTE_URL, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`Failed to fetch RMBG-1.4 ONNX model (HTTP ${res.status})`);
    }
    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength < 10_000_000) {
      throw new Error('Downloaded ONNX model appears incomplete');
    }
    fs.writeFileSync(tmpFile, Buffer.from(arrayBuf));
    fs.renameSync(tmpFile, MODEL_CACHE_FILE);
    return MODEL_CACHE_FILE;
  })();

  try {
    return await modelDownloadPromise;
  } finally {
    modelDownloadPromise = null;
  }
}

async function getServerOrtSession(): Promise<ort.InferenceSession> {
  if (serverOrtSession) return serverOrtSession;
  if (serverOrtSessionPromise) return serverOrtSessionPromise;

  serverOrtSessionPromise = (async () => {
    const modelPath = await ensureModelCachedOnDisk();
    const modelBytes = new Uint8Array(fs.readFileSync(modelPath));
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    serverOrtSession = session;
    return session;
  })();

  try {
    return await serverOrtSessionPromise;
  } catch (err) {
    serverOrtSessionPromise = null;
    throw err;
  }
}

async function startServer() {
  const app = express();

  // Serve exact matching ONNX Runtime Web WASM/MJS binaries directly (bypasses Vite /public restrictions)
  app.get('/api/ort/:file', (req, res) => {
    const file = req.params.file;
    if (!ALLOWED_ORT_FILES.has(file)) {
      res.status(404).send('Not found');
      return;
    }
    const fullPath = path.join(ORT_DIST_DIR, file);
    if (!fs.existsSync(fullPath)) {
      res.status(404).send('ORT binary missing');
      return;
    }
    res.setHeader(
      'Content-Type',
      file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8'
    );
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(fullPath);
  });

  // Same-origin cached streaming proxy for the RMBG-1.4 ONNX model (prevents browser CORS / ISP blocks)
  app.get('/api/model/rmbg-1.4.onnx', async (_req, res) => {
    try {
      const modelPath = await ensureModelCachedOnDisk();
      const stat = fs.statSync(modelPath);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      fs.createReadStream(modelPath).pipe(res);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to load ONNX model',
      });
    }
  });

  // Real ONNX Runtime Web fallback endpoint: receives 1024x1024 RGB bytes (3,145,728 bytes)
  // and returns 1024x1024 normalized alpha mask bytes (1,048,576 bytes)
  app.post(
    '/api/remove-bg-mask',
    express.raw({ type: 'application/octet-stream', limit: '6mb' }),
    async (req, res) => {
      try {
        const body = req.body as Buffer;
        const expectedLen = 1024 * 1024 * 3;
        if (!Buffer.isBuffer(body) || body.length !== expectedLen) {
          res.status(400).json({
            error: `Expected ${expectedLen} RGB bytes, got ${Buffer.isBuffer(body) ? body.length : 0}`,
          });
          return;
        }

        const session = await getServerOrtSession();
        const pixelCount = 1024 * 1024;
        const floatData = new Float32Array(3 * pixelCount);
        for (let i = 0; i < pixelCount; i++) {
          const j = i * 3;
          floatData[i] = body[j] / 255 - 0.5;
          floatData[pixelCount + i] = body[j + 1] / 255 - 0.5;
          floatData[2 * pixelCount + i] = body[j + 2] / 255 - 0.5;
        }

        const inputTensor = new ort.Tensor('float32', floatData, [1, 3, 1024, 1024]);
        const inputName = session.inputNames[0];
        const outputName = session.outputNames[0];
        const results = await session.run({ [inputName]: inputTensor });
        const raw = results[outputName].data as Float32Array;

        let minVal = Infinity;
        let maxVal = -Infinity;
        for (let i = 0; i < pixelCount; i++) {
          const v = raw[i];
          if (v < minVal) minVal = v;
          if (v > maxVal) maxVal = v;
        }
        const range = maxVal - minVal > 1e-6 ? maxVal - minVal : 1;

        const outAlpha = Buffer.allocUnsafe(pixelCount);
        for (let i = 0; i < pixelCount; i++) {
          const norm = Math.max(0, Math.min(1, (raw[i] - minVal) / range));
          outAlpha[i] = Math.round(norm * 255);
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(outAlpha.length));
        res.send(outAlpha);
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'ONNX inference failed',
        });
      }
    }
  );

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ChromaCut Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
