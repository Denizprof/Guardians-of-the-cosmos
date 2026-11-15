import { Component, Suspense, lazy, useState, type ComponentType, type ErrorInfo, type LazyExoticComponent, type ReactNode } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProps = any;
type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

/** One lazy component per loader, shared by every mount, so a chunk that has loaded never shows its fallback again. */
const cache = new WeakMap<Loader<AnyProps>, LazyExoticComponent<ComponentType<AnyProps>>>();
/** Errors that came from the import itself. Anything else (a bug inside the loaded component) is not ours to hide. */
const loadErrors = new WeakSet<object>();

function lazyFor<P>(load: Loader<P>): LazyExoticComponent<ComponentType<P>> {
  let c = cache.get(load);
  if (!c) {
    c = lazy(() =>
      load().catch((e: unknown) => {
        if (typeof e === 'object' && e !== null) loadErrors.add(e);
        throw e;
      }),
    );
    cache.set(load, c);
  }
  return c;
}

interface BoundaryProps {
  onRetry: () => void;
  children: ReactNode;
}

class LoadBoundary extends Component<BoundaryProps, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[Global SAR] a section failed to load:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // Not a failed import: let the app-level boundary handle it, as before.
    if (typeof error !== 'object' || !loadErrors.has(error)) throw error;
    return (
      <div className="callout warn" role="alert">
        <p>This section could not be loaded. Check your connection and try again.</p>
        <button type="button" className="btn" onClick={this.props.onRetry}>
          Retry
        </button>
      </div>
    );
  }
}

interface Props<P> {
  /** The dynamic import. Pass a module-level function: its identity is the cache key. */
  load: Loader<P>;
  /** Shown while the chunk is downloading. */
  fallback: ReactNode;
  /** Renders the loaded component with its props. */
  children: (C: LazyExoticComponent<ComponentType<P>>) => ReactNode;
}

/**
 * Mounts a code-split component. If its chunk cannot be fetched (offline, or a new deploy replaced the hashed file),
 * only this section shows a message with Retry; the rest of the app stays as it was.
 * React.lazy remembers a rejected import, so Retry discards that lazy component and builds a new one.
 */
export default function LazySection<P>({ load, fallback, children }: Props<P>) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    cache.delete(load);
    setAttempt((n) => n + 1);
  };
  return (
    <LoadBoundary key={attempt} onRetry={retry}>
      <Suspense fallback={fallback}>{children(lazyFor(load))}</Suspense>
    </LoadBoundary>
  );
}
