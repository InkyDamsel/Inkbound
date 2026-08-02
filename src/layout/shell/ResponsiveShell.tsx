import type { ReactNode } from 'react';
import { useBreakpoint } from '../responsive/BreakpointProvider';

interface ResponsiveShellProps {
  navigation: ReactNode;
  children?: ReactNode;
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
