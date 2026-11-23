import React, { useEffect, useState } from 'react';
import {
  Archive,
  Check,
  Copy,
  Download,
  Link2,
  Link2Off,
  Loader2,
  X,
} from 'lucide-react';
import {
  computeExportDimensions,
  exportBatchToZip,
  exportItemToBlob,
  formatBytes,
  getExtensionForFormat,
  getOutputDimensions,
  stripFileExtension,
  triggerBlobDownload,
} from '../engine/imagePipeline';
import type { ExportFormat, ExportOptions, StudioImageItem } from '../types/studio';
import { StudioSlider } from './StudioSlider';

interface ExportModalProps {
  open: boolean;
  activeItem: StudioImageItem | null;
  allItems: StudioImageItem[];
  onClose: () => void;
}

const FORMATS: Array<{ id: ExportFormat; label: string; desc: string }> = [
  { id: 'image/png', label: 'PNG', desc: 'Alpha Clr' },
  { id: 'image/jpeg', label: 'JPG', desc: 'Compressed' },
  { id: 'image/webp', label: 'WebP', desc: 'Modern Web' },
];

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  activeItem,
  allItems,
  onClose,
}) => {
  const [options, setOptions] = useState<ExportOptions>({
    format: 'image/png',
    quality: 92,
    scaleMode: 'original',
    customWidth: 1024,
    customHeight: 1024,
    lockAspect: true,
  });

  const [estimatedSize, setEstimatedSize] = useState<number | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !activeItem) return;
    const base = getOutputDimensions(activeItem, false);
    setOptions((prev) => ({
      ...prev,
      customWidth: base.width,
      customHeight: base.height,
    }));
    setExportError(null);
    setCopied(false);
  }, [open, activeItem]);

  useEffect(() => {
    if (!open || !activeItem) return;
    let cancelled = false;
    setIsEstimating(true);

    const timer = window.setTimeout(async () => {
      try {
        const blob = await exportItemToBlob(activeItem, options);
        if (!cancelled) {
          setEstimatedSize(blob.size);
        }
      } catch {
        if (!cancelled) setEstimatedSize(null);
      } finally {
        if (!cancelled) setIsEstimating(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, activeItem, options]);

  if (!open || !activeItem) return null;

  const baseDims = getOutputDimensions(activeItem, false);
  const finalDims = computeExportDimensions(activeItem, options);
  const aspect = baseDims.width / Math.max(1, baseDims.height);
  const ext = getExtensionForFormat(options.format);

  const handleDownloadSingle = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const blob = await exportItemToBlob(activeItem, options);
      const baseName = stripFileExtension(activeItem.name) || 'studio_export';
      triggerBlobDownload(blob, `${baseName}_cutout.${ext}`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyClipboard = async () => {
    setExportError(null);
    try {
      const blob = await exportItemToBlob(activeItem, {
        ...options,
        format: 'image/png',
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setExportError('Clipboard image copy is blocked by this browser context. Use Download instead.');
    }
  };

  const handleDownloadZip = async () => {
    setIsExporting(true);
    setExportError(null);
    setZipProgress({ current: 0, total: allItems.length });
    try {
      const zipBlob = await exportBatchToZip(allItems, options, (current, total) => {
        setZipProgress({ current, total });
      });
      triggerBlobDownload(zipBlob, `ChromaCut_Batch_${allItems.length}_Images.zip`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'ZIP export failed');
    } finally {
      setIsExporting(false);
      setZipProgress(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-overlay)] backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-[var(--bg-card)] border border-[var(--border-card)] shadow-[var(--shadow-modal)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-divider)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[var(--bg-accent-soft)] border border-[var(--border-accent)] text-[var(--text-accent-bright)] flex items-center justify-center shrink-0">
              <Download className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-[var(--text-primary)] tracking-tight">
                Save Your Photo
              </h2>
              <p className="text-xs text-[var(--text-muted)] truncate max-w-[260px]">
                {stripFileExtension(activeItem.name)}_cutout.{ext}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export dialog"
            className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              File Format
            </span>
            <div className="grid grid-cols-3 gap-2">
              {FORMATS.map((fmt) => {
                const active = options.format === fmt.id;
                return (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setOptions((prev) => ({ ...prev, format: fmt.id }))}
                    className={`flex flex-col items-center py-2.5 px-2 rounded-2xl border transition-all cursor-pointer ${
                      active
                        ? 'bg-[var(--bg-accent-soft)] text-[var(--text-accent)] border-[#E06D3B] shadow-[var(--shadow-accent)]'
                        : 'bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border-card)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    <span className="text-xs font-bold">{fmt.label}</span>
                    <span
                      className={`text-[10px] mt-0.5 ${
                        active ? 'text-[var(--text-accent-bright)]' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {fmt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
            {options.format === 'image/jpeg' && activeItem.edits.background.type === 'transparent' && (
              <p className="text-[11px] text-[var(--text-muted)]">
                JPG does not support alpha transparency; transparent areas will export with a crisp white backdrop.
              </p>
            )}
          </div>

          {options.format !== 'image/png' && (
            <StudioSlider
              label="Compression Quality"
              value={options.quality}
              min={10}
              max={100}
              step={1}
              unit="%"
              defaultValue={92}
              onChange={(quality) => setOptions((prev) => ({ ...prev, quality }))}
            />
          )}

          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Output Resolution
              </span>
              <span className="font-mono tabular-nums text-[11px] font-semibold text-[var(--text-primary)]">
                {finalDims.width} × {finalDims.height} px
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)]">
              {(
                [
                  { id: '0.5x', label: '0.5x' },
                  { id: 'original', label: '1x' },
                  { id: '2x', label: '2x' },
                  { id: 'custom', label: 'Custom' },
                ] as const
              ).map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => setOptions((prev) => ({ ...prev, scaleMode: sc.id }))}
                  className={`py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                    options.scaleMode === sc.id
                      ? 'bg-[var(--bg-card)] text-[var(--text-accent)] border border-[var(--border-accent)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                  }`}
                >
                  {sc.label}
                </button>
              ))}
            </div>

            {options.scaleMode === 'custom' && (
              <div className="flex items-end gap-2 pt-1">
                <label className="flex-1 space-y-1 text-[11px] font-medium text-[var(--text-muted)]">
                  <span>Width</span>
                  <input
                    type="number"
                    min={16}
                    max={4096}
                    value={options.customWidth}
                    onChange={(e) => {
                      const w = Math.max(16, Math.min(4096, parseInt(e.target.value, 10) || 16));
                      setOptions((prev) => ({
                        ...prev,
                        customWidth: w,
                        customHeight: prev.lockAspect ? Math.max(16, Math.round(w / aspect)) : prev.customHeight,
                      }));
                    }}
                    className="w-full h-9 px-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] font-mono tabular-nums text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#E06D3B] focus:bg-[var(--bg-input-focus)]"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setOptions((prev) => ({ ...prev, lockAspect: !prev.lockAspect }))}
                  className={`h-9 w-9 flex items-center justify-center rounded-xl border cursor-pointer shrink-0 transition-colors ${
                    options.lockAspect
                      ? 'bg-[var(--bg-accent-soft)] border-[var(--border-accent)] text-[var(--text-accent)]'
                      : 'bg-[var(--bg-subtle)] border-[var(--border-card)] text-[var(--text-muted)]'
                  }`}
                >
                  {options.lockAspect ? <Link2 className="w-4 h-4" /> : <Link2Off className="w-4 h-4" />}
                </button>

                <label className="flex-1 space-y-1 text-[11px] font-medium text-[var(--text-muted)]">
                  <span>Height</span>
                  <input
                    type="number"
                    min={16}
                    max={4096}
                    value={options.customHeight}
                    onChange={(e) => {
                      const h = Math.max(16, Math.min(4096, parseInt(e.target.value, 10) || 16));
                      setOptions((prev) => ({
                        ...prev,
                        customHeight: h,
                        customWidth: prev.lockAspect ? Math.max(16, Math.round(h * aspect)) : prev.customWidth,
                      }));
                    }}
                    className="w-full h-9 px-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] font-mono tabular-nums text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#E06D3B] focus:bg-[var(--bg-input-focus)]"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-card)]">
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)]">Quality Profile</div>
              <div className="text-[11px] text-[var(--text-muted)]">
                {options.format === 'image/png' ? 'Lossless RGBA Color Mapping' : `${options.quality}% ${ext.toUpperCase()} encoding`}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono tabular-nums text-sm font-bold text-[var(--teal-metric)]">
                {isEstimating ? (
                  <Loader2 className="w-4 h-4 animate-spin inline text-[#E06D3B]" />
                ) : estimatedSize !== null ? (
                  `~ ${formatBytes(estimatedSize)}`
                ) : (
                  '—'
                )}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">Est. Output</div>
            </div>
          </div>

          {exportError && (
            <p className="text-xs text-[var(--rose-text)] bg-[var(--rose-bg)] border border-[var(--rose-border)] rounded-xl px-3 py-2">
              {exportError}
            </p>
          )}

          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isExporting}
                onClick={handleDownloadSingle}
                className="studio-cta flex-1 flex items-center justify-center gap-2 py-2.5 px-5 rounded-full text-white text-sm font-bold disabled:opacity-50 cursor-pointer"
              >
                {isExporting && !zipProgress ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>
                  {options.format === 'image/png'
                    ? 'Save Clean PNG'
                    : `Save ${ext.toUpperCase()}`}
                </span>
              </button>

              <button
                type="button"
                onClick={handleCopyClipboard}
                title="Copy PNG to Clipboard"
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] border border-[var(--border-card)] text-[var(--text-secondary)] text-xs font-bold transition-all cursor-pointer active:scale-95"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-[var(--emerald-text)]" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            {allItems.length > 1 && (
              <button
                type="button"
                disabled={isExporting}
                onClick={handleDownloadZip}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-full bg-[var(--emerald-bg)] hover:bg-[var(--emerald-bg-hover)] border border-[var(--emerald-border)] text-[var(--emerald-text)] text-xs font-bold transition-all disabled:opacity-50 cursor-pointer active:scale-[0.98]"
              >
                {zipProgress ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="font-mono tabular-nums">
                      Packing ZIP ({zipProgress.current}/{zipProgress.total})...
                    </span>
                  </>
                ) : (
                  <>
                    <Archive className="w-4 h-4" />
                    <span>Save All {allItems.length} Photos as ZIP</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
