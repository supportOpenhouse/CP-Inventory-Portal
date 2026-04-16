/**
 * Token and user persistence via sessionStorage.
 * Survives page refresh, cleared on tab close.
 */

const TOKEN_KEY = 'oh_token';
const USER_KEY = 'oh_user';

export function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // sessionStorage unavailable (private mode, etc.) — silent fail
  }
}

export function getUser() {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setUser(user) {
  try {
    if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(USER_KEY);
  } catch {
    // noop
  }
}

export function clearSession() {
  setToken(null);
  setUser(null);
}
