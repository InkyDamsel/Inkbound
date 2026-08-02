import React, { type CSSProperties, type HTMLAttributes, type PropsWithChildren, type ReactNode } from 'react';
import { useBreakpoint } from './BreakpointProvider';

interface ResponsiveDashboardLayoutProps
  extends PropsWithChildren,
    Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  sidebar: ReactNode;
  sidebarWidth?: number;
  gap?: number;
  contentClassName?: string;
  sidebarClassName?: string;
}

export function ResponsiveDashboardLayout({
  children,
  sidebar,
  sidebarWidth = 340,
  gap = 28,
  className,
  contentClassName,
  sidebarClassName,
  style,
  ...rest
}: ResponsiveDashboardLayoutProps) {
  const { isWide } = useBreakpoint();

  const classes = ['inkbound-responsive-dashboard', className].filter(Boolean).join(' ');
  const contentClasses = ['inkbound-responsive-dashboard__content', contentClassName]
    .filter(Boolean)
    .join(' ');
  const sidebarClasses = ['inkbound-responsive-dashboard__sidebar', sidebarClassName]
    .filter(Boolean)
    .join(' ');

  const layoutStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isWide ? `minmax(0, 1fr) ${sidebarWidth}px` : 'minmax(0, 1fr)',
    gap,
    alignItems: 'start',
    ...style,
  };

  return (
    <div
      {...rest}
      className={classes}
      data-dashboard-layout={isWide ? 'with-sidebar' : 'stacked'}
      style={layoutStyle}
    >
      <div className={contentClasses} style={{ minWidth: 0 }}>
        {children}
      </div>
      <aside className={sidebarClasses}>{sidebar}</aside>
    </div>
  );
}
