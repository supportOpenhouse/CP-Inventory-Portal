import { createContext, useContext, useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { clearSession, getUser, isImpersonating, setUser } from '../auth';
import { logoutCometChat } from '../cometchat';
import { detailStore } from '../components/submissions/submissionDetailStore.js';

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

  // Welcome-curtain transition (Direct Inventory pattern): a full-screen orange
  // curtain that grows over the screen with a "Welcome back, {name}" / "Goodbye"
  // greeting on sign-in / sign-out, hiding the login↔dashboard swap behind it.
  const [transition, setTransition] = useState(null); // null | 'in' | 'out'
  const [tname, setTname] = useState('');

  // Kick off the curtain; auto-clear after it finishes (must outlast the ~1.7s
  // CSS animation in styles.css .welcome-curtain).
  function runCurtain(kind, name) {
    setTname(name || '');
    setTransition(kind);
    setTimeout(() => setTransition(null), 1900);
  }

  // Sign in: cache the user, start the curtain, then flip the visible state
  // ~once the curtain has covered the screen so the route swap stays hidden.
  function signIn(u) {
    api.resetCache();  // new identity — never serve the previous user's cached reads
    setUser(u);
    runCurtain('in', u?.name);
    setTimeout(() => setUserState(u), 650);
  }

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
        signIn(res.user);
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
   * Step 2 of OTP flow: verify OTP + log in (plays the sign-in curtain).
   */
  async function verifyOtp(phone, code) {
    setLoading(true);
    try {
      const res = await api.verifyOtp(phone, code);
      if (res.user) {
        signIn(res.user);
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
    // Play "Goodbye" over the dashboard first, then clear auth ~once the curtain
    // covers the screen (so the swap back to login stays hidden behind it). The
    // server-side cookie clear happens in the background (skipped in an
    // impersonation tab, where it would wipe the admin's shared cookie).
    runCurtain('out', user?.name);
    // Tear down the CometChat session + cached login promise BEFORE clearing
    // the portal session, so a logout→login in the same tab doesn't let the
    // next user inherit this user's CometChat identity.
    logoutCometChat().catch(() => {});
    setTimeout(() => {
      if (!isImpersonating()) api.logout().catch(() => {});
      api.resetCache();  // drop this user's cached reads on the way out
      detailStore.clear();  // + the persisted submission-detail store (soft logout keeps the JS context)
      clearSession();
      setUserState(null);
    }, 650);
  }

  return (
    <AuthContext.Provider value={{ user, loading, bootstrapping, login, sendOtp, verifyOtp, logout }}>
      {children}
      {transition && (
        <div className={`welcome-curtain ${transition}`} aria-hidden="true">
          <div className="wc-grad">
            <div className="wc-greeting">
              <span className="wc-hi">{transition === 'out' ? 'Goodbye :(' : 'Welcome back,'}</span>
              <span className="wc-name">{tname ? tname.split(' ')[0] : ''}</span>
            </div>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
