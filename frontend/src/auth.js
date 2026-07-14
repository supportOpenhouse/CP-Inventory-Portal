/**
 * User cache + impersonation token persistence.
 *
 * The normal session JWT now lives in an HttpOnly cookie set by the backend —
 * it is NOT readable or writable from JS (that's the whole point: XSS can't
 * steal it). This module only caches the user OBJECT in localStorage (for a
 * no-flash boot) and manages the per-tab impersonation token.
 *
 * IMPERSONATION ("admin view as CP"): a tab opened at `/?impersonate=1#it=<jwt>`
 * captures that short-lived CP token into sessionStorage (PER-TAB, not shared)
 * and sends it as an `Authorization: Bearer` header. The backend reads the
 * header BEFORE the cookie, so the impersonation token overrides the admin's
 * cookie (which the browser still sends) — preserving the per-tab isolation a
 * shared cookie alone can't give.
 */

const TOKEN_KEY = 'oh_token';   // legacy localStorage key — only purged now
const USER_KEY = 'oh_user';
const IMP_TOKEN_KEY = 'oh_impersonation_token';
const IMP_FLAG_KEY = 'oh_impersonating';

// FRAME-LOCAL impersonation (used when the CP view is EMBEDDED in an <iframe>
// inside the staff app — see the Impersonator page). A same-origin iframe SHARES
// sessionStorage with the parent tab, so writing the token there would flip the
// staff session too. An embedded frame therefore keeps its token in memory only
// (these module vars are per-frame); the parent frame never sees it. Standalone
// impersonation TABS still use sessionStorage (isolated per tab).
let _frameToken = null;
let _frameImp = false;

// Impersonation bootstrap — runs ONCE at module load, before React mounts and
// before AuthContext's useState(getUser). It must run here (not in main.jsx):
// ES modules evaluate dependencies before dependents, so this beats any
// getUser() call. Captures the CP token handed off via the URL hash.
(function bootstrapImpersonation() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('impersonate') !== '1') return;
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const token = new URLSearchParams(hash).get('it');
    if (!token) return;
    if (window.self !== window.top) {
      // Embedded iframe: memory-only, and KEEP the hash so an iframe reload can
      // re-bootstrap (its URL isn't user-visible — the address bar is the
      // parent's). Never touch sessionStorage → the parent stays the admin.
      _frameToken = token;
      _frameImp = true;
    } else {
      // Standalone impersonation tab: persist to THIS tab's own sessionStorage,
      // then strip the JWT from the address bar / history.
      sessionStorage.setItem(IMP_TOKEN_KEY, token);
      sessionStorage.setItem(IMP_FLAG_KEY, '1');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch {
    // sessionStorage / URL APIs unavailable — ignore, fall back to normal auth.
  }
})();

function impersonating() {
  if (_frameImp) return true;
  try {
    return sessionStorage.getItem(IMP_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

// Whether this tab is an impersonation tab. Callers use it to avoid hitting the
// server logout (which would clear the admin's shared cookie) from such a tab.
export function isImpersonating() {
  return impersonating();
}

/**
 * Returns the impersonation Bearer token when in an impersonation tab, else
 * null. Normal sessions authenticate via the HttpOnly cookie, which JS cannot
 * read — so there is no token to return (the request layer just relies on the
 * cookie being sent automatically).
 */
export function getToken() {
  if (_frameImp) return _frameToken;
  try {
    return impersonating() ? sessionStorage.getItem(IMP_TOKEN_KEY) : null;
  } catch {
    return null;
  }
}

export function getUser() {
  // In an impersonation tab never return the cached (admin) user — return null
  // so AuthContext hydrates the CP user fresh via /me using the CP token.
  if (impersonating()) return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setUser(user) {
  // Don't persist the impersonated CP user into localStorage (that's the
  // admin's shared store). The tab re-hydrates via /me on reload.
  if (impersonating()) return;
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // noop
  }
}

export function clearSession() {
  if (_frameImp) {
    // Embedded iframe: just drop the in-memory token; nothing was persisted.
    _frameImp = false;
    _frameToken = null;
    return;
  }
  if (impersonating()) {
    // End only this tab's impersonation; the admin's session stays intact.
    // After this the tab falls back to the admin's cookie session.
    try {
      sessionStorage.removeItem(IMP_TOKEN_KEY);
      sessionStorage.removeItem(IMP_FLAG_KEY);
    } catch {
      // noop
    }
    return;
  }
  // Normal session: the HttpOnly cookie is cleared server-side via
  // POST /auth/logout (or already invalid on a 401). Here we only drop the
  // cached user object and purge any pre-migration token left in localStorage.
  setUser(null);
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // noop
  }
}
