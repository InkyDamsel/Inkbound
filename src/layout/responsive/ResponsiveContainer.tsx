import React, { type CSSProperties, type HTMLAttributes, type PropsWithChildren } from 'react';

type ContainerWidth = 'content' | 'wide' | 'full';

interface ResponsiveContainerProps
  extends PropsWithChildren,
    Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  width?: ContainerWidth;
  gutters?: boolean;
}

const maxWidths: Record<ContainerWidth, CSSProperties['maxWidth']> = {
  content: '1200px',
  wide: '1600px',
  full: 'none',
};

export function ResponsiveContainer({
  children,
  width = 'wide',
  gutters = true,
  className,
  style,
  ...rest
}: ResponsiveContainerProps) {
  const classes = ['inkbound-page-canvas', className].filter(Boolean).join(' ');

  return (
    <div
      {...rest}
      className={classes}
      data-container-width={width}
      style={{
        width: '100%',
        maxWidth: maxWidths[width],
        marginInline: 'auto',
        paddingInline: gutters ? undefined : 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
