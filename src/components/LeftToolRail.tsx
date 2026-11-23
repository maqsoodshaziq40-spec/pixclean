import React from 'react';
import {
  Crop,
  Eraser,
  Hand,
  Keyboard,
  MousePointer2,
  Paintbrush,
  Scissors,
  ZoomIn,
} from 'lucide-react';
import type { ToolType } from '../types/studio';

interface LeftToolRailProps {
  activeTool: ToolType;
  hasImage: boolean;
  isProcessing: boolean;
  onSelectTool: (tool: ToolType) => void;
  onTriggerAiRemove: () => void;
  onOpenShortcuts: () => void;
}

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Pointer / Compare', shortcut: 'V', icon: MousePointer2 },
  { id: 'erase', label: 'Erase Brush', shortcut: 'E', icon: Eraser },
  { id: 'restore', label: 'Restore Brush', shortcut: 'R', icon: Paintbrush },
  { id: 'crop', label: 'Crop Canvas', shortcut: 'C', icon: Crop },
  { id: 'pan', label: 'Pan Canvas', shortcut: 'H', icon: Hand },
  { id: 'zoom', label: 'Zoom Tool', shortcut: 'Z', icon: ZoomIn },
];

export const LeftToolRail: React.FC<LeftToolRailProps> = ({
  activeTool,
  hasImage,
  isProcessing,
  onSelectTool,
  onTriggerAiRemove,
  onOpenShortcuts,
}) => {
  return (
    <aside
      aria-label="Editing Tools"
      className="flex md:flex-col items-center justify-between bg-[var(--bg-panel)] border-t md:border-t-0 md:border-r border-[var(--border-main)] px-2 py-1.5 md:py-3.5 md:w-[62px] shrink-0 z-20 transition-colors"
    >
      <div className="flex md:flex-col items-center gap-1.5 w-full md:w-auto justify-around md:justify-start">
        <button
          type="button"
          onClick={onTriggerAiRemove}
          disabled={!hasImage || isProcessing}
          title="Remove Background (B)"
          className="group relative flex items-center justify-center w-10 h-10 rounded-2xl studio-cta text-white disabled:opacity-35 disabled:pointer-events-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E06D3B] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-panel)]"
        >
          <Scissors className="w-[18px] h-[18px]" />
        </button>

        <div className="hidden md:block w-6 h-px bg-[var(--border-divider)] my-1.5" />

        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const active = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => onSelectTool(tool.id)}
              disabled={!hasImage}
              title={`${tool.label} (${tool.shortcut})`}
              aria-label={tool.label}
              aria-pressed={active}
              className={`group relative flex items-center justify-center w-10 h-10 rounded-2xl transition-all duration-150 cursor-pointer disabled:opacity-35 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E06D3B] ${
                active
                  ? 'bg-[var(--bg-accent-soft)] text-[var(--text-accent)] border border-[var(--border-accent)] shadow-[var(--shadow-accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] border border-transparent active:scale-95'
              }`}
            >
              <Icon className="w-[18px] h-[18px]" />
            </button>
          );
        })}
      </div>

      <div className="hidden md:flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenShortcuts}
          title="Keyboard Shortcuts (?)"
          aria-label="Keyboard Shortcuts"
          className="flex items-center justify-center w-10 h-10 rounded-2xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E06D3B]"
        >
          <Keyboard className="w-[18px] h-[18px]" />
        </button>
      </div>
    </aside>
  );
};
