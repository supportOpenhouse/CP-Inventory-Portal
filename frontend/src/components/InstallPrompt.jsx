import { useEffect, useState } from 'react';

/**
 * Dual-platform install prompt.
 *
 * Android (Chrome, Edge, Samsung Internet): captures the native
 * `beforeinstallprompt` event and renders a custom "Install app" banner.
 *
 * iOS (Safari): iOS does NOT expose any install API. We detect iOS + Safari +
 * not-already-installed and render an instruction banner telling the user
 * to tap Share → "Add to Home Screen".
 *
 * Both banners are dismissable; dismissal is remembered in localStorage for
 * 7 days so users aren't nagged.
 */

const DISMISS_KEY = 'oh_install_dismissed_at';
const DISMISS_DAYS = 7;

function isRecentlyDismissed() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (!ts) return false;
    const days = (Date.now() - ts) / 86400000;
    return days < DISMISS_DAYS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

function isStandalone() {
  // Already installed — don't nag
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  if (window.navigator.standalone === true) return true; // iOS-specific
  return false;
}

function isIosSafari() {
  const ua = window.navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  // Exclude Chrome on iOS (CriOS), Firefox on iOS (FxiOS), Edge on iOS (EdgiOS)
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  return isIos && isSafari;
}

function isIosNonSafari() {
  // iOS Chrome/Firefox/Edge — can't install anything, user must switch to Safari
  const ua = window.navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isNonSafariBrowser = /CriOS|FxiOS|EdgiOS/i.test(ua);
  return isIos && isNonSafariBrowser;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null); // Android
  const [showIosBanner, setShowIosBanner] = useState(false);
  const [showIosChromeBanner, setShowIosChromeBanner] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (isStandalone() || isRecentlyDismissed()) return;

    // ---- Android: capture beforeinstallprompt ----
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // ---- iOS: show custom instruction banner ----
    if (isIosSafari()) {
      setShowIosBanner(true);
    } else if (isIosNonSafari()) {
      // Chrome/Firefox/Edge on iOS — can't install, tell user to switch to Safari
      setShowIosChromeBanner(true);
    }

    // Also listen for successful install to auto-hide
    const onInstalled = () => {
      setDeferredPrompt(null);
      setShowIosBanner(false);
      setShowIosChromeBanner(false);
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch {
      // user dismissed — treat as dismiss
    }
    setDeferredPrompt(null);
    markDismissed();
  };

  const handleDismiss = () => {
    setHidden(true);
    setDeferredPrompt(null);
    setShowIosBanner(false);
    setShowIosChromeBanner(false);
    markDismissed();
  };

  if (hidden) return null;

  // ---- Android banner ----
  if (deferredPrompt) {
    return (
      <div className="install-banner">
        <div className="install-banner-text">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
            Install Openhouse
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Quick access from your home screen
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="install-banner-secondary" onClick={handleDismiss}>
            Not now
          </button>
          <button className="install-banner-primary" onClick={handleAndroidInstall}>
            Install
          </button>
        </div>
      </div>
    );
  }

  // ---- iOS Safari banner ----
  if (showIosBanner) {
    return (
      <div className="install-banner">
        <div className="install-banner-text">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
            Install Openhouse
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Tap{' '}
            <span
              style={{
                display: 'inline-block',
                border: '1px solid rgba(255,255,255,0.5)',
                borderRadius: 4,
                padding: '0 5px',
                margin: '0 2px',
              }}
            >
              &#x2191;
            </span>{' '}
            then <b>Add to Home Screen</b>
          </div>
        </div>
        <button className="install-banner-secondary" onClick={handleDismiss}>
          Got it
        </button>
      </div>
    );
  }

  // ---- iOS non-Safari banner (Chrome/Firefox/Edge on iOS) ----
  if (showIosChromeBanner) {
    return (
      <div className="install-banner">
        <div className="install-banner-text">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
            Open this site in Safari
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            iOS only lets Safari install apps. Copy the URL and open it in Safari.
          </div>
        </div>
        <button className="install-banner-secondary" onClick={handleDismiss}>
          Got it
        </button>
      </div>
    );
  }

  return null;
}