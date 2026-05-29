/**
 * Token and user persistence via localStorage.
 * Survives page refresh AND tab/browser close, so the user stays logged in
 * for the full life of the JWT (1 day for CPs, 7 days for other roles) without
 * being re-prompted for OTP. The backend `exp` still enforces auto-logout:
 * once the token expires, any request returns 401 and the session is cleared.
 */

const TOKEN_KEY = 'oh_token';
const USER_KEY = 'oh_user';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage unavailable (private mode, etc.) — silent fail
  }
}

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
  setToken(null);
  setUser(null);
}
