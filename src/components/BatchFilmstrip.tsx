import React, { useRef } from 'react';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  CopyCheck,
  Loader2,
  Plus,
  Scissors,
  Trash2,
} from 'lucide-react';
import type { StudioImageItem } from '../types/studio';

interface BatchFilmstripProps {
  items: StudioImageItem[];
  activeId: string | null;
  isBatchRunning: boolean;
  batchProgress: { current: number; total: number } | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAddFiles: (files: FileList | File[]) => void;
  onBatchRemoveAll: () => void;
  onApplyStyleToAll: () => void;
  onOpenBatchExport: () => void;
}

export const BatchFilmstrip: React.FC<BatchFilmstripProps> = ({
  items,
  activeId,
  isBatchRunning,
  batchProgress,
  onSelect,
  onRemove,
  onAddFiles,
  onBatchRemoveAll,
  onApplyStyleToAll,
  onOpenBatchExport,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  if (items.length === 0) return null;

  const unprocessedCount = items.filter((i) => !i.hasRemovedBg).length;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-3.5 py-2.5 bg-[var(--bg-panel)] border-t border-[var(--border-main)] shrink-0 transition-colors">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp,image/avif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onAddFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <div className="flex items-center gap-2 overflow-x-auto studio-scroll py-0.5 min-w-0">
        <span className="hidden xl:inline-block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] px-1 shrink-0">
          Queue
        </span>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          title="Add more photos"
          className="flex flex-col items-center justify-center w-14 h-14 rounded-2xl border border-dashed border-[var(--border-accent-dashed)] hover:border-[#E06D3B] bg-[var(--bg-accent-tint)] hover:bg-[var(--bg-accent-soft)] text-[var(--text-accent-bright)] shrink-0 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span className="text-[10px] font-semibold mt-0.5">Add</span>
        </button>

        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <div
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`group relative flex items-center gap-2.5 pr-7 pl-1.5 py-1.5 rounded-2xl border transition-all shrink-0 cursor-pointer ${
                active
                  ? 'bg-[var(--bg-accent-soft)] border-[#E06D3B] text-[var(--text-primary)] shadow-[var(--shadow-accent)]'
                  : 'bg-[var(--bg-panel-alt)] border-[var(--border-card)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]'
              }`}
            >
              <div className="relative w-11 h-11 rounded-xl overflow-hidden checkerboard-sm shrink-0 border border-[var(--border-card)]">
                <img
                  src={item.thumbnailUrl}
                  alt={item.name}
                  className="w-full h-full object-contain"
                />
                {item.status === 'processing' && (
                  <div className="absolute inset-0 bg-[var(--bg-stage-overlay)] backdrop-blur-[1px] flex items-center justify-center">
                    <Loader2 className="w-4 h-4 animate-spin text-[#E06D3B]" />
                  </div>
                )}
              </div>

              <div className="flex flex-col min-w-[80px] max-w-[130px]">
                <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                  {item.name}
                </span>
                <div className="flex items-center gap-1 text-[10px] mt-0.5">
                  {item.status === 'processing' ? (
                    <span className="font-semibold text-[var(--text-accent-bright)]">
                      {item.progress?.percent !== null && item.progress?.percent !== undefined
                        ? `${item.progress.percent}% loading...`
                        : 'Working...'}
                    </span>
                  ) : item.status === 'error' ? (
                    <span className="inline-flex items-center gap-1 font-medium text-[var(--rose-text)]">
                      <AlertCircle className="w-3 h-3" />
                      Failed
                    </span>
                  ) : item.hasRemovedBg ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-[var(--emerald-text)]">
                      <CheckCircle2 className="w-3 h-3" />
                      Done
                    </span>
                  ) : (
                    <span className="text-[var(--text-muted)] font-mono tabular-nums">
                      {item.width}×{item.height}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item.id);
                }}
                className="absolute top-1.5 right-1.5 p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--rose-text)] hover:bg-[var(--rose-bg)] opacity-75 group-hover:opacity-100 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-[var(--border-divider)]">
        {items.length > 1 && (
          <>
            <button
              type="button"
              disabled={isBatchRunning || unprocessedCount === 0}
              onClick={onBatchRemoveAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-[var(--bg-accent-soft)] hover:bg-[var(--bg-accent-soft-hover)] text-[var(--text-accent)] border border-[var(--border-accent)] shadow-xs disabled:opacity-40 whitespace-nowrap transition-all cursor-pointer active:scale-95"
            >
              {isBatchRunning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className="font-mono tabular-nums">
                    {batchProgress ? `${batchProgress.current}/${batchProgress.total}` : 'Working...'}
                  </span>
                </>
              ) : (
                <>
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Clean All ({unprocessedCount})</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onApplyStyleToAll}
              title="Copy active image's backdrop, shadow, outline, and enhancement settings to all queued images"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[var(--bg-subtle)] hover:bg-[var(--bg-subtle-hover)] text-[var(--text-secondary)] border border-[var(--border-card)] shadow-xs whitespace-nowrap transition-all cursor-pointer active:scale-95"
            >
              <CopyCheck className="w-3.5 h-3.5 text-[var(--text-accent-bright)]" />
              <span className="hidden xl:inline">Apply to All</span>
              <span className="xl:hidden">Sync Style</span>
            </button>

            <button
              type="button"
              onClick={onOpenBatchExport}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-[var(--emerald-bg)] hover:bg-[var(--emerald-bg-hover)] text-[var(--emerald-text)] border border-[var(--emerald-border)] shadow-xs whitespace-nowrap transition-all cursor-pointer active:scale-95"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>ZIP ({items.length})</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
