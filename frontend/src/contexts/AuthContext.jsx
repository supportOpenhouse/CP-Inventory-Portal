import { createContext, useContext, useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { clearSession, getToken, getUser, setToken, setUser } from '../auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Start with whatever's in sessionStorage (lets refresh preserve login)
  const [user, setUserState] = useState(() => getUser());
  const [loading, setLoading] = useState(false);

  // If we have a token but no validated user yet, verify it on mount.
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
   * Call /api/auth/phone-login.
   * Returns:
   *   { kind: 'authenticated', user }   — success, user is logged in
   *   { kind: 'not_registered', rmContacts } — phone not found
   *   { kind: 'error', message }        — validation or network error
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

  function logout() {
    clearSession();
    setUserState(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
