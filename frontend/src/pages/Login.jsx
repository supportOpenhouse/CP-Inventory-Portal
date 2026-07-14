import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../contexts/AuthContext';
import { sanitizePhone } from '../format';
import OtpInput from '../components/OtpInput';
import LegalLinks from '../components/LegalLinks';

const RESEND_COOLDOWN_SEC = 30;

export default function Login() {
  const { sendOtp, verifyOtp, loading } = useAuth();
  const [step, setStep] = useState('phone'); // 'phone' | 'otp'
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [rmContacts, setRmContacts] = useState(null);
  const [devMode, setDevMode] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const intervalRef = useRef(null);

  const digits = phone.replace(/\D/g, '');
  // If they typed the 91 country code (12 digits), the national number is the last 10.
  const cleaned = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;

  const startResendTimer = () => {
    setResendIn(RESEND_COOLDOWN_SEC);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setResendIn((v) => {
        if (v <= 1) { clearInterval(intervalRef.current); return 0; }
        return v - 1;
      });
    }, 1000);
  };

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const handleSendOtp = async (e) => {
    e?.preventDefault();
    setError('');
    setRmContacts(null);
    if (cleaned.length < 10) { setError('Enter at least 10 digits'); return; }

    const res = await sendOtp(cleaned);
    if (res.kind === 'not_registered') { setRmContacts(res.rmContacts); return; }
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
    if (codeToUse.length !== 6) { setError('Enter the 6-digit OTP'); return; }
    const res = await verifyOtp(cleaned, codeToUse);
    if (res.kind === 'authenticated') return; // AuthProvider switches screens
    if (res.kind === 'invalid') { setError(res.message || 'Invalid OTP'); setCode(''); return; }
    if (res.kind === 'not_registered') { setRmContacts(res.rmContacts); setStep('phone'); return; }
    setError(res.message || 'Verification failed');
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    setError('');
    setCode('');
    const res = await sendOtp(cleaned);
    if (res.kind === 'otp_sent') { setDevMode(!!res.devMode); startResendTimer(); }
    else if (res.kind === 'rate_limited') setError(res.message || 'Too many attempts. Try again in a few minutes.');
    else setError(res.message || 'Could not resend OTP');
  };

  const handleChangePhone = () => {
    setStep('phone'); setCode(''); setError(''); setRmContacts(null);
  };

  return (
    <div className="login-wrap" data-theme="light">
      <div className="login-card card-block">
        <div className="login-brand">
          <img src="/oh_full_logo.png" alt="Openhouse" className="login-logo" />
          <div className="login-tag muted">Sourcing Portal</div>
        </div>

        {step === 'phone' && (
          <form onSubmit={handleSendOtp}>
            <label>Mobile number</label>
            <div className="phone-field">
              <span className="phone-cc">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                className="phone-input"
                placeholder="00000 00000"
                value={phone}
                onChange={(e) => { setPhone(sanitizePhone(e.target.value)); setError(''); setRmContacts(null); }}
                autoFocus
                maxLength={15}
              />
            </div>
            {error && <div className="modal-error" style={{ marginTop: 10 }}>{error}</div>}
            <button type="submit" className="btn-primary login-submit" disabled={loading}>
              {loading ? 'Sending OTP…' : 'Send OTP'}
            </button>
            <div className="login-hint muted">We'll text you a 6-digit code ;)</div>

            {rmContacts && (
              <div className="login-notreg">
                <div className="login-notreg-title">Phone not registered</div>
                <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: '4px 0 10px' }}>
                  We couldn't find this phone in our sourcing-partner list. Reach out to your
                  Openhouse Relationship Manager to get onboarded.
                </p>
                {Object.entries(rmContacts).map(([city, rm]) => (
                  <div key={city} className="login-rm">
                    <div className="login-rm-city">{city}</div>
                    <div className="login-rm-name">{rm.name}</div>
                    <a className="btn-link" href={`tel:${(rm.phone || '').replace(/\s/g, '')}`}>{rm.phone}</a>
                  </div>
                ))}
              </div>
            )}
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={(e) => { e.preventDefault(); handleVerifyOtp(); }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
              Code sent to <strong>+91 {cleaned}</strong>.{' '}
              <button type="button" className="btn-link" onClick={handleChangePhone} style={{ padding: 0 }}>Change</button>
            </div>

            <OtpInput value={code} onChange={setCode} onComplete={() => handleVerifyOtp(code)} disabled={loading} />

            {devMode && (
              <div className="login-hint muted">Dev mode — enter <code>000000</code></div>
            )}
            {error && <div className="modal-error" style={{ marginTop: 10 }}>{error}</div>}

            <button type="submit" className="btn-primary login-submit" disabled={loading || code.length !== 6}>
              {loading ? 'Verifying…' : 'Verify & sign in'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>
              {resendIn > 0
                ? <span className="muted">Resend available in {resendIn}s</span>
                : <button type="button" className="btn-link" onClick={handleResend} disabled={loading}>Resend OTP</button>}
            </div>
          </form>
        )}
      </div>

      <LegalLinks className="login-legal" />
    </div>
  );
}
