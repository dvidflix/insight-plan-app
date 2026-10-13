import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Without this, an error thrown while drawing any panel unmounts the whole app and leaves a blank window. Here it keeps the app's
    state and shows what failed, with a way back (Try again draws the app again; Reload starts it over). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; stack: string }> {
  state = { error: null as Error | null, stack: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The app stopped drawing:', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? '' });
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={{ padding: 24, font: '14px system-ui, sans-serif', color: '#222', background: '#efefef', minHeight: '100vh', boxSizing: 'border-box' }}>
        <h2 style={{ margin: '0 0 8px' }}>Something went wrong drawing this screen</h2>
        <p style={{ margin: '0 0 12px' }}>Your data is untouched. Try again, or reload the app; if it keeps happening, copy the details below.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={() => this.setState({ error: null, stack: '' })}>Try again</button>
          <button type="button" onClick={() => location.reload()}>Reload</button>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(`${error.stack ?? error.message}\n${stack}`)}>Copy details</button>
        </div>
        <pre style={{ whiteSpace: 'pre-wrap', margin: 0, padding: 12, background: '#fff', border: '1px solid #ccc', maxHeight: '60vh', overflow: 'auto', fontSize: 12 }}>
          {error.stack ?? error.message}
          {stack}
        </pre>
      </div>
    );
  }
}
