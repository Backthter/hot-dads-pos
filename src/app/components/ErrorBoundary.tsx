import React from 'react';

/**
 * The last line of defence.
 *
 * A till that shows a white screen mid-service is worse than one that shows a
 * stack trace: the stack trace can be read out over the phone.
 */
export class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding: 40, background: '#09090b', color: '#F9624E', height: '100vh'}}>
          <h1 style={{fontSize: 24, marginBottom: 16}}>Error</h1>
          <pre style={{color: '#9f9fa9', whiteSpace: 'pre-wrap'}}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
