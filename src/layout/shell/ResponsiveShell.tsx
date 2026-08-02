import type { PropsWithChildren, ReactNode } from 'react';
import { useBreakpoint } from '../responsive/BreakpointProvider';

interface ResponsiveShellProps extends PropsWithChildren {
  navigation: ReactNode;
}

export function ResponsiveShell({ navigation, children }: ResponsiveShellProps) {
  const { viewport } = useBreakpoint();

  return (
    <div className="inkbound-app-shell" data-viewport={viewport}>
      {navigation}
      {children}
    </div>
  );
}
