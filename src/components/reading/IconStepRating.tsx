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

export const ChiliPepperIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.3 4.6c1.2-1.9 3.1-2.8 5.2-2.4-.1 2.1-1.2 3.8-3.2 4.8" />
    <path d="M15.8 6.4c2.1 1.8 2.4 5 .8 7.8-2.2 3.8-6.7 5.8-11.4 5.2 3.5-1.5 5.5-3.6 6.5-6.9.6-2.1 1.1-4.8 4.1-6.1Z" />
  </svg>
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
  const activeClass = kind === 'star' ? 'text-[#e5c158]' : 'text-orange-300';
  const emptyClass = 'text-[#6f6370]';
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
              <Icon className={`h-7 w-7 ${emptyClass}`} />
              {fill > 0 && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2"
                >
                  <span className="block h-7 overflow-hidden" style={{ width: `${fill}%` }}>
                    <Icon className={`h-7 w-7 max-w-none ${activeClass}`} />
                  </span>
                </span>
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
