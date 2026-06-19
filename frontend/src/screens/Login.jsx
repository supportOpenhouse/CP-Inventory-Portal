import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../contexts/AuthContext';
import OtpInput from '../components/OtpInput';

const RESEND_COOLDOWN_SEC = 30;

// Optional LOCAL DEV bypass — see src/local_bypass.js (gitignored). import.meta.glob
// matches that file only when it's present (dev box); in production it's absent,
// the glob returns {}, LOCAL_OTP_BYPASS stays false, and the full OTP flow runs.
const _localBypassMods = import.meta.glob('../local_bypass.js', { eager: true });
const LOCAL_OTP_BYPASS = Object.values(_localBypassMods)[0]?.LOCAL_OTP_BYPASS === true;

export default function Login() {
  const { sendOtp, verifyOtp, login, loading } = useAuth();
  const [step, setStep] = useState('phone'); // 'phone' | 'otp'
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [rmContacts, setRmContacts] = useState(null);
  const [devMode, setDevMode] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const intervalRef = useRef(null);

  const cleaned = phone.replace(/\D/g, '');

  const startResendTimer = () => {
    setResendIn(RESEND_COOLDOWN_SEC);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setResendIn((v) => {
        if (v <= 1) {
          clearInterval(intervalRef.current);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
  };

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const handleSendOtp = async (e) => {
    e?.preventDefault();
    setError('');
    setRmContacts(null);

    if (cleaned.length < 10) {
      setError('Enter at least 10 digits');
      return;
    }

    // LOCAL DEV ONLY (gitignored bypass present): skip OTP, log in with phone.
    if (LOCAL_OTP_BYPASS) {
      const res = await login(cleaned);
      if (res.kind === 'authenticated') return; // AuthProvider switches screens
      if (res.kind === 'not_registered') {
        setRmContacts(res.rmContacts);
        return;
      }
      setError(res.message || 'Login failed');
      return;
    }

    const res = await sendOtp(cleaned);
    if (res.kind === 'not_registered') {
      setRmContacts(res.rmContacts);
      return;
    }
    if (res.kind === 'otp_sent') {
      setDevMode(!!res.devMode);
      setStep('otp');
      setCode('');
      startResendTimer();
      return;
    }
    if (res.kind === 'rate_limited') {
      setError(res.message || 'Too many attempts. Try again in a few minutes.');
      return;
    }
    setError(res.message || 'Could not send OTP');
  };

  const handleVerifyOtp = async (codeArg) => {
    const codeToUse = (codeArg ?? code).trim();
    setError('');
    if (codeToUse.length !== 6) {
      setError('Enter the 6-digit OTP');
      return;
    }
    const res = await verifyOtp(cleaned, codeToUse);
    if (res.kind === 'authenticated') {
      return; // AuthProvider switches screens
    }
    if (res.kind === 'invalid') {
      setError(res.message || 'Invalid OTP');
      setCode('');
      return;
    }
    if (res.kind === 'not_registered') {
      setRmContacts(res.rmContacts);
      setStep('phone');
      return;
    }
    setError(res.message || 'Verification failed');
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    setError('');
    setCode('');
    const res = await sendOtp(cleaned);
    if (res.kind === 'otp_sent') {
      setDevMode(!!res.devMode);
      startResendTimer();
    } else if (res.kind === 'rate_limited') {
      setError(res.message || 'Too many attempts. Try again in a few minutes.');
    } else {
      setError(res.message || 'Could not resend OTP');
    }
  };

  const handleChangePhone = () => {
    setStep('phone');
    setCode('');
    setError('');
    setRmContacts(null);
  };

  return (
    <div className="app-shell">
      <div className="login-hero">
        <img src="/logo_long.png" alt="Openhouse" className="login-logo-img" />
        <div className="login-tagline">Sourcing Portal</div>
      </div>

      {step === 'phone' && (
        <form onSubmit={handleSendOtp} className="form-section">
          <div className="form-card">
            <div className="form-card-title">Log in with your registered phone</div>

            <div className="input-label">Phone number</div>
            <input
              className={`input-field ${error ? 'input-error' : ''}`}
              type="tel"
              inputMode="numeric"
              placeholder="10-digit mobile number"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setError('');
                setRmContacts(null);
              }}
              autoFocus
              maxLength={15}
            />
            {error && <div className="error-text">{error}</div>}

            <button
              type="submit"
              className="primary-btn"
              disabled={loading}
              style={{ marginTop: 16 }}
            >
              {loading
                ? <><span className="spinner" /> {LOCAL_OTP_BYPASS ? 'Logging in…' : 'Sending OTP…'}</>
                : (LOCAL_OTP_BYPASS ? 'Log in' : 'Send OTP')}
            </button>
            <div style={{ fontSize: 12, color: 'var(--oh-gray)', marginTop: 10, textAlign: 'center' }}>
              {LOCAL_OTP_BYPASS ? 'Local mode — no OTP required' : "We'll text you a 6-digit code"}
            </div>
          </div>

          {rmContacts && (
            <div className="form-card" style={{ borderColor: '#FFB27A' }}>
              <div className="form-card-title" style={{ color: '#D64045' }}>
                Phone not registered
              </div>
              <p style={{ fontSize: 13, color: 'var(--oh-gray)', lineHeight: 1.5 }}>
                We couldn't find this phone in our sourcing partner list. Please reach
                out to your Openhouse Relationship Manager to get onboarded.
              </p>

              {Object.entries(rmContacts).map(([city, rm]) => (
                <div key={city} className="rm-card" style={{ marginTop: 12 }}>
                  <div className="rm-card-title">{city}</div>
                  <div className="rm-card-name">{rm.name}</div>
                  <a href={`tel:${rm.phone.replace(/\s/g, '')}`} className="rm-card-phone">
                    {rm.phone}
                  </a>
                </div>
              ))}
            </div>
          )}
        </form>
      )}

      {step === 'otp' && (
        <form
          className="form-section"
          onSubmit={(e) => { e.preventDefault(); handleVerifyOtp(); }}
        >
          <div className="form-card">
            <div className="form-card-title">Enter the OTP</div>
            <div style={{ fontSize: 13, color: 'var(--oh-gray)', marginBottom: 16, lineHeight: 1.5 }}>
              We sent a 6-digit code to <strong>+91 {cleaned}</strong>.{' '}
              <button
                type="button"
                onClick={handleChangePhone}
                className="link-btn"
                style={{ fontWeight: 600 }}
              >
                Change
              </button>
            </div>

            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={() => handleVerifyOtp(code)}
              disabled={loading}
            />

            {devMode && (
              <div style={{ fontSize: 12, color: '#888', marginTop: 10, textAlign: 'center' }}>
                Dev mode: any 6 digits work{' '}
                <span style={{ fontFamily: 'monospace' }}>(try 000000)</span>
              </div>
            )}
            {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}

            <button
              type="submit"
              className="primary-btn"
              disabled={loading || code.length !== 6}
              style={{ marginTop: 16 }}
            >
              {loading ? <><span className="spinner" /> Verifying…</> : 'Verify & sign in'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>
              {resendIn > 0 ? (
                <span style={{ color: 'var(--oh-gray)' }}>
                  Resend available in {resendIn}s
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  className="link-btn"
                  disabled={loading}
                >
                  Resend OTP
                </button>
              )}
            </div>
          </div>
        </form>
      )}
    </div>
  );
}