import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
          <div className="text-center space-y-2">
            <h2 className="text-sm font-semibold text-slate-900">Something went wrong</h2>
            <p className="text-xs text-slate-500">An unexpected error occurred. Please try reloading the page.</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium rounded-md bg-orange-500 hover:bg-orange-600 text-white transition-colors"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
