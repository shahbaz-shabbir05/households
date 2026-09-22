import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../components/ui/index.js';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * The last line of defence.
 *
 * React unmounts the entire tree when a render throws, so without a boundary
 * one bad value — a malformed URL parameter, an unexpected API shape — gives
 * the user a blank white page with no way back. This turns that into a screen
 * they can act on.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept to the console rather than sent anywhere: this app ships no
    // third-party analytics (docs/13).
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
        <p className="max-w-sm text-sm text-slate-500">
          That screen could not be displayed. Your data is safe — nothing was changed.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button variant="secondary" onClick={() => { window.location.href = '/'; }}>
            Go to Today
          </Button>
        </div>
      </div>
    );
  }
}
