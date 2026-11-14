import { Component, type ErrorInfo, type ReactNode } from 'react';

/** True when the browser cannot create a WebGL2 context (the 3D globe needs one). */
export function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence: any render / effect error (including MapLibre failing to create its WebGL context)
 * shows a message with a reload button instead of a blank page. The error is logged, never swallowed.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Global SAR] unrecoverable UI error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const noWebgl = !webgl2Available() || /webgl/i.test(error.message);
    return (
      <div className="fatal" role="alert">
        <h1>Global SAR</h1>
        {noWebgl ? (
          <>
            <p>The 3D globe could not start: this browser or device does not provide WebGL2.</p>
            <p className="muted">
              Try an up-to-date Chrome, Edge, Firefox or Safari, and check that hardware acceleration is turned on in the browser settings.
            </p>
          </>
        ) : (
          <>
            <p>Something went wrong and the app stopped.</p>
            <p className="muted mono">{error.message}</p>
          </>
        )}
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
