import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Crop,
  Download,
  FileImage,
  Heart,
  Keyboard,
  Layers,
  Moon,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Sun,
  SunMedium,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { BatchFilmstrip } from './components/BatchFilmstrip';
import { ExportModal } from './components/ExportModal';
import { InspectorPanel } from './components/InspectorPanel';
import { LeftToolRail } from './components/LeftToolRail';
import { QuickEditBar } from './components/QuickEditBar';
import { ShortcutsModal } from './components/ShortcutsModal';
import { StudioCanvas } from './components/StudioCanvas';
import {
  preloadBackgroundModel,
  preloadCachedModelIfAvailable,
  runOnnxBackgroundRemoval,
} from './engine/aiRemoval';
import {
  analyzeImageForAutoEnhance,
  createThumbnailDataUrl,
  exportItemToBlob,
  extractAlphaBytes,
  getOutputDimensions,
  loadBlobToStudioItem,
  preloadCustomBgImage,
  renderStudioComposite,
  stripFileExtension,
  triggerBlobDownload,
  writeAlphaBytes,
} from './engine/imagePipeline';
import type { SampleSubjectPreset } from './engine/studioAssets';
import {
  cloneEdits,
  createDefaultEdits,
  type AppTheme,
  type BrushSettings,
  type CheckerboardTone,
  type CropRect,
  type ImageEditSettings,
  type InspectorTab,
  type SnapGridSettings,
  type StudioImageItem,
  type ToolType,
  type ViewMode,
} from './types/studio';

const MAX_HISTORY = 30;

const SIDEBAR_SECTIONS: Array<{
  tab: InspectorTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { tab: 'cutout', label: 'Remove Background', icon: Scissors },
  { tab: 'backdrop', label: 'New Background', icon: Palette },
  { tab: 'effects', label: 'Shadow & Outline', icon: Layers },
  { tab: 'adjust', label: 'Enhance Photo', icon: SunMedium },
  { tab: 'transform', label: 'Crop & Resize', icon: Crop },
];

function readInitialTheme(): AppTheme {
  try {
    const saved = localStorage.getItem('chromacut-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // ignore storage restrictions
  }
  return 'light';
}

export default function App() {
  const [theme, setTheme] = useState<AppTheme>(readInitialTheme);
  const [items, setItems] = useState<StudioImageItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [activeTab, setActiveTab] = useState<InspectorTab>('cutout');
  const [viewMode, setViewMode] = useState<ViewMode>('result');
  const [checkerboard, setCheckerboard] = useState<CheckerboardTone>(() =>
    readInitialTheme() === 'dark' ? 'dark' : 'light'
  );
  const [snapGrid, setSnapGrid] = useState<SnapGridSettings>({ enabled: false, divisions: 8 });
  const [brush, setBrush] = useState<BrushSettings>({ size: 36, hardness: 70 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitSignal, setFitSignal] = useState(0);
  const [bgImageVersion, setBgImageVersion] = useState(0);

  const [desktopInspectorOpen, setDesktopInspectorOpen] = useState(true);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [toast, setToast] = useState<{ message: string; tone?: 'info' | 'error' } | null>(null);

  const headerFileInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<StudioImageItem[]>(items);
  itemsRef.current = items;

  const activeItem = items.find((i) => i.id === activeId) ?? null;

  const showToast = useCallback((message: string, tone: 'info' | 'error' = 'info') => {
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('chromacut-theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  // Silently warm up Web Worker session on startup if ONNX model is already in local cache (0 network cost)
  useEffect(() => {
    void preloadCachedModelIfAvailable();
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: AppTheme = prev === 'dark' ? 'light' : 'dark';
      setCheckerboard(next === 'dark' ? 'dark' : 'light');
      showToast(next === 'dark' ? 'Switched to Dark Mode' : 'Switched to Light Mode');
      return next;
    });
  }, [showToast]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Helper to update a single item cleanly
  const patchItem = useCallback(
    (id: string, updater: (item: StudioImageItem) => StudioImageItem) => {
      setItems((prev) => prev.map((it) => (it.id === id ? updater(it) : it)));
    },
    []
  );

  // Refresh thumbnail from current composited output
  const refreshThumbnail = useCallback((item: StudioImageItem): string => {
    const tmp = document.createElement('canvas');
    const dims = getOutputDimensions(item, false);
    const scale = Math.min(1, 144 / Math.max(dims.width, dims.height));
    renderStudioComposite(item, tmp, {
      mode: 'result',
      targetWidth: Math.max(1, Math.round(dims.width * scale)),
      targetHeight: Math.max(1, Math.round(dims.height * scale)),
      fastPreview: true,
    });
    return createThumbnailDataUrl(tmp, 144);
  }, []);

  // Push a history entry for undo/redo (supports prebuiltAlpha & deferred thumbnail for instant display)
  const pushHistoryEntry = useCallback(
    (
      item: StudioImageItem,
      label: string,
      nextEdits?: ImageEditSettings,
      nextHasRemoved?: boolean,
      prebuiltAlpha?: Uint8Array,
      skipThumbnail = false
    ): StudioImageItem => {
      const editsToStore = cloneEdits(nextEdits ?? item.edits);
      const hasRemoved = nextHasRemoved ?? item.hasRemovedBg;
      const alphaSnapshot = prebuiltAlpha ? new Uint8Array(prebuiltAlpha) : extractAlphaBytes(item.maskCanvas);
      const baseHistory = item.history.slice(0, item.historyIndex + 1);
      const nextHistory = [
        ...baseHistory,
        {
          id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label,
          timestamp: Date.now(),
          edits: editsToStore,
          alphaSnapshot,
          hasRemovedBg: hasRemoved,
        },
      ].slice(-MAX_HISTORY);

      const updated: StudioImageItem = {
        ...item,
        edits: editsToStore,
        hasRemovedBg: hasRemoved,
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
      };
      if (!skipThumbnail) {
        updated.thumbnailUrl = refreshThumbnail(updated);
      }
      return updated;
    },
    [refreshThumbnail]
  );

  // Run 100% client-side @imgly/background-removal from CDN on a target image ID
  const runAiRemovalForItem = useCallback(
    async (targetId: string): Promise<boolean> => {
      const target = itemsRef.current.find((i) => i.id === targetId);
      if (!target || target.status === 'processing') return false;

      patchItem(targetId, (it) => ({
        ...it,
        status: 'processing',
        errorMessage: undefined,
        progress: { stage: 'Working on it, give me a second...', percent: null },
      }));

      try {
        const { alphaMask } = await runOnnxBackgroundRemoval(target.sourceCanvas, (progress) => {
          patchItem(targetId, (it) => ({
            ...it,
            status: 'processing',
            progress,
          }));
        });

        const latest = itemsRef.current.find((i) => i.id === targetId);
        if (!latest) return false;

        // Immediately apply alpha mask and flip state to 'done' on the very same frame
        writeAlphaBytes(latest.maskCanvas, alphaMask);
        latest.maskRevision += 1;

        patchItem(targetId, (it) => {
          const nextEdits = cloneEdits(it.edits);
          const withAi: StudioImageItem = {
            ...it,
            aiMaskSnapshot: new Uint8Array(alphaMask),
            hasRemovedBg: true,
            status: 'done',
            progress: undefined,
            errorMessage: undefined,
          };
          return pushHistoryEntry(withAi, 'AI Background Removal', nextEdits, true, alphaMask, true);
        });

        if (activeId === targetId) {
          setViewMode('result');
        }

        // Update filmstrip thumbnail asynchronously AFTER the cutout has already painted on screen
        requestAnimationFrame(() => {
          const current = itemsRef.current.find((i) => i.id === targetId);
          if (!current) return;
          const nextThumb = refreshThumbnail(current);
          patchItem(targetId, (it) => ({ ...it, thumbnailUrl: nextThumb }));
        });

        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Background removal failed unexpectedly';
        patchItem(targetId, (it) => ({
          ...it,
          status: 'error',
          progress: undefined,
          errorMessage: message,
        }));
        showToast(message, 'error');
        return false;
      }
    },
    [patchItem, pushHistoryEntry, refreshThumbnail, activeId, showToast]
  );

  // Add uploaded files and automatically remove background in browser -> PNG preview
  const handleAddFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) {
        showToast('Please select a valid JPG, PNG, or WebP image.', 'error');
        return;
      }

      const loaded: StudioImageItem[] = [];
      for (const file of files) {
        try {
          const item = await loadBlobToStudioItem(file, file.name, file.size);
          loaded.push(item);
        } catch (err) {
          showToast(
            err instanceof Error ? err.message : `Failed to load ${file.name}`,
            'error'
          );
        }
      }

      if (loaded.length > 0) {
        const nextItems = [...itemsRef.current, ...loaded];
        itemsRef.current = nextItems;
        setItems(nextItems);
        setActiveId(loaded[0].id);
        setViewMode('result');
        setActiveTool('select');
        setActiveTab('cutout');

        // Automatically remove background in browser on upload so user sees loading -> PNG preview
        const first = loaded[0];
        if (!first.hasRemovedBg) {
          void runAiRemovalForItem(first.id).then((ok) => {
            if (ok) {
              showToast('Background removed — transparent PNG ready');
            }
          });
        } else {
          preloadBackgroundModel();
          showToast(`Loaded "${first.name}" (${first.width}×${first.height}) — transparent PNG ready`);
        }
      }
    },
    [showToast, runAiRemovalForItem]
  );

  // Load built-in sample subject
  const handleLoadSample = useCallback(
    async (preset: SampleSubjectPreset) => {
      try {
        const blob = await preset.renderToBlob();
        const item = await loadBlobToStudioItem(blob, preset.filename, blob.size);
        const nextItems = [...itemsRef.current, item];
        itemsRef.current = nextItems;
        setItems(nextItems);
        setActiveId(item.id);
        setViewMode('result');
        setActiveTool('select');
        setActiveTab('cutout');
        preloadBackgroundModel();
        showToast(`Loaded sample "${preset.name}"`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to load sample', 'error');
      }
    },
    [showToast]
  );

  // Close a specific image tab (used by Close Tab button next to Export + filmstrip trash)
  const handleCloseItem = useCallback(
    (idToRemove: string) => {
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === idToRemove);
        if (idx === -1) return prev;
        const next = prev.filter((i) => i.id !== idToRemove);
        if (activeId === idToRemove) {
          const fallback = next[Math.min(idx, next.length - 1)] ?? null;
          setActiveId(fallback ? fallback.id : null);
          if (!fallback) {
            setActiveTool('select');
          }
        }
        return next;
      });
    },
    [activeId]
  );

  const handleTriggerActiveAiRemove = useCallback(async () => {
    if (!activeItem) return;
    const ok = await runAiRemovalForItem(activeItem.id);
    if (ok) {
      showToast('Background removed — transparent PNG ready');
    }
  }, [activeItem, runAiRemovalForItem, showToast]);

  // Batch remove backgrounds across all unprocessed queued images
  const handleBatchRemoveAll = useCallback(async () => {
    const queue = itemsRef.current.filter((i) => !i.hasRemovedBg && i.status !== 'processing');
    if (queue.length === 0) return;

    setIsBatchRunning(true);
    setBatchProgress({ current: 0, total: queue.length });
    let completed = 0;

    for (let i = 0; i < queue.length; i++) {
      setBatchProgress({ current: i + 1, total: queue.length });
      const ok = await runAiRemovalForItem(queue[i].id);
      if (ok) completed++;
    }

    setIsBatchRunning(false);
    setBatchProgress(null);
    showToast(`Batch finished: ${completed}/${queue.length} cutouts ready`);
  }, [runAiRemovalForItem, showToast]);

  // Apply active image's style (backdrop, effects, adjustments, matting) to all queued images
  const handleApplyStyleToAll = useCallback(() => {
    if (!activeItem || items.length < 2) return;
    const template = activeItem.edits;
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === activeItem.id) return it;
        const merged: ImageEditSettings = {
          matting: { ...template.matting },
          background: {
            ...template.background,
            gradient: { ...template.background.gradient },
          },
          effects: {
            shadow: { ...template.effects.shadow },
            outline: { ...template.effects.outline },
          },
          adjustments: { ...template.adjustments },
          transform: cloneEdits(it.edits).transform,
        };
        return pushHistoryEntry(it, 'Sync Style from Active', merged);
      })
    );
    showToast(`Applied backdrop, effects & color style to all ${items.length} images`);
  }, [activeItem, items.length, pushHistoryEntry, showToast]);

  // Update edits on active item (optional commitLabel pushes to Undo history)
  const handleUpdateEdits = useCallback(
    (updater: (edits: ImageEditSettings) => ImageEditSettings, commitLabel?: string) => {
      if (!activeId) return;
      patchItem(activeId, (it) => {
        const nextEdits = updater(cloneEdits(it.edits));
        if (commitLabel) {
          return pushHistoryEntry(it, commitLabel, nextEdits);
        }
        return { ...it, edits: nextEdits };
      });
    },
    [activeId, patchItem, pushHistoryEntry]
  );

  // Brush stroke finished -> commit to Undo history
  const handleBrushStrokeCommit = useCallback(() => {
    if (!activeId) return;
    patchItem(activeId, (it) =>
      pushHistoryEntry(
        it,
        activeTool === 'erase' ? 'Erase Brush Stroke' : 'Restore Brush Stroke',
        it.edits,
        true
      )
    );
  }, [activeId, activeTool, patchItem, pushHistoryEntry]);

  // Reset mask to AI snapshot
  const handleResetToAiMask = useCallback(() => {
    if (!activeItem || !activeItem.aiMaskSnapshot) return;
    writeAlphaBytes(activeItem.maskCanvas, activeItem.aiMaskSnapshot);
    activeItem.maskRevision += 1;
    patchItem(activeItem.id, (it) => pushHistoryEntry(it, 'Reset to AI Mask', it.edits, true));
    showToast('Mask reset to original AI cutout');
  }, [activeItem, patchItem, pushHistoryEntry, showToast]);

  // Restore full opaque original mask
  const handleRestoreFullMask = useCallback(() => {
    if (!activeItem) return;
    const full = new Uint8Array(activeItem.width * activeItem.height).fill(255);
    writeAlphaBytes(activeItem.maskCanvas, full);
    activeItem.maskRevision += 1;
    patchItem(activeItem.id, (it) => pushHistoryEntry(it, 'Restore Full Photo', it.edits, false));
    showToast('Restored full original photo');
  }, [activeItem, patchItem, pushHistoryEntry, showToast]);

  // Upload custom replacement background image
  const handleUploadCustomBg = useCallback(
    async (file: File) => {
      if (!activeId) return;
      const url = URL.createObjectURL(file);
      try {
        await preloadCustomBgImage(url);
        setBgImageVersion((v) => v + 1);
        patchItem(activeId, (it) => {
          const nextEdits = cloneEdits(it.edits);
          nextEdits.background.type = 'image';
          nextEdits.background.imageId = 'custom';
          nextEdits.background.customImageUrl = url;
          return pushHistoryEntry(it, 'Custom Background Image', nextEdits);
        });
        showToast(`Background replaced with "${file.name}"`);
      } catch {
        URL.revokeObjectURL(url);
        showToast('Could not load replacement background image', 'error');
      }
    },
    [activeId, patchItem, pushHistoryEntry, showToast]
  );

  // Apply crop from canvas
  const handleApplyCrop = useCallback(
    (crop: CropRect | null) => {
      if (!activeId) return;
      patchItem(activeId, (it) => {
        const nextEdits = cloneEdits(it.edits);
        nextEdits.transform.crop = crop;
        return pushHistoryEntry(it, 'Crop Image', nextEdits);
      });
      setActiveTool('select');
      setFitSignal((s) => s + 1);
    },
    [activeId, patchItem, pushHistoryEntry]
  );

  // Update cutout subject position from canvas drag (with optional history commit)
  const handlePositionChange = useCallback(
    (offsetX: number, offsetY: number, commit = false) => {
      if (!activeId) return;
      patchItem(activeId, (it) => {
        const nextEdits = cloneEdits(it.edits);
        nextEdits.transform.offsetX = offsetX;
        nextEdits.transform.offsetY = offsetY;
        return commit
          ? pushHistoryEntry(it, 'Reposition Subject', nextEdits)
          : { ...it, edits: nextEdits };
      });
    },
    [activeId, patchItem, pushHistoryEntry]
  );

  // One-Click Real Histogram Auto Enhance
  const handleAutoEnhance = useCallback(() => {
    if (!activeItem) return;
    const enhancedAdj = analyzeImageForAutoEnhance(activeItem);
    patchItem(activeItem.id, (it) => {
      const nextEdits = cloneEdits(it.edits);
      nextEdits.adjustments = enhancedAdj;
      return pushHistoryEntry(it, 'Auto Enhance', nextEdits);
    });
    showToast('Auto Enhance applied — tone, clarity & sharpness optimized');
  }, [activeItem, patchItem, pushHistoryEntry, showToast]);

  // Reset all edits on active item
  const handleResetAllEdits = useCallback(() => {
    if (!activeItem) return;
    const fresh = createDefaultEdits(activeItem.width, activeItem.height);
    patchItem(activeItem.id, (it) => pushHistoryEntry(it, 'Reset All Edits', fresh));
    showToast('Reset all edits to default');
  }, [activeItem, patchItem, pushHistoryEntry, showToast]);

  // Undo & Redo
  const canUndo = !!activeItem && activeItem.historyIndex > 0;
  const canRedo = !!activeItem && activeItem.historyIndex < activeItem.history.length - 1;

  const handleUndo = useCallback(() => {
    if (!activeItem || activeItem.historyIndex <= 0) return;
    const nextIdx = activeItem.historyIndex - 1;
    const entry = activeItem.history[nextIdx];
    writeAlphaBytes(activeItem.maskCanvas, entry.alphaSnapshot);
    activeItem.maskRevision += 1;
    patchItem(activeItem.id, (it) => {
      const updated: StudioImageItem = {
        ...it,
        edits: cloneEdits(entry.edits),
        hasRemovedBg: entry.hasRemovedBg,
        historyIndex: nextIdx,
      };
      updated.thumbnailUrl = refreshThumbnail(updated);
      return updated;
    });
  }, [activeItem, patchItem, refreshThumbnail]);

  const handleRedo = useCallback(() => {
    if (!activeItem || activeItem.historyIndex >= activeItem.history.length - 1) return;
    const nextIdx = activeItem.historyIndex + 1;
    const entry = activeItem.history[nextIdx];
    writeAlphaBytes(activeItem.maskCanvas, entry.alphaSnapshot);
    activeItem.maskRevision += 1;
    patchItem(activeItem.id, (it) => {
      const updated: StudioImageItem = {
        ...it,
        edits: cloneEdits(entry.edits),
        hasRemovedBg: entry.hasRemovedBg,
        historyIndex: nextIdx,
      };
      updated.thumbnailUrl = refreshThumbnail(updated);
      return updated;
    });
  }, [activeItem, patchItem, refreshThumbnail]);

  // 1-Click Direct Transparent PNG Download
  const handleQuickDownloadPng = useCallback(async () => {
    if (!activeItem) return;
    try {
      const dims = getOutputDimensions(activeItem, false);
      const blob = await exportItemToBlob(activeItem, {
        format: 'image/png',
        quality: 100,
        scaleMode: 'original',
        customWidth: dims.width,
        customHeight: dims.height,
        lockAspect: true,
      });
      const base = stripFileExtension(activeItem.name) || 'chromacut';
      triggerBlobDownload(blob, `${base}_cutout.png`);
      showToast('Downloaded transparent PNG');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PNG download failed', 'error');
    }
  }, [activeItem, showToast]);

  // Global Clipboard Paste (Ctrl+V)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const itemsList = e.clipboardData?.items;
      if (!itemsList) return;
      const pastedFiles: File[] = [];
      for (let i = 0; i < itemsList.length; i++) {
        if (itemsList[i].type.startsWith('image/')) {
          const f = itemsList[i].getAsFile();
          if (f) pastedFiles.push(f);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        handleAddFiles(pastedFiles);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleAddFiles]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        if (exportOpen) setExportOpen(false);
        else if (shortcutsOpen) setShortcutsOpen(false);
        else if (activeTool === 'crop') setActiveTool('select');
        return;
      }

      if (isTyping) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }

      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (mod && e.key.toLowerCase() === 'e') {
        if (activeItem) {
          e.preventDefault();
          setExportOpen(true);
        }
        return;
      }

      if (e.altKey && e.key.toLowerCase() === 'w') {
        if (activeItem) {
          e.preventDefault();
          handleCloseItem(activeItem.id);
        }
        return;
      }

      if (mod || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === '?') {
        setShortcutsOpen((prev) => !prev);
      } else if (key === 'v') {
        setActiveTool('select');
      } else if (key === 'e' && activeItem) {
        setActiveTool('erase');
        setActiveTab('cutout');
      } else if (key === 'r' && activeItem) {
        setActiveTool('restore');
        setActiveTab('cutout');
      } else if (key === 'c' && activeItem) {
        setActiveTool('crop');
        setActiveTab('transform');
      } else if (key === 'h' && activeItem) {
        setActiveTool('pan');
      } else if (key === 'z' && activeItem) {
        setActiveTool('zoom');
      } else if (key === 'b' && activeItem) {
        handleTriggerActiveAiRemove();
      } else if (key === 'm' && activeItem) {
        setViewMode((prev) => (prev === 'mask' ? 'result' : 'mask'));
      } else if (key === 'g' && activeItem) {
        setSnapGrid((prev) => {
          const nextEnabled = !prev.enabled;
          showToast(
            nextEnabled
              ? `Snap-to-grid enabled (${prev.divisions}×${prev.divisions})`
              : 'Snap-to-grid overlay hidden'
          );
          return { ...prev, enabled: nextEnabled };
        });
      } else if (key === 't') {
        toggleTheme();
      } else if (key === '[') {
        setBrush((b) => ({ ...b, size: Math.max(4, b.size - 6) }));
      } else if (key === ']') {
        setBrush((b) => ({ ...b, size: Math.min(200, b.size + 6) }));
      } else if (key === '=' || key === '+') {
        setZoom((z) => Math.min(8, z * 1.25));
      } else if (key === '-') {
        setZoom((z) => Math.max(0.08, z / 1.25));
      } else if (key === '0') {
        setFitSignal((s) => s + 1);
      } else if (key === '1') {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeItem,
    activeTool,
    exportOpen,
    shortcutsOpen,
    handleUndo,
    handleRedo,
    handleCloseItem,
    handleTriggerActiveAiRemove,
    toggleTheme,
    showToast,
  ]);

  const outDims = activeItem ? getOutputDimensions(activeItem, false) : null;

  return (
    <div className="h-screen w-screen flex bg-[var(--bg-app)] text-[var(--text-primary)] overflow-hidden transition-colors">
      <input
        ref={headerFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp,image/avif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleAddFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Organized Left SaaS Sidebar Navigation (xl+ desktop) */}
      <aside
        aria-label="Studio Navigation"
        className="hidden xl:flex flex-col justify-between w-[220px] bg-[var(--bg-panel)] border-r border-[var(--border-main)] px-3.5 py-4 shrink-0 z-30 transition-colors"
      >
        <div className="space-y-6">
          {/* Brand Logo — Website name preserved strictly */}
          <div className="flex items-center gap-2.5 px-1.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-[#EE8250] via-[#E06D3B] to-[#C85627] ring-1 ring-inset ring-white/25 flex items-center justify-center shadow-md shadow-[#E06D3B]/25 shrink-0">
              <Scissors className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="leading-tight min-w-0">
              <div className="font-display text-[16px] font-bold text-[var(--text-primary)] tracking-tight truncate">
                ChromaCut
              </div>
              <div className="text-[11px] font-semibold text-[var(--text-muted)]">Studio Suite</div>
            </div>
          </div>

          {/* Primary Functional Studio Sections */}
          <nav className="space-y-1.5">
            {SIDEBAR_SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const active = activeTab === sec.tab;
              return (
                <button
                  key={sec.tab}
                  type="button"
                  onClick={() => {
                    setActiveTab(sec.tab);
                    setDesktopInspectorOpen(true);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl text-[13px] transition-all cursor-pointer active:scale-[0.98] ${
                    active
                      ? 'bg-[var(--bg-accent-soft)] text-[var(--text-accent)] font-bold shadow-[var(--shadow-accent)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] font-semibold'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      active ? 'text-[var(--text-accent-bright)]' : 'text-[var(--text-muted)]'
                    }`}
                  />
                  <span className="truncate">{sec.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Utility Actions (100% Real & Working) */}
        <div className="space-y-2 pt-4 border-t border-[var(--border-divider)]">
          {/* Tactile Segmented Light / Dark Mode Switch */}
          <div
            role="group"
            aria-label="Theme mode"
            className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-card)]"
          >
            <button
              type="button"
              onClick={() => {
                if (theme !== 'light') toggleTheme();
              }}
              aria-pressed={theme === 'light'}
              title="Light Mode (T)"
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                theme === 'light'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs border border-[var(--border-card)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
              }`}
            >
              <Sun className={`w-3.5 h-3.5 ${theme === 'light' ? 'text-[#E06D3B]' : ''}`} />
              <span>Light</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (theme !== 'dark') toggleTheme();
              }}
              aria-pressed={theme === 'dark'}
              title="Dark Mode (T)"
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                theme === 'dark'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs border border-[var(--border-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
              }`}
            >
              <Moon className={`w-3.5 h-3.5 ${theme === 'dark' ? 'text-[#F28A58]' : ''}`} />
              <span>Dark</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => headerFileInputRef.current?.click()}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-2xl text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4 text-[var(--text-muted)]" />
            <span>Add Your Photo</span>
          </button>

          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-2xl text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
          >
            <Keyboard className="w-4 h-4 text-[var(--text-muted)]" />
            <span>Shortcuts</span>
          </button>

          {/* Subtle Human Footer Touch */}
          <div className="pt-2.5 px-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]">
            <Heart className="w-3 h-3 text-[#E06D3B] fill-[#E06D3B]/30" />
            <span>Made with care</span>
          </div>
        </div>
      </aside>

      {/* Right Main Shell: Top Bar + Workspace */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Top Studio Header Bar */}
        <header className="h-14 px-2.5 sm:px-4 flex items-center justify-between gap-1.5 sm:gap-2 bg-[var(--bg-panel-translucent)] backdrop-blur-md border-b border-[var(--border-main)] shrink-0 z-30 transition-colors">
          {/* Zone 1: Compact Brand (below xl) + Clean File Info + Undo/Redo/Reset */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            <div className="flex xl:hidden items-center gap-2 shrink-0">
              <div className="w-8 h-8 rounded-2xl bg-gradient-to-br from-[#EE8250] via-[#E06D3B] to-[#C85627] ring-1 ring-inset ring-white/25 flex items-center justify-center shadow-sm shadow-[#E06D3B]/25">
                <Scissors className="w-4 h-4 text-white" />
              </div>
              <span className="hidden sm:inline font-display text-[15px] font-bold text-[var(--text-primary)] tracking-tight">
                ChromaCut
              </span>
            </div>

            {activeItem && outDims ? (
              <div className="hidden md:flex items-center gap-2 px-2 py-1 min-w-0">
                <FileImage className="w-4 h-4 text-[#E06D3B] shrink-0" />
                <span className="text-xs font-bold text-[var(--text-primary)] truncate max-w-[180px]">
                  {activeItem.name}
                </span>
                <span className="text-[var(--border-strong)] select-none">·</span>
                <span className="font-mono tabular-nums text-[11px] font-medium text-[var(--text-muted)] shrink-0">
                  {outDims.width}×{outDims.height} px
                </span>
              </div>
            ) : (
              <div className="hidden md:flex items-center gap-1.5 px-2 py-1 min-w-0">
                <span className="text-xs font-semibold text-[var(--text-muted)] truncate">
                  Free{' '}
                  <span className="inline-flex items-center px-2 py-0.5 mx-0.5 rounded-full bg-[var(--bg-accent-soft-hover)] border border-[var(--border-accent)] font-extrabold text-[var(--text-accent)]">
                    Background Remover
                  </span>{' '}
                  — No fuss, no sign-up, just drop a photo and you&apos;re done.
                </span>
              </div>
            )}

            <div className={`${activeItem ? 'flex' : 'hidden sm:flex'} items-center gap-0.5 sm:gap-1 sm:pl-1 shrink-0`}>
              <button
                type="button"
                disabled={!canUndo}
                onClick={handleUndo}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                className="p-1.5 sm:p-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={!canRedo}
                onClick={handleRedo}
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
                className="p-1.5 sm:p-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <Redo2 className="w-4 h-4" />
              </button>
              {activeItem && (
                <button
                  type="button"
                  onClick={handleResetAllEdits}
                  title="Reset All Edits"
                  aria-label="Reset All Edits"
                  className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">Reset</span>
                </button>
              )}
            </div>
          </div>

          {/* Zone 2: Theme Toggle, Upload, Download PNG, Export, Close Tab (X), Inspector Toggle */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Crisp Light / Dark Mode Switcher */}
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode (T)' : 'Switch to Dark Mode (T)'}
              aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-pressed={theme === 'dark'}
              className="inline-flex items-center justify-center gap-1.5 w-8 h-8 sm:w-auto sm:h-auto sm:px-3 sm:py-1.5 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] shadow-2xs text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer active:scale-95"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-[#F28A58]" />
                  <span className="hidden md:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-[#E06D3B]" />
                  <span className="hidden md:inline">Dark</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => headerFileInputRef.current?.click()}
              title="Choose Your Photo"
              aria-label="Choose Your Photo"
              className="inline-flex items-center justify-center gap-1.5 w-8 h-8 sm:w-auto sm:h-auto sm:px-3.5 sm:py-1.5 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] shadow-2xs text-xs font-bold text-[var(--text-primary)] transition-all cursor-pointer active:scale-95"
            >
              <Upload className="w-3.5 h-3.5 text-[var(--text-accent-bright)]" />
              <span className="hidden sm:inline">Add Photo</span>
            </button>

            {activeItem && activeItem.hasRemovedBg && (
              <button
                type="button"
                onClick={handleQuickDownloadPng}
                title="Save clean transparent PNG"
                className="hidden md:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--emerald-bg)] hover:bg-[var(--emerald-bg-hover)] border border-[var(--emerald-border)] text-[var(--emerald-text)] shadow-2xs text-xs font-bold transition-all cursor-pointer active:scale-95"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save PNG</span>
              </button>
            )}

            <button
              type="button"
              disabled={!activeItem}
              onClick={() => setExportOpen(true)}
              title="Save / Export Options — PNG, JPG, WebP, ZIP (Ctrl+E)"
              className="studio-cta inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-full disabled:opacity-35 disabled:pointer-events-none text-white text-xs font-bold whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>

            {/* Working Close Tab button right next to Export */}
            <button
              type="button"
              disabled={!activeItem}
              onClick={() => {
                if (activeItem) {
                  const closedName = activeItem.name;
                  handleCloseItem(activeItem.id);
                  showToast(`Closed "${closedName}"`);
                }
              }}
              title="Close Current Image Tab (Alt+W)"
              aria-label="Close Current Image Tab"
              className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--rose-bg)] hover:text-[var(--rose-text)] border border-[var(--border-card)] hover:border-[var(--rose-border)] text-[var(--text-muted)] disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer active:scale-95"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Desktop Inspector Collapse Toggle */}
            <button
              type="button"
              onClick={() => setDesktopInspectorOpen((v) => !v)}
              title={desktopInspectorOpen ? 'Hide Inspector Panel' : 'Show Inspector Panel'}
              aria-label="Toggle Inspector Panel"
              className="hidden lg:inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer active:scale-95"
            >
              {desktopInspectorOpen ? (
                <PanelRightClose className="w-4 h-4" />
              ) : (
                <PanelRightOpen className="w-4 h-4" />
              )}
            </button>

            {/* Mobile Inspector Drawer Toggle */}
            <button
              type="button"
              onClick={() => setMobileInspectorOpen(true)}
              aria-label="Open Inspector Settings"
              className="inline-flex lg:hidden items-center justify-center w-8 h-8 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] text-[var(--text-secondary)] cursor-pointer active:scale-95"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Main Workspace: Tool Rail | Center Canvas + Filmstrip | Right Inspector */}
        <div className="flex-1 flex flex-col-reverse md:flex-row min-h-0 overflow-hidden">
          <LeftToolRail
            activeTool={activeTool}
            hasImage={!!activeItem}
            isProcessing={activeItem?.status === 'processing'}
            onSelectTool={(tool) => {
              setActiveTool(tool);
              if (tool === 'erase' || tool === 'restore') setActiveTab('cutout');
              if (tool === 'crop') setActiveTab('transform');
            }}
            onTriggerAiRemove={handleTriggerActiveAiRemove}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />

          <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            <StudioCanvas
              item={activeItem}
              activeTool={activeTool}
              viewMode={viewMode}
              checkerboard={checkerboard}
              snapGrid={snapGrid}
              brush={brush}
              zoom={zoom}
              pan={pan}
              bgImageVersion={bgImageVersion}
              onZoomChange={setZoom}
              onPanChange={setPan}
              onViewModeChange={setViewMode}
              onCheckerboardChange={setCheckerboard}
              onSnapGridChange={setSnapGrid}
              onPositionChange={handlePositionChange}
              onFilesDropped={handleAddFiles}
              onLoadSample={handleLoadSample}
              onTriggerAiRemove={handleTriggerActiveAiRemove}
              onBrushStrokeCommit={handleBrushStrokeCommit}
              onApplyCrop={handleApplyCrop}
              onCancelCrop={() => setActiveTool('select')}
              fitSignal={fitSignal}
            />

            <QuickEditBar
              item={activeItem}
              activeTool={activeTool}
              onSelectTool={(tool) => {
                setActiveTool(tool);
                if (tool === 'crop') setActiveTab('transform');
              }}
              onUpdateEdits={handleUpdateEdits}
            />

            <BatchFilmstrip
              items={items}
              activeId={activeId}
              isBatchRunning={isBatchRunning}
              batchProgress={batchProgress}
              onSelect={(id) => {
                setActiveId(id);
                setActiveTool('select');
              }}
              onRemove={handleCloseItem}
              onAddFiles={handleAddFiles}
              onBatchRemoveAll={handleBatchRemoveAll}
              onApplyStyleToAll={handleApplyStyleToAll}
              onOpenBatchExport={() => setExportOpen(true)}
            />
          </main>

          <InspectorPanel
            item={activeItem}
            activeTab={activeTab}
            activeTool={activeTool}
            viewMode={viewMode}
            brush={brush}
            checkerboard={checkerboard}
            snapGrid={snapGrid}
            desktopOpen={desktopInspectorOpen}
            mobileOpen={mobileInspectorOpen}
            onTabChange={setActiveTab}
            onSelectTool={(tool) => {
              setActiveTool(tool);
              if (tool === 'erase' || tool === 'restore') setActiveTab('cutout');
              if (tool === 'crop') setActiveTab('transform');
            }}
            onViewModeChange={setViewMode}
            onBrushChange={setBrush}
            onCheckerboardChange={setCheckerboard}
            onSnapGridChange={setSnapGrid}
            onCloseMobile={() => setMobileInspectorOpen(false)}
            onTriggerAiRemove={handleTriggerActiveAiRemove}
            onAutoEnhance={handleAutoEnhance}
            onQuickDownloadPng={handleQuickDownloadPng}
            onResetToAiMask={handleResetToAiMask}
            onRestoreFullMask={handleRestoreFullMask}
            onUpdateEdits={handleUpdateEdits}
            onUploadCustomBg={handleUploadCustomBg}
          />
        </div>
      </div>

      {/* Export Dialog */}
      <ExportModal
        open={exportOpen}
        activeItem={activeItem}
        allItems={items}
        onClose={() => setExportOpen(false)}
      />

      {/* Keyboard Shortcuts Modal */}
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Subtle Bottom Toast Feedback */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-xs font-semibold shadow-[var(--shadow-modal)] border backdrop-blur-md pointer-events-none ${
            toast.tone === 'error'
              ? 'bg-[var(--rose-bg)] border-[var(--rose-border)] text-[var(--rose-text)]'
              : 'bg-[var(--bg-card)] border-[var(--border-accent)] text-[var(--text-primary)]'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
