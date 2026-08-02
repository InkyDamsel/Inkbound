import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { getViewportForWidth, type ResponsiveViewport } from '../breakpoints';

interface BreakpointContextValue {
  width: number;
  viewport: ResponsiveViewport;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isWide: boolean;
}

const BreakpointContext = createContext<BreakpointContextValue | null>(null);

function getWindowWidth(): number {
  return typeof window === 'undefined' ? 1024 : window.innerWidth;
}

export function BreakpointProvider({ children }: PropsWithChildren) {
  const [width, setWidth] = useState(getWindowWidth);

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const value = useMemo<BreakpointContextValue>(() => {
    const viewport = getViewportForWidth(width);

    return {
      width,
      viewport,
      isMobile: viewport === 'mobile',
      isTablet: viewport === 'tablet',
      isDesktop: viewport === 'desktop' || viewport === 'wide',
      isWide: viewport === 'wide',
    };
  }, [width]);

  return <BreakpointContext.Provider value={value}>{children}</BreakpointContext.Provider>;
}

export function useBreakpoint(): BreakpointContextValue {
  const context = useContext(BreakpointContext);

  if (!context) {
    throw new Error('useBreakpoint must be used within a BreakpointProvider.');
  }

  return context;
}
