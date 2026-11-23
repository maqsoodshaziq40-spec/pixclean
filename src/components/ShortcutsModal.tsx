import React from 'react';
import { Keyboard, X } from 'lucide-react';

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: 'Tools',
    items: [
      { keys: 'V', desc: 'Pointer / Split Compare' },
      { keys: 'B', desc: 'Run AI Background Removal' },
      { keys: 'E', desc: 'Erase Brush' },
      { keys: 'R', desc: 'Restore Brush' },
      { keys: 'C', desc: 'Crop Tool' },
      { keys: 'H', desc: 'Pan Tool' },
      { keys: 'Z', desc: 'Zoom Tool' },
    ],
  },
  {
    title: 'Brush & Canvas',
    items: [
      { keys: '[ / ]', desc: 'Decrease / Increase Brush Size' },
      { keys: 'Space + Drag', desc: 'Temporary Pan' },
      { keys: '+ / -', desc: 'Zoom In / Zoom Out' },
      { keys: '0', desc: 'Fit Image to Viewport' },
      { keys: '1', desc: 'Zoom to 100% (1:1)' },
      { keys: 'M', desc: 'Toggle Ruby Mask Overlay' },
      { keys: 'G', desc: 'Toggle Snap-to-Grid Overlay' },
    ],
  },
  {
    title: 'History & Workflow',
    items: [
      { keys: 'Ctrl / Cmd + Z', desc: 'Undo' },
      { keys: 'Ctrl / Cmd + Shift + Z', desc: 'Redo' },
      { keys: 'Ctrl / Cmd + E', desc: 'Open Export Dialog' },
      { keys: 'Alt + W', desc: 'Close Current Image Tab' },
      { keys: 'Ctrl / Cmd + V', desc: 'Paste Image from Clipboard' },
      { keys: 'T', desc: 'Toggle Light / Dark Mode' },
      { keys: '?', desc: 'Toggle Shortcuts Reference' },
    ],
  },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ open, onClose }) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-overlay)] backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] shadow-[var(--shadow-modal)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-divider)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[var(--bg-accent-soft)] text-[var(--text-accent-bright)] flex items-center justify-center">
              <Keyboard className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Keyboard Shortcuts</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto studio-scroll">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {group.title}
              </h3>
              <div className="divide-y divide-[var(--border-divider)] border border-[var(--border-card)] rounded-xl bg-[var(--bg-panel-alt)]">
                {group.items.map((item) => (
                  <div
                    key={item.desc}
                    className="flex items-center justify-between px-3.5 py-2.5 text-xs"
                  >
                    <span className="text-[var(--text-secondary)] font-medium">{item.desc}</span>
                    <kbd className="font-mono text-[11px] font-medium text-[var(--text-accent)] bg-[var(--bg-accent-soft)] border border-[var(--border-accent)] px-2 py-0.5 rounded-md">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
