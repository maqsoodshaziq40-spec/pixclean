import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  Columns2,
  Eye,
  Grid2x2,
  Grid3x3,
  Heart,
  ImagePlus,
  Layers,
  Loader2,
  Maximize,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Upload,
  X,
} from 'lucide-react';
import {
  getOutputDimensions,
  getRotatedDimensions,
  outputNormToSourcePixel,
  paintMaskStroke,
  renderStudioComposite,
} from '../engine/imagePipeline';
import { SAMPLE_SUBJECTS, type SampleSubjectPreset } from '../engine/studioAssets';
import type {
  BrushSettings,
  CheckerboardTone,
  CropRect,
  GridDivisions,
  SnapGridSettings,
  StudioImageItem,
  ToolType,
  ViewMode,
} from '../types/studio';

interface StudioCanvasProps {
  item: StudioImageItem | null;
  activeTool: ToolType;
  viewMode: ViewMode;
  checkerboard: CheckerboardTone;
  snapGrid: SnapGridSettings;
  brush: BrushSettings;
  zoom: number;
  pan: { x: number; y: number };
  bgImageVersion: number;
  onZoomChange: (zoom: number) => void;
  onPanChange: (pan: { x: number; y: number }) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onCheckerboardChange: (tone: CheckerboardTone) => void;
  onSnapGridChange: (grid: SnapGridSettings) => void;
  onPositionChange: (offsetX: number, offsetY: number, commit?: boolean) => void;
  onFilesDropped: (files: FileList | File[]) => void;
  onLoadSample: (preset: SampleSubjectPreset) => void;
  onTriggerAiRemove: () => void;
  onBrushStrokeCommit: () => void;
  onApplyCrop: (crop: CropRect | null) => void;
  onCancelCrop: () => void;
  fitSignal: number;
}

type CropDragMode =
  | 'move'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | null;

const CROP_RATIOS: Array<{ label: string; ratio: number | null }> = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
];

const GRID_DIVISIONS_OPTIONS: GridDivisions[] = [4, 8, 12, 16];

function snapScalarToGrid(
  value: number,
  divisions: number,
  threshold: number
): { value: number; guide: number | null } {
  const step = 1 / divisions;
  const nearestIdx = Math.round(value / step);
  const clampedIdx = Math.max(0, Math.min(divisions, nearestIdx));
  const candidate = clampedIdx * step;
  if (Math.abs(value - candidate) <= threshold) {
    return { value: candidate, guide: candidate };
  }
  return { value, guide: null };
}

function snapSpanToGrid(
  start: number,
  size: number,
  divisions: number,
  threshold: number
): { start: number; guide: number | null } {
  const candidates = [
    { probe: start, apply: (line: number) => line },
    { probe: start + size / 2, apply: (line: number) => line - size / 2 },
    { probe: start + size, apply: (line: number) => line - size },
  ];

  let bestDist = threshold + 1e-6;
  let bestStart = start;
  let bestGuide: number | null = null;

  const step = 1 / divisions;
  for (const c of candidates) {
    const idx = Math.max(0, Math.min(divisions, Math.round(c.probe / step)));
    const line = idx * step;
    const dist = Math.abs(c.probe - line);
    if (dist < bestDist) {
      const nextStart = c.apply(line);
      if (nextStart >= -1e-4 && nextStart + size <= 1 + 1e-4) {
        bestDist = dist;
        bestStart = Math.max(0, Math.min(1 - size, nextStart));
        bestGuide = line;
      }
    }
  }

  return { start: bestStart, guide: bestGuide };
}

export const StudioCanvas: React.FC<StudioCanvasProps> = ({
  item,
  activeTool,
  viewMode,
  checkerboard,
  snapGrid,
  brush,
  zoom,
  pan,
  bgImageVersion,
  onZoomChange,
  onPanChange,
  onViewModeChange,
  onCheckerboardChange,
  onSnapGridChange,
  onPositionChange,
  onFilesDropped,
  onLoadSample,
  onTriggerAiRemove,
  onBrushStrokeCommit,
  onApplyCrop,
  onCancelCrop,
  fitSignal,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null);
  const [splitPos, setSplitPos] = useState(50);
  const [spacePressed, setSpacePressed] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  // Brush painting state
  const isPaintingRef = useRef(false);
  const lastSrcPtRef = useRef<{ x: number; y: number } | null>(null);

  // Panning state
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(
    null
  );

  // Split divider dragging
  const isSplittingRef = useRef(false);

  // Subject drag positioning state (Pointer tool on cutout)
  const subjectDragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
    lastOffsetX: number;
    lastOffsetY: number;
    moved: boolean;
  } | null>(null);

  // Active live snap guide lines (normalized 0..1) and drag HUD readout
  const [activeSnapGuides, setActiveSnapGuides] = useState<{ x: number[]; y: number[] }>({
    x: [],
    y: [],
  });
  const [dragReadout, setDragReadout] = useState<string | null>(null);

  // Crop draft state (normalized 0..1 relative to rotated full image)
  const [draftCrop, setDraftCrop] = useState<CropRect>({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
  const [cropAspect, setCropAspect] = useState<number | null>(null);
  const cropDragRef = useRef<{
    mode: CropDragMode;
    startX: number;
    startY: number;
    startRect: CropRect;
  } | null>(null);

  const isCropMode = activeTool === 'crop' && !!item;

  // Dimensions currently shown on stage
  const stageDims = item
    ? isCropMode
      ? getRotatedDimensions(item)
      : getOutputDimensions(item, false)
    : { width: 1, height: 1 };

  // Compute fit-to-viewport zoom
  const fitToViewport = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !item) return;
    const rect = vp.getBoundingClientRect();
    const padX = 72;
    const padY = 120;
    const availW = Math.max(160, rect.width - padX);
    const availH = Math.max(160, rect.height - padY);
    const dims = activeTool === 'crop' ? getRotatedDimensions(item) : getOutputDimensions(item, false);
    const scale = Math.min(availW / Math.max(1, dims.width), availH / Math.max(1, dims.height), 1);
    onZoomChange(Math.max(0.08, Math.min(4, Number(scale.toFixed(3)))));
    onPanChange({ x: 0, y: 0 });
  }, [item, activeTool, onZoomChange, onPanChange]);

  // Auto-fit when item changes or fitSignal triggers
  const lastFittedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!item) {
      lastFittedIdRef.current = null;
      return;
    }
    if (lastFittedIdRef.current !== item.id) {
      lastFittedIdRef.current = item.id;
      requestAnimationFrame(() => fitToViewport());
    }
  }, [item, fitToViewport]);

  useEffect(() => {
    if (fitSignal > 0 && item) {
      fitToViewport();
    }
  }, [fitSignal, item, fitToViewport]);

  // Initialize draft crop when entering crop mode
  useEffect(() => {
    if (isCropMode && item) {
      setDraftCrop(
        item.edits.transform.crop
          ? { ...item.edits.transform.crop }
          : { x: 0.05, y: 0.05, width: 0.9, height: 0.9 }
      );
      setCropAspect(null);
    }
  }, [isCropMode, item]);

  // Track Spacebar for temporary pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          setSpacePressed(true);
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Render composite canvas(es)
  const renderCanvases = useCallback(
    (fastPreview = false) => {
      if (!item) return;
      const resCanvas = resultCanvasRef.current;
      if (!resCanvas) return;

      // In crop mode, temporarily render without crop so user sees full rotated frame
      const renderItem: StudioImageItem = isCropMode
        ? {
            ...item,
            edits: {
              ...item.edits,
              transform: {
                ...item.edits.transform,
                crop: null,
                resize: { ...item.edits.transform.resize, enabled: false },
              },
            },
          }
        : item;

      const dims = isCropMode ? getRotatedDimensions(item) : getOutputDimensions(item, false);

      renderStudioComposite(renderItem, resCanvas, {
        mode: viewMode === 'mask' && !isCropMode ? 'mask' : 'result',
        targetWidth: dims.width,
        targetHeight: dims.height,
        fastPreview,
      });

      const origCanvas = originalCanvasRef.current;
      if (origCanvas && viewMode === 'split' && !isCropMode) {
        renderStudioComposite(renderItem, origCanvas, {
          mode: 'original',
          targetWidth: dims.width,
          targetHeight: dims.height,
        });
      }
    },
    [item, viewMode, isCropMode]
  );

  useEffect(() => {
    renderCanvases(false);
  }, [
    renderCanvases,
    item?.id,
    item?.maskRevision,
    item?.hasRemovedBg,
    item?.edits,
    bgImageVersion,
  ]);

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!item) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const nextZoom = Math.max(0.08, Math.min(8, zoom * factor));
    onZoomChange(nextZoom);
  };

  // Convert client pointer position to normalized 0..1 on the canvas
  const clientToCanvasNorm = (clientX: number, clientY: number) => {
    const canvas = resultCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      nx: (clientX - rect.left) / rect.width,
      ny: (clientY - rect.top) / rect.height,
      rect,
    };
  };

  const effectivePan = activeTool === 'pan' || spacePressed;
  const isBrushTool = (activeTool === 'erase' || activeTool === 'restore') && !spacePressed && !isCropMode;
  const canDragSubject =
    !!item &&
    activeTool === 'select' &&
    !spacePressed &&
    !isCropMode &&
    viewMode === 'result' &&
    item.hasRemovedBg;

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!item) return;

    // Middle mouse button or Pan mode
    if (e.button === 1 || (e.button === 0 && effectivePan)) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return;

    // Zoom tool click
    if (activeTool === 'zoom') {
      const next = e.altKey ? Math.max(0.08, zoom / 1.35) : Math.min(8, zoom * 1.35);
      onZoomChange(next);
      return;
    }

    // Subject drag positioning in Pointer mode (snaps to grid when enabled)
    if (canDragSubject) {
      const norm = clientToCanvasNorm(e.clientX, e.clientY);
      if (norm && norm.nx >= 0 && norm.nx <= 1 && norm.ny >= 0 && norm.ny <= 1) {
        const ox = item.edits.transform.offsetX || 0;
        const oy = item.edits.transform.offsetY || 0;
        subjectDragRef.current = {
          startClientX: e.clientX,
          startClientY: e.clientY,
          startOffsetX: ox,
          startOffsetY: oy,
          lastOffsetX: ox,
          lastOffsetY: oy,
          moved: false,
        };
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        return;
      }
    }

    // Brush tool painting
    if (isBrushTool) {
      const norm = clientToCanvasNorm(e.clientX, e.clientY);
      if (!norm) return;
      const srcPt = outputNormToSourcePixel(norm.nx, norm.ny, item);
      isPaintingRef.current = true;
      lastSrcPtRef.current = srcPt;

      paintMaskStroke(
        item.maskCanvas,
        srcPt.x,
        srcPt.y,
        srcPt.x,
        srcPt.y,
        activeTool === 'erase' ? 'erase' : 'restore',
        brush.size,
        brush.hardness
      );
      item.maskRevision += 1;
      renderCanvases(true);
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    }
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const vp = viewportRef.current;
    if (vp) {
      const rect = vp.getBoundingClientRect();
      setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }

    // Split divider drag (with optional snap-to-grid)
    if (isSplittingRef.current) {
      const norm = clientToCanvasNorm(e.clientX, e.clientY);
      if (norm) {
        let nextSplit = Math.max(0, Math.min(1, norm.nx));
        const guidesX: number[] = [];
        if (snapGrid.enabled && !e.altKey) {
          const threshold = Math.min(0.025, 10 / Math.max(100, norm.rect.width));
          const snapped = snapScalarToGrid(nextSplit, snapGrid.divisions, threshold);
          nextSplit = snapped.value;
          if (snapped.guide !== null) guidesX.push(snapped.guide);
        }
        setActiveSnapGuides({ x: guidesX, y: [] });
        setSplitPos(nextSplit * 100);
      }
      return;
    }

    // Subject drag positioning (with optional snap-to-grid)
    if (subjectDragRef.current && item) {
      const canvas = resultCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dx = (e.clientX - subjectDragRef.current.startClientX) / Math.max(1, rect.width);
      const dy = (e.clientY - subjectDragRef.current.startClientY) / Math.max(1, rect.height);

      if (!subjectDragRef.current.moved && Math.hypot(dx * rect.width, dy * rect.height) < 3) {
        return;
      }
      subjectDragRef.current.moved = true;

      let nextX = Math.max(-0.5, Math.min(0.5, subjectDragRef.current.startOffsetX + dx));
      let nextY = Math.max(-0.5, Math.min(0.5, subjectDragRef.current.startOffsetY + dy));

      const guidesX: number[] = [];
      const guidesY: number[] = [];

      if (snapGrid.enabled && !e.altKey) {
        const threshX = Math.min(0.025, 10 / Math.max(100, rect.width));
        const threshY = Math.min(0.025, 10 / Math.max(100, rect.height));
        const sx = snapScalarToGrid(0.5 + nextX, snapGrid.divisions, threshX);
        const sy = snapScalarToGrid(0.5 + nextY, snapGrid.divisions, threshY);
        if (sx.guide !== null) {
          nextX = Math.max(-0.5, Math.min(0.5, sx.value - 0.5));
          guidesX.push(sx.guide);
        }
        if (sy.guide !== null) {
          nextY = Math.max(-0.5, Math.min(0.5, sy.value - 0.5));
          guidesY.push(sy.guide);
        }
      }

      subjectDragRef.current.lastOffsetX = nextX;
      subjectDragRef.current.lastOffsetY = nextY;
      setActiveSnapGuides({ x: guidesX, y: guidesY });

      const pctX = Math.round(nextX * 100);
      const pctY = Math.round(nextY * 100);
      setDragReadout(
        pctX === 0 && pctY === 0
          ? 'Centered (0%, 0%)'
          : `X ${pctX >= 0 ? '+' : ''}${pctX}%  Y ${pctY >= 0 ? '+' : ''}${pctY}%`
      );
      onPositionChange(nextX, nextY, false);
      return;
    }

    // Crop drag (with optional snap-to-grid)
    if (cropDragRef.current && isCropMode && item) {
      const canvas = resultCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dx = (e.clientX - cropDragRef.current.startX) / Math.max(1, rect.width);
      const dy = (e.clientY - cropDragRef.current.startY) / Math.max(1, rect.height);
      const s = cropDragRef.current.startRect;
      const mode = cropDragRef.current.mode;
      const minSize = 0.06;
      const shouldSnap = snapGrid.enabled && !e.altKey;
      const threshX = Math.min(0.025, 10 / Math.max(100, rect.width));
      const threshY = Math.min(0.025, 10 / Math.max(100, rect.height));
      const guidesX: number[] = [];
      const guidesY: number[] = [];

      let { x, y, width, height } = s;

      if (mode === 'move') {
        x = Math.max(0, Math.min(1 - width, s.x + dx));
        y = Math.max(0, Math.min(1 - height, s.y + dy));
        if (shouldSnap) {
          const sx = snapSpanToGrid(x, width, snapGrid.divisions, threshX);
          const sy = snapSpanToGrid(y, height, snapGrid.divisions, threshY);
          x = sx.start;
          y = sy.start;
          if (sx.guide !== null) guidesX.push(sx.guide);
          if (sy.guide !== null) guidesY.push(sy.guide);
        }
      } else {
        let left = s.x;
        let top = s.y;
        let right = s.x + s.width;
        let bottom = s.y + s.height;

        if (mode?.includes('w')) {
          left = Math.max(0, Math.min(right - minSize, s.x + dx));
          if (shouldSnap) {
            const sn = snapScalarToGrid(left, snapGrid.divisions, threshX);
            if (sn.guide !== null && sn.value <= right - minSize) {
              left = sn.value;
              guidesX.push(sn.guide);
            }
          }
        }
        if (mode?.includes('e')) {
          right = Math.min(1, Math.max(left + minSize, s.x + s.width + dx));
          if (shouldSnap) {
            const sn = snapScalarToGrid(right, snapGrid.divisions, threshX);
            if (sn.guide !== null && sn.value >= left + minSize) {
              right = sn.value;
              guidesX.push(sn.guide);
            }
          }
        }
        if (mode?.includes('n')) {
          top = Math.max(0, Math.min(bottom - minSize, s.y + dy));
          if (shouldSnap) {
            const sn = snapScalarToGrid(top, snapGrid.divisions, threshY);
            if (sn.guide !== null && sn.value <= bottom - minSize) {
              top = sn.value;
              guidesY.push(sn.guide);
            }
          }
        }
        if (mode?.includes('s')) {
          bottom = Math.min(1, Math.max(top + minSize, s.y + s.height + dy));
          if (shouldSnap) {
            const sn = snapScalarToGrid(bottom, snapGrid.divisions, threshY);
            if (sn.guide !== null && sn.value >= top + minSize) {
              bottom = sn.value;
              guidesY.push(sn.guide);
            }
          }
        }

        x = left;
        y = top;
        width = right - left;
        height = bottom - top;

        if (cropAspect !== null) {
          const dims = getRotatedDimensions(item);
          const normAspect = cropAspect / (dims.width / Math.max(1, dims.height));
          if (mode === 'n' || mode === 's') {
            width = Math.min(1 - x, height * normAspect);
            height = width / normAspect;
          } else {
            height = Math.min(1 - y, width / normAspect);
            width = height * normAspect;
          }
          if (x + width > 1) x = Math.max(0, 1 - width);
          if (y + height > 1) y = Math.max(0, 1 - height);
        }
      }

      setActiveSnapGuides({ x: guidesX, y: guidesY });
      const dims = getRotatedDimensions(item);
      setDragReadout(
        `${Math.round(width * dims.width)} × ${Math.round(height * dims.height)} px`
      );
      setDraftCrop({ x, y, width, height });
      return;
    }

    // Pan drag
    if (isPanningRef.current && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      onPanChange({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
      return;
    }

    // Brush stroke drag
    if (isPaintingRef.current && item && isBrushTool) {
      const norm = clientToCanvasNorm(e.clientX, e.clientY);
      if (!norm) return;
      const srcPt = outputNormToSourcePixel(norm.nx, norm.ny, item);
      const prev = lastSrcPtRef.current ?? srcPt;
      paintMaskStroke(
        item.maskCanvas,
        prev.x,
        prev.y,
        srcPt.x,
        srcPt.y,
        activeTool === 'erase' ? 'erase' : 'restore',
        brush.size,
        brush.hardness
      );
      lastSrcPtRef.current = srcPt;
      item.maskRevision += 1;
      renderCanvases(true);
    }
  };

  const handleViewportPointerUp = () => {
    if (isPaintingRef.current) {
      isPaintingRef.current = false;
      lastSrcPtRef.current = null;
      renderCanvases(false);
      onBrushStrokeCommit();
    }
    if (subjectDragRef.current) {
      if (subjectDragRef.current.moved) {
        onPositionChange(
          subjectDragRef.current.lastOffsetX,
          subjectDragRef.current.lastOffsetY,
          true
        );
      }
      subjectDragRef.current = null;
    }
    isPanningRef.current = false;
    panStartRef.current = null;
    isSplittingRef.current = false;
    cropDragRef.current = null;
    setActiveSnapGuides({ x: [], y: [] });
    setDragReadout(null);
  };

  const applyAspectRatioToDraft = (ratio: number | null) => {
    setCropAspect(ratio);
    if (!item || ratio === null) return;
    const dims = getRotatedDimensions(item);
    const imgAspect = dims.width / Math.max(1, dims.height);
    const normRatio = ratio / imgAspect;
    let w = 0.86;
    let h = w / normRatio;
    if (h > 0.86) {
      h = 0.86;
      w = h * normRatio;
    }
    setDraftCrop({
      x: (1 - w) / 2,
      y: (1 - h) / 2,
      width: w,
      height: h,
    });
  };

  // Drag & Drop files onto canvas
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesDropped(e.dataTransfer.files);
    }
  };

  // Compute brush preview circle diameter in CSS pixels
  const brushDisplayDiameter = item
    ? Math.max(6, brush.size * zoom * (stageDims.width / Math.max(1, item.width)))
    : 20;

  const displayWidth = Math.max(1, Math.round(stageDims.width * zoom));
  const displayHeight = Math.max(1, Math.round(stageDims.height * zoom));

  const cursorClass = effectivePan
    ? isPanningRef.current
      ? 'cursor-grabbing'
      : 'cursor-grab'
    : activeTool === 'zoom'
      ? 'cursor-zoom-in'
      : isBrushTool
        ? 'cursor-none'
        : canDragSubject
          ? 'cursor-move'
          : 'cursor-default';

  return (
    <div
      className="relative flex-1 flex flex-col min-w-0 min-h-0 studio-stage-bg overflow-hidden select-none transition-colors"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp,image/avif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFilesDropped(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Top Floating Frosted-Glass Viewer Settings Control Bar */}
      {item && (
        <div className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-2xl bg-[var(--bg-panel-translucent)] backdrop-blur-md border border-[var(--border-card)] shadow-[var(--shadow-float)] z-10 shrink-0 transition-colors">
          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(0.08, zoom / 1.25))}
              title="Zoom Out (-)"
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono tabular-nums text-[11px] font-semibold text-[var(--text-primary)] min-w-[44px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(8, zoom * 1.25))}
              title="Zoom In (+)"
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-4 bg-[var(--border-strong)] mx-0.5" />
            <button
              type="button"
              onClick={fitToViewport}
              title="Fit to Viewport (0)"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
            >
              <Maximize className="w-3 h-3" />
              <span className="hidden sm:inline">Fit</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onZoomChange(1);
                onPanChange({ x: 0, y: 0 });
              }}
              title="Actual Size 100% (1)"
              className="px-2 py-1 rounded-lg font-mono text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
            >
              1:1
            </button>
          </div>

          {/* Center & Right Viewer Settings: Crop Bar OR View Mode Toggle + Persistent Snap Grid */}
          <div className="flex flex-wrap items-center gap-1.5">
            {isCropMode ? (
              <>
                <div className="flex items-center gap-0.5 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-xl p-0.5">
                  {CROP_RATIOS.map((r) => (
                    <button
                      key={r.label}
                      type="button"
                      onClick={() => applyAspectRatioToDraft(r.ratio)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer transition-all ${
                        cropAspect === r.ratio
                          ? 'bg-[#E06D3B] text-white shadow-xs'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onApplyCrop(draftCrop)}
                  className="studio-cta inline-flex items-center gap-1 px-3.5 py-1.5 rounded-full text-white text-xs font-bold cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  Apply
                </button>
                <button
                  type="button"
                  onClick={onCancelCrop}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] text-[var(--text-secondary)] text-xs font-semibold border border-[var(--border-card)] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </>
            ) : (
              <div className="flex items-center gap-0.5 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-xl p-0.5">
                <button
                  type="button"
                  onClick={() => onViewModeChange('split')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-all ${
                    viewMode === 'split'
                      ? 'bg-[var(--bg-accent-soft)] text-[var(--text-accent)] border border-[var(--border-accent)] shadow-2xs'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-transparent'
                  }`}
                >
                  <Columns2 className="w-3.5 h-3.5" />
                  <span>Before / After</span>
                </button>
                <button
                  type="button"
                  onClick={() => onViewModeChange('result')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-all ${
                    viewMode === 'result'
                      ? 'bg-[var(--bg-accent-soft)] text-[var(--text-accent)] border border-[var(--border-accent)] shadow-2xs'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-transparent'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>PNG Preview</span>
                </button>
                <button
                  type="button"
                  onClick={() => onViewModeChange('mask')}
                  title="Toggle Ruby Mask Overlay (M)"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-all ${
                    viewMode === 'mask'
                      ? 'bg-[var(--rose-bg)] text-[var(--rose-text)] border border-[var(--rose-border)] shadow-2xs'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-transparent'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Ruby Mask</span>
                </button>
              </div>
            )}

            {/* Viewer Settings: Snap-to-Grid Overlay Toggle + Density Selector */}
            <div className="flex items-center gap-1 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-xl p-0.5">
              <button
                type="button"
                aria-pressed={snapGrid.enabled}
                onClick={() =>
                  onSnapGridChange({ ...snapGrid, enabled: !snapGrid.enabled })
                }
                title="Show / Hide Snap-to-Grid Overlay (G) — Hold Alt while dragging to bypass snap"
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-all ${
                  snapGrid.enabled
                    ? 'bg-[var(--bg-accent-soft)] text-[var(--text-accent)] border border-[var(--border-accent)] shadow-2xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-transparent'
                }`}
              >
                <Grid3x3 className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Snap Grid</span>
              </button>

              {snapGrid.enabled && (
                <select
                  aria-label="Snap grid density"
                  value={snapGrid.divisions}
                  onChange={(e) =>
                    onSnapGridChange({
                      ...snapGrid,
                      divisions: Number(e.target.value) as GridDivisions,
                    })
                  }
                  className="bg-[var(--bg-card)] text-[var(--text-primary)] font-mono text-[10px] font-semibold rounded-lg px-1.5 py-1 border border-[var(--border-accent)] focus:outline-none focus:border-[#E06D3B] cursor-pointer"
                >
                  {GRID_DIVISIONS_OPTIONS.map((div) => (
                    <option key={div} value={div}>
                      {div}×{div}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {!isCropMode && (
              <button
                type="button"
                onClick={() => onCheckerboardChange(checkerboard === 'dark' ? 'light' : 'dark')}
                title="Switch Transparency Checkerboard (Light / Dark)"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] text-[11px] font-semibold text-[var(--text-secondary)] whitespace-nowrap transition-colors cursor-pointer"
              >
                <Grid2x2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span className="hidden xl:inline">
                  {checkerboard === 'dark' ? 'Dark Grid' : 'Light Grid'}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Viewport Area */}
      <div
        ref={viewportRef}
        onWheel={handleWheel}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerLeave={() => {
          setCursorPos(null);
          if (isPaintingRef.current) handleViewportPointerUp();
        }}
        className={`relative flex-1 flex items-center justify-center overflow-hidden ${
          item ? cursorClass : ''
        }`}
      >
        {!item ? (
          /* Empty Upload Stage — Warm, human welcome with safe vertical centering (my-auto) */
          <div className="w-full h-full overflow-y-auto studio-scroll flex flex-col">
            <div className="w-full max-w-[700px] mx-auto my-auto px-4 sm:px-6 pt-5 pb-7 sm:py-8 flex flex-col gap-5 sm:gap-6 shrink-0">
              {/* Friendly Human Top Line */}
              <p className="text-center text-xs sm:text-[13px] font-semibold text-[var(--text-secondary)] px-2 leading-relaxed">
                Free{' '}
                <span className="inline-flex items-center px-2.5 py-0.5 mx-0.5 rounded-full bg-[var(--bg-accent-soft-hover)] border border-[var(--border-accent)] font-extrabold text-[var(--text-accent)]">
                  Background Remover
                </span>{' '}
                — No fuss, no sign-up, just drop a photo and you&apos;re done.
              </p>

              <div
                onClick={() => fileInputRef.current?.click()}
                className={`group relative w-full rounded-[28px] border-2 border-dashed px-5 py-6 sm:px-10 sm:py-9 text-center transition-all duration-200 cursor-pointer shadow-[var(--shadow-float)] backdrop-blur-sm ${
                  isDragOver
                    ? 'border-[#E06D3B] bg-[var(--bg-accent-soft)] scale-[1.01]'
                    : 'border-[var(--border-accent-dashed)] hover:border-[#E06D3B] bg-[var(--bg-card)]/95 hover:bg-[var(--bg-card-hover)]'
                }`}
              >
                <div className="mx-auto w-13 h-13 sm:w-15 sm:h-15 rounded-2xl bg-[var(--bg-accent-soft)] border border-[var(--border-accent)] flex items-center justify-center mb-3.5 sm:mb-4 text-[var(--text-accent-bright)] shadow-[var(--shadow-accent)] group-hover:scale-105 transition-transform duration-200">
                  <Camera className="w-6 h-6 sm:w-7 sm:h-7" />
                </div>

                <h1
                  className="font-display text-2xl sm:text-[30px] font-bold text-[var(--text-primary)] tracking-tight leading-snug"
                  style={{ textWrap: 'balance' }}
                >
                  Drop Your Photo Here
                </h1>

                <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-2 max-w-md mx-auto leading-relaxed">
                  Bring in any JPG, PNG, or WebP photo — or just paste it with{' '}
                  <kbd className="font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded-lg bg-[var(--bg-accent-soft)] border border-[var(--border-accent)] text-[var(--text-accent)]">
                    Ctrl+V
                  </kbd>
                  .
                </p>

                <div className="mt-5 sm:mt-6 flex flex-col items-center gap-2.5 sm:gap-3">
                  <span className="studio-cta inline-flex items-center gap-2 px-7 py-3 rounded-full text-white text-sm font-bold whitespace-nowrap">
                    <ImagePlus className="w-4 h-4" />
                    <span>Choose Your Photo</span>
                  </span>
                  <p className="text-[11px] font-semibold text-[var(--text-muted)]">
                    Runs right in your browser · Crisp transparent PNG · Private &amp; safe
                  </p>
                </div>
              </div>

              {/* 3-Column Real Studio Sample Gallery */}
              <div className="w-full space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs px-1">
                  <span className="font-bold text-[var(--text-secondary)]">
                    Or try one of these photos
                  </span>
                  <span className="text-[11px] font-medium text-[var(--text-muted)]">
                    Tap any to open
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2.5 sm:gap-3.5">
                  {SAMPLE_SUBJECTS.map((preset) => {
                    const isLoading = loadingSampleId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={loadingSampleId !== null}
                        onClick={async () => {
                          setLoadingSampleId(preset.id);
                          try {
                            await onLoadSample(preset);
                          } finally {
                            setLoadingSampleId(null);
                          }
                        }}
                        style={{ background: preset.fallbackGradient }}
                        className="group relative aspect-square sm:aspect-[4/3] w-full rounded-[22px] overflow-hidden border border-[var(--border-card)] hover:border-[#E06D3B] shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-float)] text-left transition-all duration-200 cursor-pointer disabled:opacity-60 active:scale-[0.98]"
                      >
                        <img
                          src={preset.previewUrl}
                          alt={`${preset.name} — ${preset.subtitle}`}
                          referrerPolicy="no-referrer"
                          loading="eager"
                          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-out"
                        />

                        {/* Measured contrast scrim for guaranteed text legibility */}
                        <div className="absolute inset-0 bg-gradient-to-t from-[#1F1813]/85 via-[#1F1813]/25 to-transparent" />

                        {/* Real-world Image Action Icon */}
                        <div className="absolute top-2 right-2 sm:top-2.5 sm:right-2.5 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#1F1813]/50 backdrop-blur-md border border-white/25 flex items-center justify-center text-white opacity-90 group-hover:opacity-100 group-hover:bg-[#E06D3B] transition-colors">
                          {isLoading ? (
                            <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" />
                          ) : (
                            <ImagePlus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          )}
                        </div>

                        <div className="absolute inset-x-0 bottom-0 p-2 sm:p-3">
                          <div className="text-[11px] sm:text-xs font-bold text-white leading-tight truncate drop-shadow-xs">
                            {preset.name}
                          </div>
                          <div className="hidden sm:block text-[11px] text-white/85 truncate mt-0.5">
                            {preset.subtitle}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Gentle Human Footer Touch (visible on both mobile & desktop) */}
              <div className="flex items-center justify-center gap-1.5 pt-1 text-[11px] font-semibold text-[var(--text-muted)]">
                <Heart className="w-3 h-3 text-[#E06D3B] fill-[#E06D3B]/30" />
                <span>Made with care</span>
              </div>
            </div>
          </div>
        ) : (
          /* Active Interactive Canvas Stage */
          <>
            <div
              style={{
                width: displayWidth,
                height: displayHeight,
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
              }}
              className={`relative rounded-2xl shadow-[var(--shadow-canvas)] ring-1 ring-[var(--border-strong)] overflow-hidden shrink-0 ${
                checkerboard === 'dark' ? 'checkerboard-dark' : 'checkerboard-light'
              }`}
            >
              {/* Result / Mask Canvas */}
              <canvas
                ref={resultCanvasRef}
                style={{ width: displayWidth, height: displayHeight }}
                className="block"
              />

              {/* Snap-to-Grid Precision Alignment Overlay */}
              {snapGrid.enabled && (
                <svg
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full pointer-events-none z-[25]"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {Array.from({ length: snapGrid.divisions - 1 }, (_, i) => {
                    const pos = ((i + 1) / snapGrid.divisions) * 100;
                    const isCenter = i + 1 === snapGrid.divisions / 2;
                    return (
                      <g key={i}>
                        {/* Vertical dual-contrast grid line */}
                        <line
                          x1={pos}
                          y1={0}
                          x2={pos}
                          y2={100}
                          stroke={isCenter ? 'rgba(27, 29, 42, 0.35)' : 'rgba(27, 29, 42, 0.18)'}
                          strokeWidth={isCenter ? 0.65 : 0.4}
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          x1={pos}
                          y1={0}
                          x2={pos}
                          y2={100}
                          stroke={
                            isCenter ? 'rgba(224, 109, 59, 0.82)' : 'rgba(255, 255, 255, 0.5)'
                          }
                          strokeWidth={isCenter ? 1.2 : 0.8}
                          strokeDasharray={isCenter ? '4 3' : undefined}
                          vectorEffect="non-scaling-stroke"
                        />
                        {/* Horizontal dual-contrast grid line */}
                        <line
                          x1={0}
                          y1={pos}
                          x2={100}
                          y2={pos}
                          stroke={isCenter ? 'rgba(44, 36, 30, 0.35)' : 'rgba(44, 36, 30, 0.18)'}
                          strokeWidth={isCenter ? 0.65 : 0.4}
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          x1={0}
                          y1={pos}
                          x2={100}
                          y2={pos}
                          stroke={
                            isCenter ? 'rgba(224, 109, 59, 0.82)' : 'rgba(255, 255, 255, 0.5)'
                          }
                          strokeWidth={isCenter ? 1.2 : 0.8}
                          strokeDasharray={isCenter ? '4 3' : undefined}
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    );
                  })}

                  {/* Active live magnetic snap guide highlights */}
                  {activeSnapGuides.x.map((gx, idx) => (
                    <line
                      key={`gx-${idx}`}
                      x1={gx * 100}
                      y1={0}
                      x2={gx * 100}
                      y2={100}
                      stroke="#E06D3B"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {activeSnapGuides.y.map((gy, idx) => (
                    <line
                      key={`gy-${idx}`}
                      x1={0}
                      y1={gy * 100}
                      x2={100}
                      y2={gy * 100}
                      stroke="#E06D3B"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
              )}

              {/* Live Positioning / Crop Readout Pill */}
              {dragReadout && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-2.5 py-1 rounded-lg bg-[var(--bg-card)] border border-[var(--border-accent)] font-mono tabular-nums text-[11px] font-semibold text-[var(--text-accent)] shadow-md">
                  {dragReadout}
                </div>
              )}

              {/* Split View Original Overlay — styled directly after reference */}
              {viewMode === 'split' && !isCropMode && (
                <>
                  <div
                    style={{ clipPath: `inset(0 ${100 - splitPos}% 0 0)` }}
                    className="absolute inset-0 pointer-events-none"
                  >
                    <canvas
                      ref={originalCanvasRef}
                      style={{ width: displayWidth, height: displayHeight }}
                      className="block"
                    />
                  </div>

                  {/* Clean Frosted Corner Labels */}
                  <div className="absolute top-3 left-3 pointer-events-none px-2.5 py-1 rounded-lg bg-[#161824]/80 backdrop-blur-md border border-white/15 text-[11px] font-semibold text-white shadow-sm">
                    Original Source
                  </div>
                  <div className="absolute top-3 right-3 pointer-events-none px-2.5 py-1 rounded-lg bg-[#161824]/80 backdrop-blur-md border border-white/15 text-[11px] font-semibold text-white shadow-sm">
                    {item.hasRemovedBg ? 'AI Cutout (Alpha)' : 'Preview'}
                  </div>

                  {/* Interactive Violet Split Divider & Glass Handle */}
                  <div
                    style={{ left: `${splitPos}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      isSplittingRef.current = true;
                      viewportRef.current?.setPointerCapture(e.pointerId);
                    }}
                    className="absolute top-0 bottom-0 -translate-x-1/2 w-8 flex items-center justify-center cursor-ew-resize z-10 group"
                  >
                    <div className="w-[2px] h-full bg-[#E06D3B] shadow-[0_0_12px_rgba(224,109,59,0.65)]" />
                    <div className="absolute w-8 h-8 rounded-full bg-[#241D18]/92 backdrop-blur-md border border-white/30 ring-2 ring-[#E06D3B]/65 shadow-[0_6px_18px_rgba(44,30,18,0.42)] flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Columns2 className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>
                </>
              )}

              {/* Interactive Crop Box */}
              {isCropMode && (
                <div className="absolute inset-0 z-20">
                  <div
                    style={{
                      left: `${draftCrop.x * 100}%`,
                      top: `${draftCrop.y * 100}%`,
                      width: `${draftCrop.width * 100}%`,
                      height: `${draftCrop.height * 100}%`,
                      boxShadow: '0 0 0 9999px rgba(27, 29, 42, 0.52)',
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      cropDragRef.current = {
                        mode: 'move',
                        startX: e.clientX,
                        startY: e.clientY,
                        startRect: { ...draftCrop },
                      };
                      viewportRef.current?.setPointerCapture(e.pointerId);
                    }}
                    className="absolute border-2 border-white cursor-move"
                  >
                    {/* Rule of thirds grid */}
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/45" />
                      <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/45" />
                      <div className="absolute top-1/3 left-0 right-0 h-px bg-white/45" />
                      <div className="absolute top-2/3 left-0 right-0 h-px bg-white/45" />
                    </div>

                    {/* 8 Resize Handles */}
                    {(
                      [
                        { id: 'nw', cls: '-top-1.5 -left-1.5 cursor-nwse-resize' },
                        { id: 'n', cls: '-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize' },
                        { id: 'ne', cls: '-top-1.5 -right-1.5 cursor-nesw-resize' },
                        { id: 'e', cls: 'top-1/2 -translate-y-1/2 -right-1.5 cursor-ew-resize' },
                        { id: 'se', cls: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
                        { id: 's', cls: '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize' },
                        { id: 'sw', cls: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
                        { id: 'w', cls: 'top-1/2 -translate-y-1/2 -left-1.5 cursor-ew-resize' },
                      ] as const
                    ).map((h) => (
                      <div
                        key={h.id}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          cropDragRef.current = {
                            mode: h.id,
                            startX: e.clientX,
                            startY: e.clientY,
                            startRect: { ...draftCrop },
                          };
                          viewportRef.current?.setPointerCapture(e.pointerId);
                        }}
                        className={`absolute w-3.5 h-3.5 rounded-full bg-white border-2 border-[#E06D3B] shadow ${h.cls}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Real-time Web Worker ONNX AI Processing Overlay */}
              {item.status === 'processing' && (
                <div className="absolute inset-0 z-30 bg-[var(--bg-stage-overlay)] backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-full max-w-xs rounded-[26px] bg-[var(--bg-card)] border border-[var(--border-card)] p-5 shadow-[var(--shadow-modal)] space-y-3.5">
                    <div className="flex items-center justify-center gap-2 text-[var(--text-accent-bright)]">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="font-display text-sm font-bold text-[var(--text-primary)]">
                        Hang tight, almost done...
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] gap-2">
                        <span className="text-[var(--text-secondary)] font-semibold truncate">
                          {item.progress?.stage || 'Cleaning up the background'}
                        </span>
                        {item.progress?.percent !== null && item.progress?.percent !== undefined ? (
                          <span className="font-mono tabular-nums font-bold text-[var(--text-accent-bright)] shrink-0">
                            {item.progress.percent}%
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-[var(--emerald-text)] shrink-0">
                            Fast Mode
                          </span>
                        )}
                      </div>
                      <div className="h-2.5 rounded-full bg-[var(--slider-track)] overflow-hidden relative">
                        {item.progress?.percent !== null && item.progress?.percent !== undefined ? (
                          <div
                            className="h-full bg-gradient-to-r from-[#EE8250] to-[#D45B29] transition-[width] duration-150 rounded-full"
                            style={{ width: `${Math.max(2, item.progress.percent)}%` }}
                          />
                        ) : (
                          <div className="h-full bg-gradient-to-r from-[#EE8250] via-[#F4A57C] to-[#D45B29] rounded-full progress-indeterminate" />
                        )}
                      </div>
                      {item.progress?.detail && (
                        <div className="font-mono tabular-nums text-[10px] text-[var(--text-muted)] text-right">
                          {item.progress.detail}
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {item.progress?.percent !== null && item.progress?.percent !== undefined
                        ? 'Saving once for you — next time will be even quicker.'
                        : 'Running smoothly in the background so nothing freezes.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Prominent Floating One-Click "Remove Background" CTA when background not yet removed */}
            {!item.hasRemovedBg && item.status !== 'processing' && !isCropMode && (
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20">
                <button
                  type="button"
                  onClick={onTriggerAiRemove}
                  className="studio-cta inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full text-white text-sm font-bold whitespace-nowrap cursor-pointer"
                >
                  <Scissors className="w-4 h-4" />
                  <span>Remove Background</span>
                </button>
              </div>
            )}

            {/* Error Banner with Retry */}
            {item.status === 'error' && item.errorMessage && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 max-w-md w-[92%] rounded-2xl bg-[var(--bg-card)] border border-[var(--rose-border)] px-4 py-3 shadow-[var(--shadow-modal)] flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-[var(--rose-text)] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-[var(--rose-text)]">
                    Oops, something went wrong
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 break-words">
                    {item.errorMessage}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onTriggerAiRemove}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[var(--rose-bg)] hover:bg-[var(--rose-bg-hover)] border border-[var(--rose-border)] text-[var(--rose-text)] text-xs font-bold shrink-0 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  Try Again
                </button>
              </div>
            )}

            {/* Reset Pan hint if panned far away */}
            {(Math.abs(pan.x) > 40 || Math.abs(pan.y) > 40) && (
              <button
                type="button"
                onClick={fitToViewport}
                className="absolute bottom-4 right-4 z-20 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[var(--bg-card)] hover:bg-[var(--bg-accent-soft)] border border-[var(--border-card)] text-xs font-bold text-[var(--text-primary)] shadow-md cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[#E06D3B]" />
                Center Canvas
              </button>
            )}

            {/* Live Scaled Brush Ring Cursor */}
            {isBrushTool && cursorPos && (
              <div
                style={{
                  left: cursorPos.x,
                  top: cursorPos.y,
                  width: brushDisplayDiameter,
                  height: brushDisplayDiameter,
                  transform: 'translate(-50%, -50%)',
                }}
                className={`pointer-events-none absolute z-30 rounded-full border-2 shadow-[0_0_0_1px_rgba(255,255,255,0.9)] ${
                  activeTool === 'erase'
                    ? 'border-[#C84B31] bg-[#C84B31]/12'
                    : 'border-[#2F855A] bg-[#2F855A]/12'
                }`}
              />
            )}
          </>
        )}

        {/* Full-Stage Drag-and-Drop Overlay when an image is already open */}
        {isDragOver && item && (
          <div className="absolute inset-0 z-40 bg-[var(--bg-stage-overlay)] backdrop-blur-xs flex items-center justify-center pointer-events-none">
            <div className="rounded-3xl border-2 border-dashed border-[#E06D3B] bg-[var(--bg-card)] px-10 py-8 text-center shadow-[var(--shadow-modal)]">
              <Upload className="w-8 h-8 text-[#E06D3B] mx-auto mb-2" />
              <p className="font-display text-base font-bold text-[var(--text-primary)]">
                Yahan chhod do, photo add ho jayegi
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">JPG, PNG, WebP sab chalega</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
