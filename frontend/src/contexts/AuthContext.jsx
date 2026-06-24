import { createContext, useContext, useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { clearSession, getUser, isImpersonating, setUser } from '../auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(() => getUser());
  const [loading, setLoading] = useState(false);
  // Probe the session on mount: the HttpOnly cookie (or the impersonation
  // Bearer token) authenticates /me. We can't see the cookie from JS, so unless
  // we have a cached user we always probe — showing a spinner instead of a
  // one-frame Login flash. Impersonation tabs always take this path (getUser()
  // returns null there; /me hydrates the CP user from the CP token).
  const [bootstrapping, setBootstrapping] = useState(() => !getUser());

  useEffect(() => {
    if (user) {
      setBootstrapping(false);
      return;
    }
    (async () => {
      try {
        // meBootstrap() never force-logs-out/reloads, so a logged-out visitor
        // just lands on Login instead of looping.
        const { user: me } = await api.meBootstrap();
        setUserState(me);
        setUser(me);
      } catch {
        clearSession();
        setUserState(null);
      } finally {
        setBootstrapping(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Legacy phone-only login. Will return 410 Gone if backend has OTP_ENABLED=true.
   */
  async function login(phone) {
    setLoading(true);
    try {
      const res = await api.phoneLogin(phone);
      if (res.user) {
        // Session JWT is set as an HttpOnly cookie by the server; we only
        // cache the user object locally.
        setUser(res.user);
        setUserState(res.user);
        return { kind: 'authenticated', user: res.user };
      }
      return { kind: 'not_registered', rmContacts: res.rm_contacts || {} };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Login failed';
      return { kind: 'error', message };
    } finally {
      setLoading(false);
    }
  }

  /**
   * Step 1 of OTP flow: request an OTP.
   * Returns:
   *   { kind: 'otp_sent', devMode: boolean } — OTP sent (or dev bypass active)
   *   { kind: 'not_registered', rmContacts }  — phone not a CP
   *   { kind: 'rate_limited', message }
   *   { kind: 'error', message }
   */
  async function sendOtp(phone) {
    setLoading(true);
    try {
      const res = await api.sendOtp(phone);
      if (res.user === null && res.token === null) {
        return { kind: 'not_registered', rmContacts: res.rm_contacts || {} };
      }
      if (res.success) {
        return { kind: 'otp_sent', devMode: res.status === 'dev_bypass' };
      }
      return { kind: 'error', message: res.error || 'Could not send OTP' };
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        return { kind: 'rate_limited', message: err.message };
      }
      const message = err instanceof ApiError ? err.message : 'Could not send OTP';
      return { kind: 'error', message };
    } finally {
      setLoading(false);
    }
  }

  /**
   * Step 2 of OTP flow: verify OTP + log in.
   * Returns:
   *   { kind: 'authenticated', user }
   *   { kind: 'not_registered', rmContacts }
   *   { kind: 'invalid', message }
   *   { kind: 'error', message }
   */
  async function verifyOtp(phone, code) {
    setLoading(true);
    try {
      const res = await api.verifyOtp(phone, code);
      if (res.user) {
        // Session JWT is set as an HttpOnly cookie by the server; we only
        // cache the user object locally.
        setUser(res.user);
        setUserState(res.user);
        return { kind: 'authenticated', user: res.user };
      }
      if (res.user === null) {
        return { kind: 'not_registered', rmContacts: res.rm_contacts || {} };
      }
      return { kind: 'error', message: 'Unexpected response' };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return { kind: 'invalid', message: err.message || 'Invalid OTP' };
      }
      const message = err instanceof ApiError ? err.message : 'Verification failed';
      return { kind: 'error', message };
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    // Clear the HttpOnly cookie server-side — but NOT from an impersonation tab,
    // where that would wipe the admin's shared session cookie. There, clearing
    // the per-tab impersonation token (clearSession) is the whole job.
    if (!isImpersonating()) {
      try {
        await api.logout();
      } catch {
        // Clear local state regardless of a network/server hiccup.
      }
    }
    clearSession();
    setUserState(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, bootstrapping, login, sendOtp, verifyOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
