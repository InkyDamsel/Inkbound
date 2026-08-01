export const breakpoints = {
  mobile: 0,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
} as const;

export type BreakpointName = keyof typeof breakpoints;
export type ResponsiveViewport = 'mobile' | 'tablet' | 'desktop' | 'wide';

export function getViewportForWidth(width: number): ResponsiveViewport {
  if (width >= breakpoints.wide) return 'wide';
  if (width >= breakpoints.desktop) return 'desktop';
  if (width >= breakpoints.tablet) return 'tablet';
  return 'mobile';
}

export function mediaQueryAtLeast(breakpoint: Exclude<BreakpointName, 'mobile'>): string {
  return `(min-width: ${breakpoints[breakpoint]}px)`;
}
