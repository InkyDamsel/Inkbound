import React, { type CSSProperties, type HTMLAttributes, type PropsWithChildren } from 'react';

interface ResponsiveGridProps
  extends PropsWithChildren,
    Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  minItemWidth?: number;
  maxColumns?: number;
  gap?: number | string;
  alignItems?: CSSProperties['alignItems'];
}

export function ResponsiveGrid({
  children,
  minItemWidth = 240,
  maxColumns,
  gap = 24,
  alignItems = 'stretch',
  className,
  style,
  ...rest
}: ResponsiveGridProps) {
  const classes = ['inkbound-responsive-grid', className].filter(Boolean).join(' ');
  const gapValue = typeof gap === 'number' ? `${gap}px` : gap;

  // maxColumns limits track count without constraining the grid container itself.
  // The old implementation converted maxColumns into maxWidth, which left wide
  // Library, Collections, and Import screens permanently capped near mobile widths.
  const minimumTrackWidth = maxColumns
    ? `min(100%, max(${minItemWidth}px, calc((100% - (${gapValue} * ${maxColumns - 1})) / ${maxColumns})))`
    : `min(100%, ${minItemWidth}px)`;

  return (
    <div
      {...rest}
      className={classes}
      style={{
        display: 'grid',
        width: '100%',
        maxWidth: 'none',
        gridTemplateColumns: `repeat(auto-fit, minmax(${minimumTrackWidth}, 1fr))`,
        gap,
        alignItems,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
