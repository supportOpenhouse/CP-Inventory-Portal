/**
 * Token and user persistence.
 *
 * Normal sessions live in localStorage — survives refresh AND tab/browser
 * close, so the user stays logged in for the life of the JWT (1 day for CPs,
 * 7 days for staff). The backend `exp` still enforces auto-logout: once the
 * token expires, any request returns 401 and the session is cleared.
 *
 * IMPERSONATION ("admin view as CP"): a tab opened at `/?impersonate=1#it=<jwt>`
 * captures that short-lived CP token into sessionStorage (PER-TAB, not shared),
 * so the admin's own localStorage session in other tabs is never touched. In an
 * impersonation tab every accessor below reads/writes sessionStorage instead.
 */

const TOKEN_KEY = 'oh_token';
const USER_KEY = 'oh_user';
const IMP_TOKEN_KEY = 'oh_impersonation_token';
const IMP_FLAG_KEY = 'oh_impersonating';

// Impersonation bootstrap — runs ONCE at module load, before React mounts and
// before AuthContext's useState(getUser). It must run here (not in main.jsx):
// ES modules evaluate dependencies before dependents, so this beats any
// getUser() call. Captures the CP token handed off via the URL hash, then
// strips the hash so the JWT doesn't linger in the address bar / history.
(function bootstrapImpersonation() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('impersonate') !== '1') return;
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const token = new URLSearchParams(hash).get('it');
    if (token) {
      sessionStorage.setItem(IMP_TOKEN_KEY, token);
      sessionStorage.setItem(IMP_FLAG_KEY, '1');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch {
    // sessionStorage / URL APIs unavailable — ignore, fall back to normal auth.
  }
})();

function impersonating() {
  try {
    return sessionStorage.getItem(IMP_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function getToken() {
  try {
    if (impersonating()) return sessionStorage.getItem(IMP_TOKEN_KEY);
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (impersonating()) {
      if (token) sessionStorage.setItem(IMP_TOKEN_KEY, token);
      else sessionStorage.removeItem(IMP_TOKEN_KEY);
      return;
    }
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage unavailable (private mode, etc.) — silent fail
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
  if (impersonating()) {
    // End only this tab's impersonation; the admin's localStorage stays intact.
    // After this the tab falls back to the admin's localStorage session.
    try {
      sessionStorage.removeItem(IMP_TOKEN_KEY);
      sessionStorage.removeItem(IMP_FLAG_KEY);
    } catch {
      // noop
    }
    return;
  }
  setToken(null);
  setUser(null);
}
