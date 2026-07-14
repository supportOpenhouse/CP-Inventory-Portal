import { Component } from 'react';

// Catches any render/runtime error in the tree so a single crashing component
// shows a recoverable error instead of a blank white screen. "Reload app" also
// tears down the service worker + caches to escape a broken cached state.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.hardReload = this.hardReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('App crashed:', error, info);
  }

  async hardReload() {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // ignore — reload anyway
    }
    window.location.reload();
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
        }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong.</div>
          <div className="muted" style={{ maxWidth: 520, fontSize: 13 }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          <button type="button" className="btn-primary" onClick={this.hardReload}>Reload app</button>
        </div>
      );
    }
    return this.props.children;
  }
}
