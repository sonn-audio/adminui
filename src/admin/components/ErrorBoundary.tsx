import React from 'react';
import InlineState from './InlineState';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Keep the UX friendly, but preserve debugging info in the console.
    // eslint-disable-next-line no-console
    console.error('Admin UI crashed', error, info);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    const message = this.state.error?.message || 'Unexpected error';

    return (
      <div className="tab-shell">
        <div className="tab-shell__inner">
          <div className="card" style={{ maxWidth: 720, margin: '2rem auto' }}>
            <InlineState
              kind="error"
              title="Something went wrong"
              message={message}
              action={{ label: 'Reload page', onClick: () => window.location.reload(), variant: 'primary' }}
              secondaryAction={{
                label: 'Copy error',
                onClick: () => {
                  void navigator.clipboard?.writeText(message).catch(() => {});
                },
                variant: 'secondary',
              }}
            />
            <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)' }}>
              If this keeps happening, open the browser console and share the stack trace.
            </div>
          </div>
        </div>
      </div>
    );
  }
}

