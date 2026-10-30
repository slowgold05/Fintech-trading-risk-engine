import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-4 py-10">
          <section className="dashboard-card max-w-lg p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-300">
              Interface error
            </p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-50">
              The dashboard could not render.
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Refresh the page. If the issue continues, check the browser
              console and API status.
            </p>
            <button
              className="primary-action mt-5"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload page
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
