/**
 * Session persistence.
 *
 * The JWT now lives in an HttpOnly cookie set by the backend — it is NOT
 * accessible to JavaScript (XSS-safe), so there is no token getter/setter here.
 * The cookie is sent automatically on every API request (credentials: 'include')
 * and the backend auto-logout window is enforced by the cookie/JWT expiry
 * (1 day for CPs, 7 days for other roles).
 *
 * We still cache the non-secret `user` object in localStorage so the UI can
 * render instantly on reload before /me resolves. clearSession() drops it; the
 * cookie itself is cleared server-side via POST /auth/logout.
 */

const USER_KEY = 'oh_user';

export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setUser(user) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // noop
  }
}

export function clearSession() {
  setUser(null);
}
