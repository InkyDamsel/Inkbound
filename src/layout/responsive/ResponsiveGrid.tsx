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
  const maximumWidth = maxColumns
    ? `min(100%, calc(${minItemWidth}px * ${maxColumns} + ${gapValue} * ${maxColumns - 1}))`
    : undefined;

  return (
    <div
      {...rest}
      className={classes}
      style={{
        display: 'grid',
        width: '100%',
        maxWidth: maximumWidth,
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minItemWidth}px), 1fr))`,
        gap,
        alignItems,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
