import React, { type CSSProperties, type HTMLAttributes, type PropsWithChildren } from 'react';
import { useBreakpoint } from './BreakpointProvider';

type StackDirection = 'row' | 'column';
type StackAlignment = CSSProperties['alignItems'];
type StackJustification = CSSProperties['justifyContent'];

interface ResponsiveStackProps
  extends PropsWithChildren,
    Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  mobileDirection?: StackDirection;
  tabletDirection?: StackDirection;
  desktopDirection?: StackDirection;
  gap?: number | string;
  mobileGap?: number | string;
  tabletGap?: number | string;
  desktopGap?: number | string;
  align?: StackAlignment;
  justify?: StackJustification;
  wrap?: boolean;
}

export function ResponsiveStack({
  children,
  mobileDirection = 'column',
  tabletDirection,
  desktopDirection = 'row',
  gap = 16,
  mobileGap,
  tabletGap,
  desktopGap,
  align,
  justify,
  wrap = false,
  className,
  style,
  ...rest
}: ResponsiveStackProps) {
  const { isMobile, isTablet } = useBreakpoint();

  const direction = isMobile
    ? mobileDirection
    : isTablet
      ? tabletDirection ?? mobileDirection
      : desktopDirection;

  const resolvedGap = isMobile
    ? mobileGap ?? gap
    : isTablet
      ? tabletGap ?? gap
      : desktopGap ?? gap;

  return (
    <div
      {...rest}
      className={className}
      data-responsive-stack={direction}
      style={{
        display: 'flex',
        flexDirection: direction,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        gap: resolvedGap,
        alignItems: align,
        justifyContent: justify,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
