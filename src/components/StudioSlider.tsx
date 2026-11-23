import React from 'react';

interface StudioSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  defaultValue?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
}

export const StudioSlider: React.FC<StudioSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  defaultValue,
  disabled = false,
  onChange,
  onCommit,
}) => {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div className={`space-y-1.5 ${disabled ? 'opacity-45 pointer-events-none' : ''}`}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          className="text-[var(--text-secondary)] font-medium select-none cursor-default"
          title={defaultValue !== undefined ? 'Double-click to reset' : undefined}
          onDoubleClick={() => {
            if (defaultValue !== undefined) {
              onChange(defaultValue);
              onCommit?.(defaultValue);
            }
          }}
        >
          {label}
        </span>
        <span className="font-mono tabular-nums text-[11px] font-semibold text-[var(--text-primary)]">
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(1)}
          {unit}
        </span>
      </div>
      <div className="relative flex items-center h-4">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onPointerUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
          className="studio-slider"
          style={{
            background: `linear-gradient(to right, #E06D3B 0%, #F19868 ${pct}%, var(--slider-track) ${pct}%, var(--slider-track) 100%)`,
          }}
        />
      </div>
    </div>
  );
};
