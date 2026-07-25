import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import AutoUpdater from './components/AutoUpdater.jsx';
import { setUpdateReady } from './swUpdate.js';
import './styles.css';

if (import.meta.env.DEV) {
  // Dev has no service worker (devOptions disabled in vite.config). Proactively
  // evict any stale SW + caches left over from an earlier build — otherwise the
  // old worker keeps serving broken/cached bundles (blank screen on reload, or
  // the old pre-revamp pages that misalign on wide screens).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  }
  if (window.caches) {
    caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }
} else {
  // The browser only re-checks the SW script on a real document navigation (or
  // when its cached copy is >24h old). SPA route changes are NOT navigations,
  // so a tab left open all day would never notice a deploy and would keep
  // running stale code. Poll explicitly instead; when a new build is waiting,
  // it's applied silently on the next route navigation — see AutoUpdater.
  const UPDATE_CHECK_MS = 15 * 60 * 1000;

  const updateSW = registerSW({
    immediate: true,
    // Fires when a new build is installed and waiting to take over.
    onNeedRefresh() {
      setUpdateReady(() => updateSW());
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const check = () => {
        // Skip while hidden: a background tab's check can't be acted on anyway,
        // and waking every tab on a schedule is wasted requests.
        if (document.visibilityState !== 'visible') return;
        registration.update().catch(() => {}); // offline / transient — try later
      };
      setInterval(check, UPDATE_CHECK_MS);
      // Coming back to the tab is the moment a stale build is most likely, and
      // the moment the user is most able to act on the banner.
      document.addEventListener('visibilitychange', check);
    },
  });
}

// A deploy while the tab is open orphans the hashed route chunks it already
// knows about (Tickets-ChEkZUuC.js), so the next lazy navigation 404s and the
// error boundary shows a crash for an app that isn't actually broken. Vite
// fires this for exactly that failure; the page just needs a fresh index.html.
//
// The guard matters more than the reload: if the chunk is missing for a REAL
// reason, reloading would loop forever and the user could never see the error.
// A second failure within the window falls through to the boundary, whose
// "Reload app" button does the heavier service-worker + cache teardown.
window.addEventListener('vite:preloadError', (e) => {
  const KEY = 'oh:chunk-reload-at';
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) || 0) < 10_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return; // storage blocked (private mode) — can't guard, so don't reload
  }
  e.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AutoUpdater />
        <AuthProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
