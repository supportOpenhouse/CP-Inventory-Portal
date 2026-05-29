import { createContext, useContext, useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { clearSession, getToken, getUser, setToken, setUser } from '../auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(() => getUser());
  const [loading, setLoading] = useState(false);


  useEffect(() => {
    const token = getToken();
    if (token && !user) {
      (async () => {
        try {
          const { user: me } = await api.me();
          setUserState(me);
          setUser(me);
        } catch {
          clearSession();
          setUserState(null);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Legacy phone-only login. Will return 410 Gone if backend has OTP_ENABLED=true.
   */
  async function login(phone) {
    setLoading(true);
    try {
      const res = await api.phoneLogin(phone);
      if (res.token && res.user) {
        setToken(res.token);
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
      if (res.token && res.user) {
        setToken(res.token);
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

  function logout() {
    clearSession();
    setUserState(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, sendOtp, verifyOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
