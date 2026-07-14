import { Component } from 'react';

/**
 * Catches render-time crashes inside the CometChat UI Kit so a failure shows a
 * readable message (and logs the real error to the console) instead of
 * white-screening the whole app. Wrap the message pane in this.
 */
export default class ChatErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[chat] render error:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-state">
          <p>Chat failed to load.</p>
          <p style={{ fontSize: 12, color: 'var(--red-fg)', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            {String(this.state.error?.message || this.state.error)}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
