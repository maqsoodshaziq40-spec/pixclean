declare module 'onnxruntime-web/wasm' {
  export interface WasmEnvConfig {
    wasmPaths?:
      | string
      | {
          mjs?: string;
          wasm?: string;
        };
    numThreads?: number;
    proxy?: boolean;
    simd?: boolean;
    wasmBinary?: ArrayBuffer | Uint8Array;
  }

  export const env: {
    wasm: WasmEnvConfig;
    debug?: boolean;
    logLevel?: 'verbose' | 'info' | 'warning' | 'error' | 'fatal';
  };

  export class Tensor {
    readonly dims: readonly number[];
    readonly type: string;
    readonly data: Float32Array | Uint8Array | Int32Array | ArrayLike<number>;
    constructor(
      type: 'float32' | 'uint8' | 'int32' | 'bool',
      data: Float32Array | Uint8Array | Int32Array,
      dims: readonly number[]
    );
  }

  export interface SessionOptions {
    executionProviders?: readonly string[];
    graphOptimizationLevel?: 'disabled' | 'basic' | 'extended' | 'all';
  }

  export interface InferenceSession {
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
    release(): Promise<void>;
  }

  export namespace InferenceSession {
    function create(
      buffer: Uint8Array | ArrayBuffer | string,
      options?: SessionOptions
    ): Promise<InferenceSession>;
  }
}
