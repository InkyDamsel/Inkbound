import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep diagnostic details available to developers without exposing
    // implementation jargon to readers in the Inkbound interface.
    console.error('Inkbound encountered an unrecoverable interface error.', error, info);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#0d0910] px-[max(1.25rem,env(safe-area-inset-left))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-[#f4efe6]">
        <section className="w-full max-w-xl rounded-3xl border border-[#c97b7b]/35 bg-[#17101b] p-7 text-center shadow-2xl sm:p-10">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#c97b7b]/12 text-[#e1a0a0]">
            <AlertTriangle className="h-7 w-7" />
          </span>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-[#b990a8]">Inkbound needs a moment</p>
          <h1 className="mt-3 font-serif text-3xl">This page could not be displayed.</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#ad9fac]">
            Your saved library has not been removed. Reload Inkbound to restore the reading sanctuary.
          </p>
          <button type="button" onClick={this.reload} className="quiet-shelf-primary-action mx-auto mt-6 min-h-11 justify-center px-6">
            <RefreshCw className="h-4 w-4" /> Reload Inkbound
          </button>
        </section>
      </main>
    );
  }
}
