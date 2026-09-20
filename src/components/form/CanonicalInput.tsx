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
