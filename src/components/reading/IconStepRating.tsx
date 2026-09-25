import React from 'react';
import { Star } from 'lucide-react';

type RatingKind = 'star' | 'spice';

interface IconStepRatingProps {
  value?: number;
  onChange: (value?: number) => void;
  kind: RatingKind;
  ariaLabel: string;
  allowZero?: boolean;
}

export const ChiliPepperIcon = ({ className = '', style }: { className?: string; style?: React.CSSProperties }) => (
  <span aria-hidden="true" className={`inline-flex items-center justify-center leading-none ${className}`} style={style}>🌶️</span>
);

function fillForStep(value: number | undefined, step: number): 0 | 50 | 100 {
  if (value === undefined) return 0;
  if (value >= step) return 100;
  if (value === step - 0.5) return 50;
  return 0;
}

export const IconStepRating: React.FC<IconStepRatingProps> = ({
  value,
  onChange,
  kind,
  ariaLabel,
  allowZero = false,
}) => {
  const Icon = kind === 'star' ? Star : ChiliPepperIcon;
  const activeClass = kind === 'star' ? 'text-[#e5c158]' : '';
  const emptyClass = kind === 'star' ? 'text-[#6f6370]' : 'grayscale opacity-35';
  const iconSizeClass = kind === 'spice' ? 'h-9 w-9 text-[30px]' : 'h-7 w-7';
  const setValue = (next: number) => onChange(value === next ? undefined : next);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1" role="group" aria-label={ariaLabel}>
        {[1, 2, 3, 4, 5].map((step) => {
          const fill = fillForStep(value, step);
          return (
            <button
              key={step}
              type="button"
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c29bb2]"
              aria-label={`${ariaLabel}: ${step} of 5`}
              aria-pressed={value === step || value === step - 0.5}
              title="Click for whole. Double-click for half. On touch, tap left half for .5 or right half for whole."
              onClick={(event) => {
                if ((event.nativeEvent as PointerEvent).pointerType === 'touch') return;
                setValue(step);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                setValue(step - 0.5);
              }}
              onPointerUp={(event) => {
                if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const half = event.clientX - bounds.left < bounds.width / 2;
                setValue(half ? step - 0.5 : step);
              }}
            >
              {kind === 'spice' ? (
                fill === 50 ? (
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${iconSizeClass}`}
                  >
                    <ChiliPepperIcon
                      className={`absolute inset-0 ${iconSizeClass}`}
                      style={{ clipPath: 'inset(0 50% 0 0)' }}
                    />
                    <ChiliPepperIcon
                      className={`absolute inset-0 ${iconSizeClass} grayscale opacity-35`}
                      style={{ clipPath: 'inset(0 0 0 50%)' }}
                    />
                  </span>
                ) : (
                  <ChiliPepperIcon className={`${iconSizeClass} ${fill === 100 ? '' : emptyClass}`} />
                )
              ) : (
                <>
                  <Icon className={`${iconSizeClass} ${emptyClass}`} />
                  {fill > 0 && (
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${iconSizeClass}`}
                    >
                      <span className="block h-full overflow-hidden" style={{ width: `${fill}%` }}>
                        <Icon className={`${iconSizeClass} max-w-none ${activeClass}`} fill="currentColor" />
                      </span>
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
      {allowZero && (
        <button
          type="button"
          onClick={() => setValue(0)}
          className={`min-h-11 rounded-lg border px-3 text-xs font-bold ${value === 0 ? 'border-orange-300/60 bg-orange-300/10 text-orange-200' : 'border-[#3d2448] text-stone-400'}`}
        >
          No spice
        </button>
      )}
      <button
        type="button"
        onClick={() => onChange(undefined)}
        className="min-h-11 rounded-lg px-3 text-xs font-bold text-stone-400 hover:text-[#f4efe6]"
      >
        Clear
      </button>
    </div>
  );
};
