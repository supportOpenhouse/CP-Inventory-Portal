import { useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { useAuth } from '../contexts/AuthContext';
import Chatbot from './Chatbot';

function formatPrice(val) {
  const n = parseInt(val);
  if (!n || isNaN(n)) return '—';
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + ' Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + ' L';
  return '₹' + n.toLocaleString('en-IN');
}

function badgeClass(status) {
  if (status === 'Offer Given' || status === 'Accepted') return 'badge badge-offer';
  if (status === 'Closed') return 'badge badge-closed';
  return 'badge badge-submitted';
}

export default function Dashboard({ onAdd }) {
  const { user, logout } = useAuth();
  const [state, setState] = useState({
    loading: true,
    submissions: [],
    stats: { submitted: 0, offers: 0, closures: 0 },
    error: null,
  });
  const [rmPhone, setRmPhone] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .listSubmissions()
      .then((data) => {
        if (!alive) return;
        setState({
          loading: false,
          submissions: data.submissions || [],
          stats: data.stats || { submitted: 0, offers: 0, closures: 0 },
          error: null,
        });
      })
      .catch((err) => {
        if (!alive) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof ApiError ? err.message : 'Failed to load',
        }));
      });

    // Resolve the CP's RM WhatsApp number for the chatbot fallback
    api
      .getRmContacts()
      .then((data) => {
        if (!alive) return;
        const contacts = data?.contacts || {};
        const myRm = user.city && contacts[user.city];
        setRmPhone(myRm?.phone || '+919555666059');
      })
      .catch(() => {
        if (alive) setRmPhone('+919555666059');
      });

    return () => {
      alive = false;
    };
  }, [user.city]);

  return (
    <div className="app-shell">
      <div className="header">
        <div>
          <div className="header-brand">
            open<span className="header-brand-accent">house</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
            Channel Partner Portal
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="header-user">
            <div className="header-avatar">{user.name?.[0] || '?'}</div>
            <span>{user.name?.split(' ')[0] || 'CP'}</span>
          </div>
          <button className="logout-btn" onClick={logout} title="Log out">⏻</button>
        </div>
      </div>

      <div style={{ padding: '14px 20px 6px', fontSize: 13, color: 'var(--oh-gray)', fontWeight: 500 }}>
        {user.cp_code} · {user.company || '—'} · {user.city || 'All cities'}
      </div>

      <div className="dash-stats">
        <div className="dash-stat">
          <div className="dash-stat-num">{state.stats.submitted}</div>
          <div className="dash-stat-label">Submitted</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-num" style={{ color: 'var(--oh-yellow)' }}>{state.stats.offers}</div>
          <div className="dash-stat-label">Offers</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-num" style={{ color: 'var(--oh-green)' }}>{state.stats.closures}</div>
          <div className="dash-stat-label">Closures</div>
        </div>
      </div>

      <div className="section-title">Your Inventory</div>

      {state.loading ? (
        <div className="loading-block">Loading submissions…</div>
      ) : state.error ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <p>{state.error}</p>
        </div>
      ) : state.submissions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏠</div>
          <p>No units submitted yet.<br />Tap + to add your first unit.</p>
        </div>
      ) : (
        state.submissions.map((s) => (
          <div className="unit-card" key={s.id}>
            <div className="unit-card-body">
              <div className="unit-card-header">
                <div>
                  <div className="unit-card-society">{s.society_name}</div>
                  <div className="unit-card-config">
                    {[s.tower && `${s.tower}${s.unit_no ? '-' + s.unit_no : ''}`, s.bhk, s.sqft && `${s.sqft} sqft`, s.floor && `Floor ${s.floor}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className={badgeClass(s.status)}>{s.status}</div>
              </div>
              <div className="unit-card-price">
                {formatPrice(s.asking_price)}
                {s.sqft && s.asking_price ? (
                  <span>₹{Math.round(s.asking_price / s.sqft).toLocaleString('en-IN')}/sqft</span>
                ) : null}
              </div>
            </div>
          </div>
        ))
      )}

      <button className="fab" onClick={onAdd} title="Add unit">+</button>
      <Chatbot rmPhone={rmPhone} />
    </div>
  );
}