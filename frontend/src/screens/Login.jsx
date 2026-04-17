import { useState } from 'react';

import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login, loading } = useAuth();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [rmContacts, setRmContacts] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setRmContacts(null);

    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 10) {
      setError('Enter at least 10 digits');
      return;
    }

    const res = await login(cleaned);
    if (res.kind === 'authenticated') {
      // AuthProvider sets user; App.jsx will switch screens
      return;
    }
    if (res.kind === 'not_registered') {
      setRmContacts(res.rmContacts);
      return;
    }
    setError(res.message || 'Login failed');
  };

  return (
    <div className="app-shell">
      <div className="login-hero">
        <img src="/logo_long.png" alt="Openhouse" className="login-logo-img" />
        <div className="login-tagline">Channel Partner Portal</div>
      </div>

      <form onSubmit={handleSubmit} className="form-section">
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
            {loading ? <><span className="spinner" /> Logging in…</> : 'Continue'}
          </button>
        </div>

        {rmContacts && (
          <div className="form-card" style={{ borderColor: '#FFB27A' }}>
            <div className="form-card-title" style={{ color: '#D64045' }}>
              Phone not registered
            </div>
            <p style={{ fontSize: 13, color: 'var(--oh-gray)', lineHeight: 1.5 }}>
              We couldn't find this phone in our channel partner list. Please reach
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
    </div>
  );
}