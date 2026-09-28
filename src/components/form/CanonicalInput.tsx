import React from 'react';

export interface CanonicalInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * Canonical editable input boundary for Inkbound.
 *
 * Keep the raw value as a string while the reader is editing. In particular,
 * an empty string is valid UI state: callers parse/validate only when they
 * actually need a domain value. This prevents controlled numeric fields from
 * snapping back to their previous value while Backspace/Delete is being used.
 */
export const CanonicalInput = React.forwardRef<HTMLInputElement, CanonicalInputProps>(
  ({ value, onValueChange, ...props }, ref) => (
    <input
      {...props}
      ref={ref}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    />
  ),
);

CanonicalInput.displayName = 'CanonicalInput';


export interface CanonicalNumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'onBlur'> {
  value?: number;
  onCommit: (value: number | undefined) => void;
  allowEmpty?: boolean;
  onDraftChange?: (rawValue: string) => void;
}

/**
 * Canonical numeric editor. Domain state is committed only after editing, so
 * Backspace/Delete can produce a real empty draft instead of immediately being
 * coerced to 0 and turning the next keystroke into values such as "030".
 */
export const CanonicalNumberInput = React.forwardRef<HTMLInputElement, CanonicalNumberInputProps>(
  ({ value, onCommit, allowEmpty = false, onDraftChange, min, max, onFocus, onKeyDown, ...props }, ref) => {
    const [draft, setDraft] = React.useState(value === undefined ? '' : String(value));
    const [focused, setFocused] = React.useState(false);

    React.useEffect(() => {
      if (!focused) setDraft(value === undefined ? '' : String(value));
    }, [focused, value]);

    const commit = () => {
      const trimmed = draft.trim();
      if (!trimmed) {
        if (allowEmpty) onCommit(undefined);
        else setDraft(value === undefined ? '' : String(value));
        return;
      }

      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        setDraft(value === undefined ? '' : String(value));
        return;
      }

      const minimum = typeof min === 'number' ? min : min !== undefined ? Number(min) : undefined;
      const maximum = typeof max === 'number' ? max : max !== undefined ? Number(max) : undefined;
      let next = parsed;
      if (Number.isFinite(minimum)) next = Math.max(minimum!, next);
      if (Number.isFinite(maximum)) next = Math.min(maximum!, next);
      setDraft(String(next));
      onCommit(next);
    };

    return (
      <input
        {...props}
        ref={ref}
        type="number"
        min={min}
        max={max}
        value={draft}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onChange={(event) => {
          const rawValue = event.currentTarget.value;
          setDraft(rawValue);
          onDraftChange?.(rawValue);
        }}
        onBlur={() => {
          commit();
          setFocused(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          onKeyDown?.(event);
        }}
      />
    );
  },
);

CanonicalNumberInput.displayName = 'CanonicalNumberInput';


export interface CanonicalTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * Canonical multiline text editor. It follows the same raw-editing contract as
 * CanonicalInput so Backspace/Delete and temporary empty state behave identically
 * across one-line and multiline reader-entered text.
 */
export const CanonicalTextarea = React.forwardRef<HTMLTextAreaElement, CanonicalTextareaProps>(
  ({ value, onValueChange, ...props }, ref) => (
    <textarea
      {...props}
      ref={ref}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    />
  ),
);

CanonicalTextarea.displayName = 'CanonicalTextarea';
