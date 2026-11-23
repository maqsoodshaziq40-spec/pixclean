import React, { useRef } from 'react';
import {
  Columns2,
  Crop,
  Download,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Grid3x3,
  Image as ImageIcon,
  Layers,
  Link2,
  Link2Off,
  Loader2,
  Paintbrush,
  Palette,
  RotateCcw,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  SunMedium,
  Upload,
  X,
} from 'lucide-react';
import { getRotatedDimensions } from '../engine/imagePipeline';
import { BACKDROP_PRESETS, GRADIENT_PRESETS, SOLID_SWATCHES } from '../engine/studioAssets';
import type {
  AdjustmentSettings,
  BrushSettings,
  CheckerboardTone,
  CropRect,
  GridDivisions,
  ImageEditSettings,
  InspectorTab,
  SnapGridSettings,
  StudioImageItem,
  ToolType,
  ViewMode,
} from '../types/studio';
import { StudioSlider } from './StudioSlider';

interface InspectorPanelProps {
  item: StudioImageItem | null;
  activeTab: InspectorTab;
  activeTool: ToolType;
  viewMode: ViewMode;
  brush: BrushSettings;
  checkerboard: CheckerboardTone;
  snapGrid: SnapGridSettings;
  desktopOpen: boolean;
  mobileOpen: boolean;
  onTabChange: (tab: InspectorTab) => void;
  onSelectTool: (tool: ToolType) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onBrushChange: (brush: BrushSettings) => void;
  onCheckerboardChange: (tone: CheckerboardTone) => void;
  onSnapGridChange: (grid: SnapGridSettings) => void;
  onCloseMobile: () => void;
  onTriggerAiRemove: () => void;
  onAutoEnhance: () => void;
  onQuickDownloadPng: () => void;
  onResetToAiMask: () => void;
  onRestoreFullMask: () => void;
  onUpdateEdits: (
    updater: (edits: ImageEditSettings) => ImageEditSettings,
    commitLabel?: string
  ) => void;
  onUploadCustomBg: (file: File) => void;
}

const TABS: Array<{
  id: InspectorTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'cutout', label: 'Cutout', icon: Scissors },
  { id: 'backdrop', label: 'Backdrop', icon: Palette },
  { id: 'effects', label: 'Effects', icon: Layers },
  { id: 'adjust', label: 'Enhance', icon: SunMedium },
  { id: 'transform', label: 'Transform', icon: Crop },
];

const RESIZE_PRESETS = [
  { label: '1080×1080', w: 1080, h: 1080 },
  { label: '1920×1080', w: 1920, h: 1080 },
  { label: '1080×1920', w: 1080, h: 1920 },
  { label: '1200×628', w: 1200, h: 628 },
];

const CROP_PRESETS: Array<{ label: string; ratio: number | null }> = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
];

interface EnhancePreset {
  id: string;
  label: string;
  desc: string;
  values: Omit<AdjustmentSettings, 'applyTo'>;
}

const ENHANCE_PRESETS: EnhancePreset[] = [
  {
    id: 'hd-crisp',
    label: 'HD Crisp',
    desc: 'Sharp detail & clarity',
    values: {
      brightness: 102,
      contrast: 112,
      saturation: 104,
      warmth: 0,
      exposure: 4,
      highlights: -10,
      shadows: 14,
      vibrance: 18,
      clarity: 42,
      sharpness: 62,
      denoise: 12,
      blur: 0,
    },
  },
  {
    id: 'portrait-glow',
    label: 'Portrait Glow',
    desc: 'Soft skin & warm light',
    values: {
      brightness: 105,
      contrast: 104,
      saturation: 102,
      warmth: 8,
      exposure: 8,
      highlights: -14,
      shadows: 24,
      vibrance: 16,
      clarity: 12,
      sharpness: 24,
      denoise: 34,
      blur: 0,
    },
  },
  {
    id: 'studio-pop',
    label: 'Studio Pop',
    desc: 'Vibrant product punch',
    values: {
      brightness: 103,
      contrast: 118,
      saturation: 110,
      warmth: 2,
      exposure: 6,
      highlights: -12,
      shadows: 18,
      vibrance: 34,
      clarity: 36,
      sharpness: 46,
      denoise: 10,
      blur: 0,
    },
  },
  {
    id: 'clean-denoise',
    label: 'Clean & Smooth',
    desc: 'Noise reduction + tone',
    values: {
      brightness: 102,
      contrast: 108,
      saturation: 102,
      warmth: 0,
      exposure: 5,
      highlights: -8,
      shadows: 20,
      vibrance: 14,
      clarity: 18,
      sharpness: 22,
      denoise: 60,
      blur: 0,
    },
  },
];

/* Soft warm terracotta pill switch */
const PillSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; label: string }> = ({
  checked,
  onChange,
  label,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
      checked ? 'bg-[#E06D3B]' : 'bg-[var(--switch-off)]'
    }`}
  >
    <span
      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
      }`}
    />
  </button>
);

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  item,
  activeTab,
  activeTool,
  viewMode,
  brush,
  checkerboard,
  snapGrid,
  desktopOpen,
  mobileOpen,
  onTabChange,
  onSelectTool,
  onViewModeChange,
  onBrushChange,
  onCheckerboardChange,
  onSnapGridChange,
  onCloseMobile,
  onTriggerAiRemove,
  onAutoEnhance,
  onQuickDownloadPng,
  onResetToAiMask,
  onRestoreFullMask,
  onUpdateEdits,
  onUploadCustomBg,
}) => {
  const customBgInputRef = useRef<HTMLInputElement>(null);

  const applyQuickCropRatio = (ratio: number | null) => {
    if (!item) return;
    if (ratio === null) {
      onSelectTool('crop');
      return;
    }
    const dims = getRotatedDimensions(item);
    const imgAspect = dims.width / Math.max(1, dims.height);
    const normRatio = ratio / imgAspect;
    let w = 1;
    let h = w / normRatio;
    if (h > 1) {
      h = 1;
      w = h * normRatio;
    }
    const crop: CropRect = {
      x: (1 - w) / 2,
      y: (1 - h) / 2,
      width: w,
      height: h,
    };
    onUpdateEdits(
      (e) => ({
        ...e,
        transform: { ...e.transform, crop },
      }),
      `Crop ${ratio}`
    );
  };

  const hasAnyEnhancement =
    !!item &&
    (item.edits.adjustments.brightness !== 100 ||
      item.edits.adjustments.contrast !== 100 ||
      item.edits.adjustments.saturation !== 100 ||
      item.edits.adjustments.warmth !== 0 ||
      item.edits.adjustments.exposure !== 0 ||
      item.edits.adjustments.highlights !== 0 ||
      item.edits.adjustments.shadows !== 0 ||
      item.edits.adjustments.vibrance !== 0 ||
      item.edits.adjustments.clarity > 0 ||
      item.edits.adjustments.sharpness > 0 ||
      item.edits.adjustments.denoise > 0 ||
      item.edits.adjustments.blur > 0);

  const panelBody = (
    <div className="flex flex-col h-full bg-[var(--bg-panel)] text-[var(--text-primary)] transition-colors">
      <input
        ref={customBgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp,image/avif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            onUploadCustomBg(f);
            e.target.value = '';
          }
        }}
      />

      {/* Mobile Drawer Header */}
      <div className="flex lg:hidden items-center justify-between px-4 py-3 border-b border-[var(--border-main)]">
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)]">
          <SlidersHorizontal className="w-4 h-4 text-[#E06D3B]" />
          <span>Photo Settings</span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close settings panel"
          className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 5-Tab Bar with warm terracotta underline indicator */}
      <div className="grid grid-cols-5 border-b border-[var(--border-main)] bg-[var(--bg-panel)] px-2 pt-1.5 shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 py-2 rounded-t-2xl text-[10px] font-bold transition-colors cursor-pointer border-b-2 ${
                active
                  ? 'text-[var(--text-accent)] border-[#E06D3B] bg-[var(--bg-accent-tint)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border-transparent hover:bg-[var(--bg-subtle)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto studio-scroll p-3.5 space-y-4 bg-[var(--bg-panel-alt)]">
        {!item ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-12 px-5">
            <div className="w-12 h-12 rounded-2xl bg-[var(--bg-accent-soft)] text-[var(--text-accent-bright)] flex items-center justify-center mb-3">
              <Layers className="w-6 h-6" />
            </div>
            <p className="font-display text-sm font-bold text-[var(--text-primary)]">
              No photo here yet
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
              Drop in a photo first — then you can remove backgrounds, pick new colors, and touch
              up lighting right here.
            </p>
          </div>
        ) : (
          <>
            {/* ================= TAB 1: CUTOUT ================= */}
            {activeTab === 'cutout' && (
              <div className="space-y-3.5">
                {/* One-Click Background Removal Hero Card */}
                <div className="rounded-[22px] bg-gradient-to-br from-[var(--bg-hero-from)] via-[var(--bg-hero-via)] to-[var(--bg-hero-to)] border border-[var(--border-accent)] p-4 shadow-[var(--shadow-accent)] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-[var(--bg-accent-soft)] text-[var(--text-accent-bright)] flex items-center justify-center shrink-0">
                        <Scissors className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-display text-xs font-bold text-[var(--text-primary)] truncate">
                          One-Click Cutout
                        </h3>
                        <p className="text-[11px] text-[var(--text-muted)] truncate">
                          Clean edges, zero hassle
                        </p>
                      </div>
                    </div>
                    {item.hasRemovedBg && (
                      <span className="text-[11px] font-bold text-[var(--emerald-text)] shrink-0">
                        Done
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={item.status === 'processing'}
                    onClick={onTriggerAiRemove}
                    className="studio-cta w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-full disabled:opacity-55 text-white text-xs font-bold cursor-pointer"
                  >
                    {item.status === 'processing' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="truncate">
                          {item.progress?.percent !== null && item.progress?.percent !== undefined
                            ? `Getting ready (${item.progress.percent}%)...`
                            : 'Working on it, give me a second...'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Scissors className="w-4 h-4" />
                        <span>
                          {item.hasRemovedBg ? 'Run Cutout Again' : 'Remove Background'}
                        </span>
                      </>
                    )}
                  </button>

                  {item.hasRemovedBg && (
                    <button
                      type="button"
                      onClick={onQuickDownloadPng}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-full bg-[var(--emerald-bg)] hover:bg-[var(--emerald-bg-hover)] border border-[var(--emerald-border)] text-[var(--emerald-text)] text-xs font-bold shadow-2xs transition-all cursor-pointer active:scale-[0.98]"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Save Clean PNG</span>
                    </button>
                  )}
                </div>

                {/* Fine Edge & Matte Refinement Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3.5">
                  <h3 className="text-xs font-bold text-[var(--text-primary)]">
                    Fine Edge &amp; Matte Quality
                  </h3>

                  <StudioSlider
                    label="Edge Feather"
                    value={item.edits.matting.feather}
                    min={0}
                    max={12}
                    step={0.5}
                    unit=" px"
                    defaultValue={0}
                    onChange={(feather) =>
                      onUpdateEdits((e) => ({ ...e, matting: { ...e.matting, feather } }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Edge Feather')}
                  />

                  <StudioSlider
                    label="Contour Smoothing"
                    value={item.edits.matting.edgeSmooth}
                    min={0}
                    max={100}
                    step={1}
                    unit="%"
                    defaultValue={10}
                    onChange={(edgeSmooth) =>
                      onUpdateEdits((e) => ({ ...e, matting: { ...e.matting, edgeSmooth } }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Contour Smoothing')}
                  />

                  <StudioSlider
                    label="Mask Shift (Choke / Expand)"
                    value={item.edits.matting.maskShift}
                    min={-10}
                    max={10}
                    step={0.5}
                    unit=" px"
                    defaultValue={0}
                    onChange={(maskShift) =>
                      onUpdateEdits((e) => ({ ...e, matting: { ...e.matting, maskShift } }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Mask Shift')}
                  />

                  <div className="pt-1 border-t border-[var(--border-divider)] space-y-2.5">
                    <div className="flex items-center justify-between gap-3 pt-1.5">
                      <div>
                        <div className="text-xs text-[var(--text-primary)] font-semibold">
                          Color Decontamination
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          Neutralize background color bounce
                        </div>
                      </div>
                      <PillSwitch
                        label="Color Decontamination"
                        checked={item.edits.matting.decontaminate}
                        onChange={(checked) =>
                          onUpdateEdits(
                            (e) => ({
                              ...e,
                              matting: { ...e.matting, decontaminate: checked },
                            }),
                            'Toggle Decontamination'
                          )
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs text-[var(--text-primary)] font-semibold">
                          Invert Cutout Mask
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          Swap foreground subject and background
                        </div>
                      </div>
                      <PillSwitch
                        label="Invert Cutout Mask"
                        checked={item.edits.matting.invertMask}
                        onChange={(checked) =>
                          onUpdateEdits(
                            (e) => ({
                              ...e,
                              matting: { ...e.matting, invertMask: checked },
                            }),
                            'Invert Mask'
                          )
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Manual Precision Brush Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-[var(--text-primary)]">
                      Manual Precision Brush
                    </h3>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      Shortcut: [ / ]
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectTool(activeTool === 'erase' ? 'select' : 'erase')}
                      className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        activeTool === 'erase'
                          ? 'bg-[var(--bg-accent-soft)] border-[#E06D3B] text-[var(--text-accent)] shadow-xs'
                          : 'bg-[var(--bg-subtle)] border-[var(--border-card)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <Eraser className="w-3.5 h-3.5" />
                      <span>Erase Area</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectTool(activeTool === 'restore' ? 'select' : 'restore')}
                      className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                        activeTool === 'restore'
                          ? 'bg-[var(--emerald-bg)] border-[var(--emerald-border)] text-[var(--emerald-text)] shadow-xs'
                          : 'bg-[var(--bg-subtle)] border-[var(--border-card)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <Paintbrush className="w-3.5 h-3.5" />
                      <span>Restore Area</span>
                    </button>
                  </div>

                  <StudioSlider
                    label="Brush Diameter"
                    value={brush.size}
                    min={4}
                    max={200}
                    step={1}
                    unit=" px"
                    defaultValue={36}
                    onChange={(size) => onBrushChange({ ...brush, size })}
                  />

                  <StudioSlider
                    label="Edge Hardness"
                    value={brush.hardness}
                    min={0}
                    max={100}
                    step={1}
                    unit="%"
                    defaultValue={70}
                    onChange={(hardness) => onBrushChange({ ...brush, hardness })}
                  />

                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={!item.aiMaskSnapshot}
                      onClick={onResetToAiMask}
                      className="py-1.5 px-2.5 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] text-[11px] font-medium text-[var(--text-secondary)] disabled:opacity-40 cursor-pointer"
                    >
                      Reset to AI Mask
                    </button>
                    <button
                      type="button"
                      onClick={onRestoreFullMask}
                      className="py-1.5 px-2.5 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] text-[11px] font-medium text-[var(--text-secondary)] cursor-pointer"
                    >
                      Restore Full Photo
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ================= TAB 2: BACKDROP ================= */}
            {activeTab === 'backdrop' && (
              <div className="space-y-3.5">
                {/* Mode Selector Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3">
                  <h3 className="text-xs font-bold text-[var(--text-primary)]">Background Mode</h3>
                  <div className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)]">
                    {(
                      [
                        { id: 'transparent', label: 'None' },
                        { id: 'original-blur', label: 'Blur' },
                        { id: 'color', label: 'Color' },
                        { id: 'gradient', label: 'Grad' },
                        { id: 'image', label: 'Image' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          onUpdateEdits((e) => {
                            const nextBg = { ...e.background, type: m.id };
                            if (m.id === 'original-blur' && nextBg.blur === 0) {
                              nextBg.blur = 14;
                            }
                            if (m.id === 'image' && !nextBg.imageId && !nextBg.customImageUrl) {
                              nextBg.imageId = BACKDROP_PRESETS[0].id;
                            }
                            return { ...e, background: nextBg };
                          }, `Backdrop: ${m.label}`)
                        }
                        className={`py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                          item.edits.background.type === m.id
                            ? 'bg-[#E06D3B] text-white shadow-xs'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {/* Transparent Options */}
                  {item.edits.background.type === 'transparent' && (
                    <div className="rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)] p-3 space-y-2.5">
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                        Transparent alpha channel active. Exports cleanly as transparent PNG or WebP.
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => onCheckerboardChange('light')}
                          className={`py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                            checkerboard === 'light'
                              ? 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)]'
                              : 'bg-[var(--bg-card)] border-[var(--border-card)] text-[var(--text-muted)]'
                          }`}
                        >
                          Light Grid
                        </button>
                        <button
                          type="button"
                          onClick={() => onCheckerboardChange('dark')}
                          className={`py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                            checkerboard === 'dark'
                              ? 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)]'
                              : 'bg-[var(--bg-card)] border-[var(--border-card)] text-[var(--text-muted)]'
                          }`}
                        >
                          Dark Grid
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Original Bokeh Blur Options */}
                  {item.edits.background.type === 'original-blur' && (
                    <div className="space-y-3 pt-1">
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Keeps your original background softly blurred behind the crisp foreground subject.
                      </p>
                      <StudioSlider
                        label="Background Blur Intensity"
                        value={item.edits.background.blur}
                        min={0}
                        max={40}
                        step={1}
                        unit=" px"
                        defaultValue={14}
                        onChange={(blur) =>
                          onUpdateEdits((e) => ({
                            ...e,
                            background: { ...e.background, blur },
                          }))
                        }
                        onCommit={() => onUpdateEdits((e) => e, 'Background Blur')}
                      />
                    </div>
                  )}

                  {/* Solid Color Options */}
                  {item.edits.background.type === 'color' && (
                    <div className="space-y-3.5 pt-1">
                      <div className="grid grid-cols-4 gap-2">
                        {SOLID_SWATCHES.map((hex) => {
                          const active =
                            item.edits.background.color.toLowerCase() === hex.toLowerCase();
                          return (
                            <button
                              key={hex}
                              type="button"
                              onClick={() =>
                                onUpdateEdits(
                                  (e) => ({ ...e, background: { ...e.background, color: hex } }),
                                  `Color ${hex}`
                                )
                              }
                              style={{ backgroundColor: hex }}
                              title={hex}
                              className={`h-9 rounded-xl border cursor-pointer transition-transform ${
                                active
                                  ? 'border-[#E06D3B] ring-2 ring-[#E06D3B]/35 scale-[1.03]'
                                  : 'border-[var(--border-strong)] hover:scale-[1.02]'
                              }`}
                            />
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={item.edits.background.color}
                          onChange={(ev) =>
                            onUpdateEdits(
                              (e) => ({
                                ...e,
                                background: { ...e.background, color: ev.target.value },
                              }),
                              'Background Color'
                            )
                          }
                          className="w-10 h-9 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] p-0.5 cursor-pointer shrink-0"
                        />
                        <input
                          type="text"
                          value={item.edits.background.color.toUpperCase()}
                          onChange={(ev) => {
                            const val = ev.target.value;
                            if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                              onUpdateEdits((e) => ({
                                ...e,
                                background: { ...e.background, color: val },
                              }));
                            }
                          }}
                          className="flex-1 h-9 px-3 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] font-mono text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#E06D3B] focus:bg-[var(--bg-input-focus)]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Gradient Options */}
                  {item.edits.background.type === 'gradient' && (
                    <div className="space-y-4 pt-1">
                      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)]">
                        {(['linear', 'radial'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() =>
                              onUpdateEdits(
                                (e) => ({
                                  ...e,
                                  background: {
                                    ...e.background,
                                    gradient: { ...e.background.gradient, type: t },
                                  },
                                }),
                                `Gradient ${t}`
                              )
                            }
                            className={`py-1.5 rounded-lg text-xs font-semibold capitalize cursor-pointer ${
                              item.edits.background.gradient.type === t
                                ? 'bg-[var(--bg-card)] text-[var(--text-accent)] border border-[var(--border-accent)] shadow-xs'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="space-y-1 text-[11px] font-medium text-[var(--text-muted)]">
                          <span>Start Color</span>
                          <div className="flex items-center gap-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl p-1.5">
                            <input
                              type="color"
                              value={item.edits.background.gradient.color1}
                              onChange={(ev) =>
                                onUpdateEdits((e) => ({
                                  ...e,
                                  background: {
                                    ...e.background,
                                    gradient: { ...e.background.gradient, color1: ev.target.value },
                                  },
                                }))
                              }
                              className="w-7 h-6 rounded cursor-pointer bg-transparent"
                            />
                            <span className="font-mono text-[11px] text-[var(--text-secondary)] uppercase">
                              {item.edits.background.gradient.color1}
                            </span>
                          </div>
                        </label>

                        <label className="space-y-1 text-[11px] font-medium text-[var(--text-muted)]">
                          <span>End Color</span>
                          <div className="flex items-center gap-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl p-1.5">
                            <input
                              type="color"
                              value={item.edits.background.gradient.color2}
                              onChange={(ev) =>
                                onUpdateEdits((e) => ({
                                  ...e,
                                  background: {
                                    ...e.background,
                                    gradient: { ...e.background.gradient, color2: ev.target.value },
                                  },
                                }))
                              }
                              className="w-7 h-6 rounded cursor-pointer bg-transparent"
                            />
                            <span className="font-mono text-[11px] text-[var(--text-secondary)] uppercase">
                              {item.edits.background.gradient.color2}
                            </span>
                          </div>
                        </label>
                      </div>

                      {item.edits.background.gradient.type === 'linear' && (
                        <StudioSlider
                          label="Gradient Angle"
                          value={item.edits.background.gradient.angle}
                          min={0}
                          max={360}
                          step={1}
                          unit="°"
                          defaultValue={135}
                          onChange={(angle) =>
                            onUpdateEdits((e) => ({
                              ...e,
                              background: {
                                ...e.background,
                                gradient: { ...e.background.gradient, angle },
                              },
                            }))
                          }
                          onCommit={() => onUpdateEdits((e) => e, 'Gradient Angle')}
                        />
                      )}

                      <div className="space-y-2">
                        <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                          Presets
                        </span>
                        <div className="grid grid-cols-3 gap-2">
                          {GRADIENT_PRESETS.map((preset) => (
                            <button
                              key={preset.name}
                              type="button"
                              onClick={() =>
                                onUpdateEdits(
                                  (e) => ({
                                    ...e,
                                    background: {
                                      ...e.background,
                                      gradient: {
                                        type: preset.type,
                                        angle: preset.angle,
                                        color1: preset.color1,
                                        color2: preset.color2,
                                      },
                                    },
                                  }),
                                  `Gradient: ${preset.name}`
                                )
                              }
                              style={{
                                background:
                                  preset.type === 'radial'
                                    ? `radial-gradient(circle, ${preset.color1}, ${preset.color2})`
                                    : `linear-gradient(${preset.angle}deg, ${preset.color1}, ${preset.color2})`,
                              }}
                              title={preset.name}
                              className="h-10 rounded-xl border border-[var(--border-strong)] hover:border-[#E06D3B] shadow-xs cursor-pointer"
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Image Backdrop Options */}
                  {item.edits.background.type === 'image' && (
                    <div className="space-y-4 pt-1">
                      <button
                        type="button"
                        onClick={() => customBgInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-full bg-[var(--bg-accent-tint)] hover:bg-[var(--bg-accent-soft)] border border-dashed border-[var(--border-accent-dashed)] hover:border-[#E06D3B] text-xs font-bold text-[var(--text-accent)] transition-colors cursor-pointer"
                      >
                        <Upload className="w-4 h-4 text-[#E06D3B]" />
                        <span>Use Your Own Photo</span>
                      </button>

                      <div className="space-y-2">
                        <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                          Studio Backdrops
                        </span>
                        <div className="grid grid-cols-2 gap-2">
                          {BACKDROP_PRESETS.map((preset) => {
                            const active = item.edits.background.imageId === preset.id;
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() =>
                                  onUpdateEdits(
                                    (e) => ({
                                      ...e,
                                      background: {
                                        ...e.background,
                                        type: 'image',
                                        imageId: preset.id,
                                      },
                                    }),
                                    `Backdrop: ${preset.name}`
                                  )
                                }
                                className={`group relative h-14 rounded-xl overflow-hidden border text-left p-2 flex items-end cursor-pointer ${
                                  active
                                    ? 'border-[#E06D3B] ring-2 ring-[#E06D3B]/35'
                                    : 'border-[var(--border-strong)] hover:border-[#E89B75]'
                                }`}
                                style={{ background: preset.previewCss }}
                              >
                                <span className="text-[10px] font-semibold text-white bg-[#1B1D2A]/70 px-1.5 py-0.5 rounded-md backdrop-blur-xs">
                                  {preset.name}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                          Image Fit
                        </span>
                        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)]">
                          {(['cover', 'contain', 'stretch'] as const).map((fit) => (
                            <button
                              key={fit}
                              type="button"
                              onClick={() =>
                                onUpdateEdits(
                                  (e) => ({
                                    ...e,
                                    background: { ...e.background, imageFit: fit },
                                  }),
                                  `Image Fit: ${fit}`
                                )
                              }
                              className={`py-1.5 rounded-lg text-[11px] font-semibold capitalize cursor-pointer ${
                                item.edits.background.imageFit === fit
                                  ? 'bg-[var(--bg-card)] text-[var(--text-accent)] border border-[var(--border-accent)] shadow-xs'
                                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                              }`}
                            >
                              {fit}
                            </button>
                          ))}
                        </div>
                      </div>

                      <StudioSlider
                        label="Backdrop Blur"
                        value={item.edits.background.blur}
                        min={0}
                        max={40}
                        step={1}
                        unit=" px"
                        defaultValue={0}
                        onChange={(blur) =>
                          onUpdateEdits((e) => ({
                            ...e,
                            background: { ...e.background, blur },
                          }))
                        }
                        onCommit={() => onUpdateEdits((e) => e, 'Backdrop Blur')}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ================= TAB 3: EFFECTS ================= */}
            {activeTab === 'effects' && (
              <div className="space-y-3.5">
                {/* Drop Shadow Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--text-primary)]">Drop Shadow</span>
                    <PillSwitch
                      label="Enable Drop Shadow"
                      checked={item.edits.effects.shadow.enabled}
                      onChange={(checked) =>
                        onUpdateEdits(
                          (e) => ({
                            ...e,
                            effects: {
                              ...e.effects,
                              shadow: { ...e.effects.shadow, enabled: checked },
                            },
                          }),
                          'Toggle Drop Shadow'
                        )
                      }
                    />
                  </div>

                  {item.edits.effects.shadow.enabled && (
                    <div className="space-y-3 pt-1 border-t border-[var(--border-divider)]">
                      <div className="flex items-center justify-between text-xs pt-2">
                        <span className="text-[var(--text-secondary)] font-medium">
                          Shadow Color
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={item.edits.effects.shadow.color}
                            onChange={(ev) =>
                              onUpdateEdits((e) => ({
                                ...e,
                                effects: {
                                  ...e.effects,
                                  shadow: { ...e.effects.shadow, color: ev.target.value },
                                },
                              }))
                            }
                            className="w-7 h-6 rounded-md bg-[var(--bg-input)] border border-[var(--border-card)] cursor-pointer"
                          />
                          <span className="font-mono text-[11px] text-[var(--text-muted)] uppercase">
                            {item.edits.effects.shadow.color}
                          </span>
                        </div>
                      </div>

                      <StudioSlider
                        label="Opacity"
                        value={item.edits.effects.shadow.opacity}
                        min={0}
                        max={100}
                        unit="%"
                        defaultValue={45}
                        onChange={(opacity) =>
                          onUpdateEdits((e) => ({
                            ...e,
                            effects: {
                              ...e.effects,
                              shadow: { ...e.effects.shadow, opacity },
                            },
                          }))
                        }
                        onCommit={() => onUpdateEdits((e) => e, 'Shadow Opacity')}
                      />

                      <StudioSlider
                        label="Blur Radius"
                        value={item.edits.effects.shadow.blur}
                        min={0}
                        max={100}
                        unit=" px"
                        defaultValue={28}
                        onChange={(blur) =>
                          onUpdateEdits((e) => ({
                            ...e,
                            effects: {
                              ...e.effects,
                              shadow: { ...e.effects.shadow, blur },
                            },
                          }))
                        }
                        onCommit={() => onUpdateEdits((e) => e, 'Shadow Blur')}
                      />

                      <StudioSlider
                        label="Offset X"
                        value={item.edits.effects.shadow.offsetX}
                        min={-80}
                        max={80}
                        unit=" px"
                        defaultValue={0}
                        onChange={(offsetX) =>
                          onUpdateEdits((e) => ({
                            ...e,
                            effects: {
                              ...e.effects,
                              shadow: { ...e.effects.shadow, offsetX },
                            },
                          }))
                        }
                        onCommit={() => onUpdateEdits((e) => e, 'Shadow X')}
                      />

                      <StudioSlider
                        label="Offset Y"
                        value={item.edits.effects.shadow.offsetY}
                        min={-80}
                        max={80}
                        unit=" px"
                        defaultValue={18}
                        onChange={(offsetY) =>
                          onUpdateEdits((e) => ({
                            ...e,
                            effects: {
                              ...e.effects,
                              shadow: { ...e.effects.shadow, offsetY },
                            },
                          }))
                        }
                        onCommit={() => onUpdateEdits((e) => e, 'Shadow Y')}
                      />
                    </div>
                  )}
                </div>

                {/* Subject Outline / Sticker Stroke Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--text-primary)]">
                      Subject Outline
                    </span>
                    <PillSwitch
                      label="Enable Subject Outline"
                      checked={item.edits.effects.outline.enabled}
                      onChange={(checked) =>
                        onUpdateEdits(
                          (e) => ({
                            ...e,
                            effects: {
                              ...e.effects,
                              outline: { ...e.effects.outline, enabled: checked },
                            },
                          }),
                          'Toggle Outline'
                        )
                      }
                    />
                  </div>

                  {item.edits.effects.outline.enabled && (
                    <div className="space-y-3 pt-1 border-t border-[var(--border-divider)]">
                      <div className="flex items-center justify-between text-xs pt-2">
                        <span className="text-[var(--text-secondary)] font-medium">
                          Stroke Color
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={item.edits.effects.outline.color}
                            onChange={(ev) =>
                              onUpdateEdits((e) => ({
                                ...e,
                                effects: {
                                  ...e.effects,
                                  outline: { ...e.effects.outline, color: ev.target.value },
                                },
                              }))
                            }
                            className="w-7 h-6 rounded-md bg-[var(--bg-input)] border border-[var(--border-card)] cursor-pointer"
                          />
                          <span className="font-mono text-[11px] text-[var(--text-muted)] uppercase">
                            {item.edits.effects.outline.color}
                          </span>
                        </div>
                      </div>

                      <StudioSlider
                        label="Stroke Width"
                        value={item.edits.effects.outline.width}
                        min={1}
                        max={40}
                        unit=" px"
                        defaultValue={10}
                        onChange={(width) =>
                          onUpdateEdits((e) => ({
                            ...e,
                            effects: {
                              ...e.effects,
                              outline: { ...e.effects.outline, width },
                            },
                          }))
                        }
                        onCommit={() => onUpdateEdits((e) => e, 'Outline Width')}
                      />

                      <StudioSlider
                        label="Stroke Opacity"
                        value={item.edits.effects.outline.opacity}
                        min={0}
                        max={100}
                        unit="%"
                        defaultValue={100}
                        onChange={(opacity) =>
                          onUpdateEdits((e) => ({
                            ...e,
                            effects: {
                              ...e.effects,
                              outline: { ...e.effects.outline, opacity },
                            },
                          }))
                        }
                        onCommit={() => onUpdateEdits((e) => e, 'Outline Opacity')}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ================= TAB 4: IMAGE ENHANCER ================= */}
            {activeTab === 'adjust' && (
              <div className="space-y-3.5">
                {/* One-Click Auto Enhance Hero Card */}
                <div className="rounded-[22px] bg-gradient-to-br from-[var(--bg-hero-from)] via-[var(--bg-hero-via)] to-[var(--bg-hero-to)] border border-[var(--border-accent)] p-4 shadow-[var(--shadow-accent)] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-[var(--bg-accent-soft)] text-[var(--text-accent-bright)] flex items-center justify-center shrink-0">
                        <SunMedium className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-display text-xs font-bold text-[var(--text-primary)] truncate">
                          Enhance Photo
                        </h3>
                        <p className="text-[11px] text-[var(--text-muted)] truncate">
                          Natural light, crisp clarity &amp; detail
                        </p>
                      </div>
                    </div>
                    {hasAnyEnhancement && (
                      <span className="text-[11px] font-bold text-[var(--emerald-text)] shrink-0">
                        Active
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onAutoEnhance}
                      className="studio-cta flex-1 flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-full text-white text-xs font-bold cursor-pointer"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>Auto Enhance</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onViewModeChange(viewMode === 'split' ? 'result' : 'split')}
                      title="Compare before and after"
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-full text-xs font-bold border transition-all cursor-pointer shrink-0 active:scale-95 ${
                        viewMode === 'split'
                          ? 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)]'
                          : 'bg-[var(--bg-card)] hover:bg-[var(--bg-subtle)] border-[var(--border-card)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <Columns2 className="w-3.5 h-3.5" />
                      <span>Compare</span>
                    </button>
                  </div>

                  {/* Quick Studio Enhance Presets */}
                  <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                    {ENHANCE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          onUpdateEdits(
                            (e) => ({
                              ...e,
                              adjustments: {
                                ...e.adjustments,
                                ...preset.values,
                              },
                            }),
                            `Enhance: ${preset.label}`
                          )
                        }
                        className="text-left px-2.5 py-2 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-accent-soft)] border border-[var(--border-card)] hover:border-[var(--border-accent)] hover:shadow-xs transition-all cursor-pointer active:scale-[0.98]"
                      >
                        <div className="text-[11px] font-bold text-[var(--text-primary)] truncate">
                          {preset.label}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] truncate">
                          {preset.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Detail & Clarity Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-[var(--text-primary)]">
                      Detail &amp; Clarity
                    </h3>
                    <span className="text-[10px] font-medium text-[var(--text-muted)]">
                      HD Pixel Engine
                    </span>
                  </div>

                  <StudioSlider
                    label="Sharpness (Unsharp Mask)"
                    value={item.edits.adjustments.sharpness}
                    min={0}
                    max={100}
                    unit="%"
                    defaultValue={0}
                    onChange={(sharpness) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, sharpness },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Sharpness')}
                  />

                  <StudioSlider
                    label="Clarity (Micro-Contrast)"
                    value={item.edits.adjustments.clarity}
                    min={0}
                    max={100}
                    unit="%"
                    defaultValue={0}
                    onChange={(clarity) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, clarity },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Clarity')}
                  />

                  <StudioSlider
                    label="Denoise (Edge-Preserving)"
                    value={item.edits.adjustments.denoise}
                    min={0}
                    max={100}
                    unit="%"
                    defaultValue={0}
                    onChange={(denoise) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, denoise },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Denoise')}
                  />

                  <StudioSlider
                    label="Blur"
                    value={item.edits.adjustments.blur}
                    min={0}
                    max={20}
                    step={0.5}
                    unit="px"
                    defaultValue={0}
                    onChange={(blur) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, blur },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Blur')}
                  />
                </div>

                {/* Light & Tone Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3.5">
                  <h3 className="text-xs font-bold text-[var(--text-primary)]">Light &amp; Tone</h3>

                  <StudioSlider
                    label="Exposure"
                    value={item.edits.adjustments.exposure}
                    min={-50}
                    max={50}
                    unit=""
                    defaultValue={0}
                    onChange={(exposure) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, exposure },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Exposure')}
                  />

                  <StudioSlider
                    label="Brightness"
                    value={item.edits.adjustments.brightness}
                    min={0}
                    max={200}
                    unit="%"
                    defaultValue={100}
                    onChange={(brightness) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, brightness },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Brightness')}
                  />

                  <StudioSlider
                    label="Contrast"
                    value={item.edits.adjustments.contrast}
                    min={0}
                    max={200}
                    unit="%"
                    defaultValue={100}
                    onChange={(contrast) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, contrast },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Contrast')}
                  />

                  <StudioSlider
                    label="Shadows Recovery"
                    value={item.edits.adjustments.shadows}
                    min={-100}
                    max={100}
                    unit=""
                    defaultValue={0}
                    onChange={(shadows) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, shadows },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Shadows')}
                  />

                  <StudioSlider
                    label="Highlights Recovery"
                    value={item.edits.adjustments.highlights}
                    min={-100}
                    max={100}
                    unit=""
                    defaultValue={0}
                    onChange={(highlights) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, highlights },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Highlights')}
                  />
                </div>

                {/* Color & Scope Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3.5">
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-[var(--text-primary)]">
                      Color &amp; Scope
                    </span>
                    <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)]">
                      {(
                        [
                          { id: 'subject', label: 'Subject Only' },
                          { id: 'all', label: 'Whole Image' },
                        ] as const
                      ).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            onUpdateEdits(
                              (e) => ({
                                ...e,
                                adjustments: { ...e.adjustments, applyTo: s.id },
                              }),
                              `Enhance Scope: ${s.label}`
                            )
                          }
                          className={`py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                            item.edits.adjustments.applyTo === s.id
                              ? 'bg-[var(--bg-card)] text-[var(--text-accent)] border border-[var(--border-accent)] shadow-xs'
                              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <StudioSlider
                    label="Smart Vibrance"
                    value={item.edits.adjustments.vibrance}
                    min={-100}
                    max={100}
                    unit=""
                    defaultValue={0}
                    onChange={(vibrance) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, vibrance },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Vibrance')}
                  />

                  <StudioSlider
                    label="Saturation"
                    value={item.edits.adjustments.saturation}
                    min={0}
                    max={200}
                    unit="%"
                    defaultValue={100}
                    onChange={(saturation) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, saturation },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Saturation')}
                  />

                  <StudioSlider
                    label="Color Warmth"
                    value={item.edits.adjustments.warmth}
                    min={-50}
                    max={50}
                    unit=""
                    defaultValue={0}
                    onChange={(warmth) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        adjustments: { ...e.adjustments, warmth },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Color Warmth')}
                  />

                  <button
                    type="button"
                    disabled={!hasAnyEnhancement}
                    onClick={() =>
                      onUpdateEdits(
                        (e) => ({
                          ...e,
                          adjustments: {
                            ...e.adjustments,
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
                          },
                        }),
                        'Reset Enhancements'
                      )
                    }
                    className="w-full py-2 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] text-xs font-semibold text-[var(--text-secondary)] disabled:opacity-40 cursor-pointer transition-colors"
                  >
                    Reset All Enhancements
                  </button>
                </div>
              </div>
            )}

            {/* ================= TAB 5: TRANSFORM ================= */}
            {activeTab === 'transform' && (
              <div className="space-y-3.5">
                {/* Crop Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-[var(--text-primary)]">Crop Canvas</h3>
                    {item.edits.transform.crop && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateEdits(
                            (e) => ({ ...e, transform: { ...e.transform, crop: null } }),
                            'Clear Crop'
                          )
                        }
                        className="text-[11px] font-semibold text-[var(--rose-text)] hover:opacity-80 cursor-pointer"
                      >
                        Clear Crop
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectTool(activeTool === 'crop' ? 'select' : 'crop')}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                      activeTool === 'crop'
                        ? 'bg-[#E06D3B] border-[#E06D3B] text-white shadow-sm shadow-[#E06D3B]/25'
                        : 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)] hover:bg-[var(--bg-accent-soft-hover)]'
                    }`}
                  >
                    <Crop className="w-3.5 h-3.5" />
                    <span>{activeTool === 'crop' ? 'Editing Crop on Canvas' : 'Interactive Crop (C)'}</span>
                  </button>

                  <div className="grid grid-cols-3 gap-1.5">
                    {CROP_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => applyQuickCropRatio(p.ratio)}
                        className="py-1.5 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] text-[11px] font-semibold text-[var(--text-secondary)] cursor-pointer"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Rotate & Flip Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3">
                  <h3 className="text-xs font-bold text-[var(--text-primary)]">Rotate &amp; Flip</h3>
                  <div className="grid grid-cols-4 gap-1.5">
                    <button
                      type="button"
                      title="Rotate Left 90°"
                      onClick={() =>
                        onUpdateEdits((e) => {
                          const next = ((e.transform.rotate90 + 270) % 360) as 0 | 90 | 180 | 270;
                          return { ...e, transform: { ...e.transform, rotate90: next } };
                        }, 'Rotate -90°')
                      }
                      className="flex flex-col items-center justify-center gap-1 py-2 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] text-[10px] font-semibold text-[var(--text-secondary)] cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>-90°</span>
                    </button>

                    <button
                      type="button"
                      title="Rotate Right 90°"
                      onClick={() =>
                        onUpdateEdits((e) => {
                          const next = ((e.transform.rotate90 + 90) % 360) as 0 | 90 | 180 | 270;
                          return { ...e, transform: { ...e.transform, rotate90: next } };
                        }, 'Rotate +90°')
                      }
                      className="flex flex-col items-center justify-center gap-1 py-2 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] text-[10px] font-semibold text-[var(--text-secondary)] cursor-pointer"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>+90°</span>
                    </button>

                    <button
                      type="button"
                      title="Flip Horizontal"
                      onClick={() =>
                        onUpdateEdits(
                          (e) => ({
                            ...e,
                            transform: { ...e.transform, flipH: !e.transform.flipH },
                          }),
                          'Flip Horizontal'
                        )
                      }
                      className={`flex flex-col items-center justify-center gap-1 py-2 rounded-xl border text-[10px] font-semibold cursor-pointer ${
                        item.edits.transform.flipH
                          ? 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)]'
                          : 'bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border-[var(--border-card)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <FlipHorizontal2 className="w-3.5 h-3.5" />
                      <span>Flip H</span>
                    </button>

                    <button
                      type="button"
                      title="Flip Vertical"
                      onClick={() =>
                        onUpdateEdits(
                          (e) => ({
                            ...e,
                            transform: { ...e.transform, flipV: !e.transform.flipV },
                          }),
                          'Flip Vertical'
                        )
                      }
                      className={`flex flex-col items-center justify-center gap-1 py-2 rounded-xl border text-[10px] font-semibold cursor-pointer ${
                        item.edits.transform.flipV
                          ? 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)]'
                          : 'bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border-[var(--border-card)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <FlipVertical2 className="w-3.5 h-3.5" />
                      <span>Flip V</span>
                    </button>
                  </div>

                  <StudioSlider
                    label="Straighten"
                    value={item.edits.transform.straighten}
                    min={-45}
                    max={45}
                    step={0.5}
                    unit="°"
                    defaultValue={0}
                    onChange={(straighten) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        transform: { ...e.transform, straighten },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Straighten')}
                  />
                </div>

                {/* Subject Position & Snap-to-Grid Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Grid3x3 className="w-3.5 h-3.5 text-[#E06D3B]" />
                      <h3 className="text-xs font-bold text-[var(--text-primary)]">
                        Position &amp; Snap Grid
                      </h3>
                    </div>
                    {(item.edits.transform.offsetX !== 0 ||
                      item.edits.transform.offsetY !== 0) && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateEdits(
                            (e) => ({
                              ...e,
                              transform: { ...e.transform, offsetX: 0, offsetY: 0 },
                            }),
                            'Center Subject'
                          )
                        }
                        className="text-[11px] font-semibold text-[var(--text-accent-bright)] hover:opacity-80 cursor-pointer"
                      >
                        Center
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 py-0.5">
                    <div>
                      <div className="text-xs text-[var(--text-primary)] font-semibold">
                        Snap-to-Grid Overlay
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        Snap subject, crop &amp; split divider (G)
                      </div>
                    </div>
                    <PillSwitch
                      label="Snap-to-Grid Overlay"
                      checked={snapGrid.enabled}
                      onChange={(checked) => onSnapGridChange({ ...snapGrid, enabled: checked })}
                    />
                  </div>

                  {snapGrid.enabled && (
                    <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)]">
                      {([4, 8, 12, 16] as GridDivisions[]).map((div) => (
                        <button
                          key={div}
                          type="button"
                          onClick={() => onSnapGridChange({ ...snapGrid, divisions: div })}
                          className={`py-1 rounded-lg font-mono text-[11px] font-bold cursor-pointer transition-all ${
                            snapGrid.divisions === div
                              ? 'bg-[#E06D3B] text-white shadow-xs'
                              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {div}×{div}
                        </button>
                      ))}
                    </div>
                  )}

                  <StudioSlider
                    label="Subject Offset X"
                    value={Math.round((item.edits.transform.offsetX || 0) * 100)}
                    min={-50}
                    max={50}
                    step={1}
                    unit="%"
                    defaultValue={0}
                    disabled={!item.hasRemovedBg}
                    onChange={(pct) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        transform: { ...e.transform, offsetX: pct / 100 },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Reposition Subject X')}
                  />

                  <StudioSlider
                    label="Subject Offset Y"
                    value={Math.round((item.edits.transform.offsetY || 0) * 100)}
                    min={-50}
                    max={50}
                    step={1}
                    unit="%"
                    defaultValue={0}
                    disabled={!item.hasRemovedBg}
                    onChange={(pct) =>
                      onUpdateEdits((e) => ({
                        ...e,
                        transform: { ...e.transform, offsetY: pct / 100 },
                      }))
                    }
                    onCommit={() => onUpdateEdits((e) => e, 'Reposition Subject Y')}
                  />
                </div>

                {/* Resize Output Card */}
                <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-3.5 shadow-[var(--shadow-card)] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5 text-[#E06D3B]" />
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        Custom Resize
                      </span>
                    </div>
                    <PillSwitch
                      label="Enable Custom Resize"
                      checked={item.edits.transform.resize.enabled}
                      onChange={(checked) =>
                        onUpdateEdits(
                          (e) => ({
                            ...e,
                            transform: {
                              ...e.transform,
                              resize: { ...e.transform.resize, enabled: checked },
                            },
                          }),
                          'Toggle Resize'
                        )
                      }
                    />
                  </div>

                  {item.edits.transform.resize.enabled && (
                    <div className="space-y-3 pt-1">
                      <div className="flex items-end gap-2">
                        <label className="flex-1 space-y-1 text-[11px] font-medium text-[var(--text-muted)]">
                          <span>Width (px)</span>
                          <input
                            type="number"
                            min={16}
                            max={4096}
                            value={item.edits.transform.resize.width}
                            onChange={(ev) => {
                              const w = Math.max(
                                16,
                                Math.min(4096, parseInt(ev.target.value, 10) || 16)
                              );
                              const aspect = item.width / Math.max(1, item.height);
                              onUpdateEdits(
                                (e) => ({
                                  ...e,
                                  transform: {
                                    ...e.transform,
                                    resize: {
                                      ...e.transform.resize,
                                      width: w,
                                      height: e.transform.resize.lockAspect
                                        ? Math.max(16, Math.round(w / aspect))
                                        : e.transform.resize.height,
                                    },
                                  },
                                }),
                                'Resize Width'
                              );
                            }}
                            className="w-full h-9 px-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] font-mono tabular-nums text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#E06D3B] focus:bg-[var(--bg-input-focus)]"
                          />
                        </label>

                        <button
                          type="button"
                          title="Lock Aspect Ratio"
                          onClick={() =>
                            onUpdateEdits((e) => ({
                              ...e,
                              transform: {
                                ...e.transform,
                                resize: {
                                  ...e.transform.resize,
                                  lockAspect: !e.transform.resize.lockAspect,
                                },
                              },
                            }))
                          }
                          className={`h-9 w-9 flex items-center justify-center rounded-xl border shrink-0 cursor-pointer ${
                            item.edits.transform.resize.lockAspect
                              ? 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)]'
                              : 'bg-[var(--bg-subtle)] border-[var(--border-card)] text-[var(--text-muted)]'
                          }`}
                        >
                          {item.edits.transform.resize.lockAspect ? (
                            <Link2 className="w-4 h-4" />
                          ) : (
                            <Link2Off className="w-4 h-4" />
                          )}
                        </button>

                        <label className="flex-1 space-y-1 text-[11px] font-medium text-[var(--text-muted)]">
                          <span>Height (px)</span>
                          <input
                            type="number"
                            min={16}
                            max={4096}
                            value={item.edits.transform.resize.height}
                            onChange={(ev) => {
                              const h = Math.max(
                                16,
                                Math.min(4096, parseInt(ev.target.value, 10) || 16)
                              );
                              const aspect = item.width / Math.max(1, item.height);
                              onUpdateEdits(
                                (e) => ({
                                  ...e,
                                  transform: {
                                    ...e.transform,
                                    resize: {
                                      ...e.transform.resize,
                                      height: h,
                                      width: e.transform.resize.lockAspect
                                        ? Math.max(16, Math.round(h * aspect))
                                        : e.transform.resize.width,
                                    },
                                  },
                                }),
                                'Resize Height'
                              );
                            }}
                            className="w-full h-9 px-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] font-mono tabular-nums text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#E06D3B] focus:bg-[var(--bg-input-focus)]"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        {RESIZE_PRESETS.map((p) => (
                          <button
                            key={p.label}
                            type="button"
                            onClick={() =>
                              onUpdateEdits(
                                (e) => ({
                                  ...e,
                                  transform: {
                                    ...e.transform,
                                    resize: {
                                      ...e.transform.resize,
                                      enabled: true,
                                      lockAspect: false,
                                      width: p.w,
                                      height: p.h,
                                    },
                                  },
                                }),
                                `Resize ${p.label}`
                              )
                            }
                            className="py-1.5 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] font-mono text-[11px] font-medium text-[var(--text-secondary)] cursor-pointer"
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Right Inspector Panel */}
      {desktopOpen && (
        <aside
          aria-label="Settings Inspector"
          className="hidden lg:flex flex-col w-[332px] xl:w-[350px] border-l border-[var(--border-main)] shrink-0 overflow-hidden"
        >
          {panelBody}
        </aside>
      )}

      {/* Mobile Slide-Over Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden flex justify-end bg-[var(--bg-overlay)] backdrop-blur-xs"
          onClick={onCloseMobile}
        >
          <aside
            className="w-[320px] max-w-[88vw] h-full border-l border-[var(--border-card)] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {panelBody}
          </aside>
        </div>
      )}
    </>
  );
};
