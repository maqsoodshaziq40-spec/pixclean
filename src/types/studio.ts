export type ToolType = 'select' | 'erase' | 'restore' | 'crop' | 'pan' | 'zoom';

export type ViewMode = 'split' | 'result' | 'mask';

export type InspectorTab = 'cutout' | 'backdrop' | 'effects' | 'adjust' | 'transform';

export type CheckerboardTone = 'dark' | 'light';

export type AppTheme = 'light' | 'dark';

export type GridDivisions = 4 | 8 | 12 | 16;

export interface SnapGridSettings {
  enabled: boolean;
  divisions: GridDivisions;
}

export type BackgroundType = 'transparent' | 'original-blur' | 'color' | 'gradient' | 'image';

export type ImageFitMode = 'cover' | 'contain' | 'stretch';

export type ExportFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export interface CropRect {
  /** Normalized 0..1 coordinates in transformed space */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MattingSettings {
  feather: number; // 0..12 px
  edgeSmooth: number; // 0..100 %
  maskShift: number; // -10..10 px (choke / expand)
  decontaminate: boolean;
  invertMask: boolean;
}

export interface GradientSettings {
  type: 'linear' | 'radial';
  angle: number; // 0..360 deg
  color1: string;
  color2: string;
}

export interface BackgroundSettings {
  type: BackgroundType;
  color: string;
  gradient: GradientSettings;
  imageId: string | null; // built-in preset ID or 'custom'
  customImageUrl: string | null;
  imageFit: ImageFitMode;
  blur: number; // 0..40 px
}

export interface ShadowSettings {
  enabled: boolean;
  offsetX: number; // -80..80 px
  offsetY: number; // -80..80 px
  blur: number; // 0..100 px
  opacity: number; // 0..100 %
  color: string;
}

export interface OutlineSettings {
  enabled: boolean;
  width: number; // 1..40 px
  color: string;
  opacity: number; // 0..100 %
}

export interface EffectSettings {
  shadow: ShadowSettings;
  outline: OutlineSettings;
}

export interface AdjustmentSettings {
  brightness: number; // 0..200 (100 = neutral)
  contrast: number; // 0..200 (100 = neutral)
  saturation: number; // 0..200 (100 = neutral)
  warmth: number; // -50..50 (0 = neutral)
  exposure: number; // -50..50 (0 = neutral)
  highlights: number; // -100..100 (0 = neutral)
  shadows: number; // -100..100 (0 = neutral)
  vibrance: number; // -100..100 (0 = neutral)
  clarity: number; // 0..100 (0 = neutral)
  sharpness: number; // 0..100 (0 = neutral)
  denoise: number; // 0..100 (0 = neutral)
  blur: number; // 0..20 px (0 = neutral)
  applyTo: 'subject' | 'all';
}

export interface TransformSettings {
  rotate90: 0 | 90 | 180 | 270;
  straighten: number; // -45..45 deg
  flipH: boolean;
  flipV: boolean;
  offsetX: number; // -0.5..0.5 normalized stage width offset for cutout positioning
  offsetY: number; // -0.5..0.5 normalized stage height offset for cutout positioning
  crop: CropRect | null;
  resize: {
    enabled: boolean;
    width: number;
    height: number;
    lockAspect: boolean;
  };
}

export interface ImageEditSettings {
  matting: MattingSettings;
  background: BackgroundSettings;
  effects: EffectSettings;
  adjustments: AdjustmentSettings;
  transform: TransformSettings;
}

export interface BrushSettings {
  size: number; // 4..200 px (in source image pixels)
  hardness: number; // 0..100 %
}

export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: number;
  edits: ImageEditSettings;
  alphaSnapshot: Uint8Array;
  hasRemovedBg: boolean;
}

export interface ProcessingProgress {
  stage: string;
  /** Exact 0..100 byte-measured progress (e.g. model download), or null during native compute phases */
  percent: number | null;
  /** Optional real metric detail (e.g. "18.4 / 42.3 MB") */
  detail?: string;
}

export interface StudioImageItem {
  id: string;
  name: string;
  originalFileSize: number;
  width: number;
  height: number;
  sourceCanvas: HTMLCanvasElement;
  maskCanvas: HTMLCanvasElement;
  maskRevision: number;
  aiMaskSnapshot: Uint8Array | null;
  hasRemovedBg: boolean;
  status: 'idle' | 'processing' | 'done' | 'error';
  progress?: ProcessingProgress;
  errorMessage?: string;
  thumbnailUrl: string;
  edits: ImageEditSettings;
  history: HistoryEntry[];
  historyIndex: number;
}

export interface ExportOptions {
  format: ExportFormat;
  quality: number; // 10..100
  scaleMode: 'original' | '2x' | '0.5x' | 'custom';
  customWidth: number;
  customHeight: number;
  lockAspect: boolean;
}

export function createDefaultEdits(width: number, height: number): ImageEditSettings {
  return {
    matting: {
      feather: 0,
      edgeSmooth: 10,
      maskShift: 0,
      decontaminate: true,
      invertMask: false,
    },
    background: {
      type: 'transparent',
      color: '#FFFFFF',
      gradient: {
        type: 'linear',
        angle: 135,
        color1: '#4F46E5',
        color2: '#EC4899',
      },
      imageId: null,
      customImageUrl: null,
      imageFit: 'cover',
      blur: 0,
    },
    effects: {
      shadow: {
        enabled: false,
        offsetX: 0,
        offsetY: 18,
        blur: 28,
        opacity: 45,
        color: '#000000',
      },
      outline: {
        enabled: false,
        width: 10,
        color: '#FFFFFF',
        opacity: 100,
      },
    },
    adjustments: {
      brightness: 100,
      contrast: 100,
      saturation: 100,
      warmth: 0,
      exposure: 0,
      highlights: 0,
      shadows: 0,
      vibrance: 0,
      clarity: 0,
      sharpness: 0,
      denoise: 0,
      blur: 0,
      applyTo: 'subject',
    },
    transform: {
      rotate90: 0,
      straighten: 0,
      flipH: false,
      flipV: false,
      offsetX: 0,
      offsetY: 0,
      crop: null,
      resize: {
        enabled: false,
        width,
        height,
        lockAspect: true,
      },
    },
  };
}

export function cloneEdits(edits: ImageEditSettings): ImageEditSettings {
  return {
    matting: { ...edits.matting },
    background: {
      ...edits.background,
      gradient: { ...edits.background.gradient },
    },
    effects: {
      shadow: { ...edits.effects.shadow },
      outline: { ...edits.effects.outline },
    },
    adjustments: { ...edits.adjustments },
    transform: {
      ...edits.transform,
      crop: edits.transform.crop ? { ...edits.transform.crop } : null,
      resize: { ...edits.transform.resize },
    },
  };
}
