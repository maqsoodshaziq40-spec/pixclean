import React, { useState } from 'react';
import {
  Contrast,
  Crop,
  Droplets,
  FlipHorizontal2,
  FlipVertical2,
  Link2,
  Link2Off,
  Maximize2,
  RotateCcw,
  RotateCw,
  Sun,
  SwatchBook,
  X,
} from 'lucide-react';
import type { CropRect, ImageEditSettings, StudioImageItem, ToolType } from '../types/studio';
import { getOutputDimensions, getRotatedDimensions } from '../engine/imagePipeline';
import { StudioSlider } from './StudioSlider';

type QuickToolId =
  | 'crop'
  | 'resize'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'blur'
  | 'rotate'
  | 'flip';

interface QuickEditBarProps {
  item: StudioImageItem | null;
  activeTool: ToolType;
  onSelectTool: (tool: ToolType) => void;
  onUpdateEdits: (
    updater: (edits: ImageEditSettings) => ImageEditSettings,
    commitLabel?: string
  ) => void;
}

const CROP_PRESETS: Array<{ label: string; ratio: number | null }> = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
];

export const QuickEditBar: React.FC<QuickEditBarProps> = ({
  item,
  activeTool,
  onSelectTool,
  onUpdateEdits,
}) => {
  const [openTool, setOpenTool] = useState<QuickToolId | null>(null);

  if (!item) return null;

  const { adjustments, transform } = item.edits;
  const rotDims = getRotatedDimensions(item);
  const outDims = getOutputDimensions(item, false);
  const currentResizeW = transform.resize.enabled ? transform.resize.width : outDims.width;
  const currentResizeH = transform.resize.enabled ? transform.resize.height : outDims.height;

  const toggleTool = (id: QuickToolId) => {
    if (id === 'crop') {
      const nextOpen = openTool === 'crop' && activeTool === 'crop' ? null : 'crop';
      setOpenTool(nextOpen);
      onSelectTool(nextOpen === 'crop' ? 'crop' : 'select');
      return;
    }
    if (activeTool === 'crop') {
      onSelectTool('select');
    }
    setOpenTool((prev) => (prev === id ? null : id));
  };

  const applyCropPreset = (ratio: number | null, label: string) => {
    if (ratio === null) {
      onSelectTool('crop');
      return;
    }
    const imgAspect = rotDims.width / rotDims.height;
    let cw = 1;
    let ch = 1;
    if (imgAspect > ratio) {
      cw = (rotDims.height * ratio) / rotDims.width;
      ch = 1;
    } else {
      cw = 1;
      ch = rotDims.width / ratio / rotDims.height;
    }
    const crop: CropRect = {
      x: (1 - cw) / 2,
      y: (1 - ch) / 2,
      width: cw,
      height: ch,
    };
    onUpdateEdits(
      (e) => ({
        ...e,
        transform: { ...e.transform, crop },
      }),
      `Crop ${label}`
    );
  };

  const handleResizeChange = (axis: 'w' | 'h', raw: string) => {
    const parsed = Math.max(16, Math.min(4096, Math.round(Number(raw) || 0)));
    if (!parsed) return;
    const baseDims = getOutputDimensions(item, true);
    const aspect = baseDims.width / Math.max(1, baseDims.height);
    onUpdateEdits(
      (e) => {
        const lock = e.transform.resize.lockAspect;
        let nextW = axis === 'w' ? parsed : e.transform.resize.width || baseDims.width;
        let nextH = axis === 'h' ? parsed : e.transform.resize.height || baseDims.height;
        if (lock) {
          if (axis === 'w') nextH = Math.max(16, Math.round(parsed / aspect));
          else nextW = Math.max(16, Math.round(parsed * aspect));
        }
        return {
          ...e,
          transform: {
            ...e.transform,
            resize: {
              ...e.transform.resize,
              enabled: true,
              width: nextW,
              height: nextH,
            },
          },
        };
      },
      'Resize Photo'
    );
  };

  const rotateBy = (delta: 90 | -90) => {
    onUpdateEdits(
      (e) => {
        const next = ((e.transform.rotate90 + delta + 360) % 360) as 0 | 90 | 180 | 270;
        return {
          ...e,
          transform: { ...e.transform, rotate90: next },
        };
      },
      delta === 90 ? 'Rotate Right 90°' : 'Rotate Left 90°'
    );
  };

  const tools: Array<{
    id: QuickToolId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    modified: boolean;
  }> = [
    { id: 'crop', label: 'Crop', icon: Crop, modified: !!transform.crop || activeTool === 'crop' },
    { id: 'resize', label: 'Resize', icon: Maximize2, modified: transform.resize.enabled },
    { id: 'brightness', label: 'Brightness', icon: Sun, modified: adjustments.brightness !== 100 },
    { id: 'contrast', label: 'Contrast', icon: Contrast, modified: adjustments.contrast !== 100 },
    { id: 'saturation', label: 'Saturation', icon: SwatchBook, modified: adjustments.saturation !== 100 },
    { id: 'blur', label: 'Blur', icon: Droplets, modified: adjustments.blur > 0 },
    {
      id: 'rotate',
      label: 'Rotate',
      icon: RotateCw,
      modified: transform.rotate90 !== 0 || transform.straighten !== 0,
    },
    { id: 'flip', label: 'Flip', icon: FlipHorizontal2, modified: transform.flipH || transform.flipV },
  ];

  const activePanel: QuickToolId | null = activeTool === 'crop' ? 'crop' : openTool;

  return (
    <div className="bg-[var(--bg-panel)] border-t border-[var(--border-main)] shrink-0 z-20 transition-colors">
      {/* Inline Active Tool Control Strip */}
      {activePanel && (
        <div className="px-3 sm:px-4 py-2.5 bg-[var(--bg-panel-alt)] border-b border-[var(--border-divider)] flex flex-wrap items-center justify-between gap-3">
          {activePanel === 'crop' && (
            <div className="flex flex-wrap items-center gap-1.5 flex-1">
              <span className="text-[11px] font-bold text-[var(--text-secondary)] mr-1">
                Crop Ratio:
              </span>
              {CROP_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyCropPreset(p.ratio, p.label)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--bg-card)] hover:bg-[var(--bg-accent-soft)] border border-[var(--border-card)] hover:border-[var(--border-accent)] text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  {p.label}
                </button>
              ))}
              {transform.crop && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateEdits(
                      (e) => ({ ...e, transform: { ...e.transform, crop: null } }),
                      'Clear Crop'
                    )
                  }
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--rose-bg)] text-[var(--rose-text)] border border-[var(--rose-border)] cursor-pointer"
                >
                  Clear Crop
                </button>
              )}
            </div>
          )}

          {activePanel === 'resize' && (
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <span className="text-[11px] font-bold text-[var(--text-secondary)]">Size (px):</span>
              <input
                type="number"
                min={16}
                max={4096}
                value={currentResizeW}
                onChange={(e) => handleResizeChange('w', e.target.value)}
                aria-label="Width in pixels"
                className="w-20 px-2.5 py-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] text-xs font-mono font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[#E06D3B]"
              />
              <span className="text-xs text-[var(--text-muted)]">×</span>
              <input
                type="number"
                min={16}
                max={4096}
                value={currentResizeH}
                onChange={(e) => handleResizeChange('h', e.target.value)}
                aria-label="Height in pixels"
                className="w-20 px-2.5 py-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] text-xs font-mono font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[#E06D3B]"
              />
              <button
                type="button"
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
                title={transform.resize.lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border cursor-pointer ${
                  transform.resize.lockAspect
                    ? 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)]'
                    : 'bg-[var(--bg-card)] border-[var(--border-card)] text-[var(--text-muted)]'
                }`}
              >
                {transform.resize.lockAspect ? (
                  <Link2 className="w-3 h-3" />
                ) : (
                  <Link2Off className="w-3 h-3" />
                )}
                <span>Lock</span>
              </button>
              {transform.resize.enabled && (
                <button
                  type="button"
                  onClick={() => {
                    const base = getOutputDimensions(item, true);
                    onUpdateEdits(
                      (e) => ({
                        ...e,
                        transform: {
                          ...e.transform,
                          resize: {
                            ...e.transform.resize,
                            enabled: false,
                            width: base.width,
                            height: base.height,
                          },
                        },
                      }),
                      'Reset Resize'
                    );
                  }}
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--bg-subtle)] text-[var(--text-secondary)] border border-[var(--border-card)] cursor-pointer"
                >
                  Original
                </button>
              )}
            </div>
          )}

          {activePanel === 'brightness' && (
            <div className="flex-1 max-w-sm">
              <StudioSlider
                label="Brightness"
                value={adjustments.brightness}
                min={0}
                max={200}
                unit="%"
                defaultValue={100}
                onChange={(brightness) =>
                  onUpdateEdits((e) => ({ ...e, adjustments: { ...e.adjustments, brightness } }))
                }
                onCommit={() => onUpdateEdits((e) => e, 'Brightness')}
              />
            </div>
          )}

          {activePanel === 'contrast' && (
            <div className="flex-1 max-w-sm">
              <StudioSlider
                label="Contrast"
                value={adjustments.contrast}
                min={0}
                max={200}
                unit="%"
                defaultValue={100}
                onChange={(contrast) =>
                  onUpdateEdits((e) => ({ ...e, adjustments: { ...e.adjustments, contrast } }))
                }
                onCommit={() => onUpdateEdits((e) => e, 'Contrast')}
              />
            </div>
          )}

          {activePanel === 'saturation' && (
            <div className="flex-1 max-w-sm">
              <StudioSlider
                label="Saturation"
                value={adjustments.saturation}
                min={0}
                max={200}
                unit="%"
                defaultValue={100}
                onChange={(saturation) =>
                  onUpdateEdits((e) => ({ ...e, adjustments: { ...e.adjustments, saturation } }))
                }
                onCommit={() => onUpdateEdits((e) => e, 'Saturation')}
              />
            </div>
          )}

          {activePanel === 'blur' && (
            <div className="flex-1 max-w-sm">
              <StudioSlider
                label="Blur"
                value={adjustments.blur}
                min={0}
                max={20}
                step={0.5}
                unit="px"
                defaultValue={0}
                onChange={(blur) =>
                  onUpdateEdits((e) => ({ ...e, adjustments: { ...e.adjustments, blur } }))
                }
                onCommit={() => onUpdateEdits((e) => e, 'Blur')}
              />
            </div>
          )}

          {activePanel === 'rotate' && (
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => rotateBy(-90)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--bg-card)] hover:bg-[var(--bg-accent-soft)] border border-[var(--border-card)] hover:border-[var(--border-accent)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#E06D3B]" />
                  <span>Left 90°</span>
                </button>
                <button
                  type="button"
                  onClick={() => rotateBy(90)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--bg-card)] hover:bg-[var(--bg-accent-soft)] border border-[var(--border-card)] hover:border-[var(--border-accent)] text-xs font-bold text-[var(--text-primary)] cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5 text-[#E06D3B]" />
                  <span>Right 90°</span>
                </button>
              </div>
              <div className="flex-1 min-w-[160px] max-w-xs">
                <StudioSlider
                  label="Straighten"
                  value={transform.straighten}
                  min={-45}
                  max={45}
                  unit="°"
                  defaultValue={0}
                  onChange={(straighten) =>
                    onUpdateEdits((e) => ({ ...e, transform: { ...e.transform, straighten } }))
                  }
                  onCommit={() => onUpdateEdits((e) => e, 'Straighten')}
                />
              </div>
            </div>
          )}

          {activePanel === 'flip' && (
            <div className="flex items-center gap-2 flex-1">
              <button
                type="button"
                onClick={() =>
                  onUpdateEdits(
                    (e) => ({
                      ...e,
                      transform: { ...e.transform, flipH: !e.transform.flipH },
                    }),
                    'Flip Horizontal'
                  )
                }
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                  transform.flipH
                    ? 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)]'
                    : 'bg-[var(--bg-card)] hover:bg-[var(--bg-subtle)] border-[var(--border-card)] text-[var(--text-primary)]'
                }`}
              >
                <FlipHorizontal2 className="w-3.5 h-3.5" />
                <span>Flip Horizontal</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateEdits(
                    (e) => ({
                      ...e,
                      transform: { ...e.transform, flipV: !e.transform.flipV },
                    }),
                    'Flip Vertical'
                  )
                }
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                  transform.flipV
                    ? 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)]'
                    : 'bg-[var(--bg-card)] hover:bg-[var(--bg-subtle)] border-[var(--border-card)] text-[var(--text-primary)]'
                }`}
              >
                <FlipVertical2 className="w-3.5 h-3.5" />
                <span>Flip Vertical</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setOpenTool(null);
              if (activeTool === 'crop') onSelectTool('select');
            }}
            aria-label="Close quick edit tool"
            className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Compact Horizontal Basic Editing Tools Strip */}
      <div className="px-3 sm:px-4 py-2 flex items-center gap-1.5 overflow-x-auto studio-scroll">
        <span className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mr-1 shrink-0">
          Edit
        </span>
        {tools.map(({ id, label, icon: Icon, modified }) => {
          const isSelected = activePanel === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggleTool(id)}
              className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border whitespace-nowrap transition-all shrink-0 cursor-pointer active:scale-95 ${
                isSelected
                  ? 'bg-[#E06D3B] border-[#E06D3B] text-white shadow-xs shadow-[#E06D3B]/25'
                  : modified
                  ? 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)]'
                  : 'bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border-[var(--border-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
              {modified && !isSelected && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#E06D3B]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
