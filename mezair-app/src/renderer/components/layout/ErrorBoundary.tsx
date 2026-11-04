import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useBrand } from '../../contexts/BrandContext';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-md text-center">
            <AlertTriangle size={48} className="mx-auto mb-4 text-error" />
            <h2 className="text-lg font-semibold text-text-primary">Something went wrong</h2>
            <p className="mt-2 text-sm text-text-secondary">
              {this.state.error?.message ?? 'An unexpected error occurred'}
            </p>
            <button
              onClick={this.handleReset}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
            >
              <RefreshCw size={14} />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/** A failed deferred chunk stays contained until an explicit app reload. */
export function DeferredLoadError({ label, onClose }: { label: string; onClose?: () => void }) {
  const brand = useBrand();
  return (
    <div role="alert" className="grid min-h-48 place-items-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <p className="text-sm text-text-secondary">
          {label} could not load. Reload {brand.appName} to try again.
        </p>
        <div className="flex justify-center gap-3">
          {onClose && (
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm"
              onClick={onClose}
            >
              Close
            </button>
          )}
          <button
            type="button"
            className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground"
            onClick={() => window.location.reload()}
          >
            Reload {brand.appName}
          </button>
        </div>
      </div>
    </div>
  );
}
