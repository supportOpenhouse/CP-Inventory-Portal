import { useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../api';
import { thumbnailUrl } from '../cloudinary';
import { useAuth } from '../contexts/AuthContext';
import { formatPrice } from '../format';
import { UnitCardSkeleton } from '../components/Skeleton';
import Chatbot from './Chatbot';

// Stages shown as filter pills. "All" is a special pseudo-filter.
const FILTER_OPTIONS = [
  'All',
  'Submitted',
  'Evaluation',
  'Offer Given',
  'Visit Scheduled',
  'Unapproved',
  'Rejected',
];

function badgeClass(status) {
  if (status === 'Unapproved') return 'badge';
  if (status === 'Offer Given' || status === 'Accepted') return 'badge badge-offer';
  if (status === 'Closed' || status === 'Visit Scheduled') return 'badge badge-closed';
  if (status === 'Rejected') return 'badge badge-rejected';
  return 'badge badge-submitted';
}

function badgeStyle(status) {
  if (status === 'Unapproved') {
    return { background: '#FFF8E1', color: '#B8860B', border: '1px solid #E8C86A' };
  }
  return undefined;
}

function badgeLabel(status) {
  if (status === 'Unapproved') return 'Pending Review';
  return status;
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
  const [filter, setFilter] = useState('All');
  const [counterBusy, setCounterBusy] = useState({});  // { [submissionId]: 'accepting' | 'rejecting' }

  const loadSubmissions = () => {
    setState((st) => ({ ...st, loading: true }));
    return api.listSubmissions().then((data) => {
      setState({
        loading: false,
        submissions: data.submissions || [],
        stats: data.stats || { submitted: 0, offers: 0, closures: 0 },
        error: null,
      });
    }).catch((err) => {
      setState({
        loading: false,
        submissions: [],
        stats: { submitted: 0, offers: 0, closures: 0 },
        error: err instanceof ApiError ? err.message : 'Failed to load your listings',
      });
    });
  };

  useEffect(() => {
    let alive = true;
    loadSubmissions();
    if (user?.city) {
      // RM phone lookup logic retained from previous code
      api.getFaqs?.();
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.city]);

  // Filter submissions by chosen stage
  const visibleSubmissions = useMemo(() => {
    if (filter === 'All') return state.submissions;
    return state.submissions.filter((s) => s.status === filter);
  }, [state.submissions, filter]);

  const handleCounterResponse = async (submissionId, action) => {
    setCounterBusy((b) => ({ ...b, [submissionId]: action }));
    try {
      await api.counterOfferResponse(submissionId, action);
      await loadSubmissions();
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : 'Could not record your response. Please try again.'
      );
    } finally {
      setCounterBusy((b) => {
        const next = { ...b };
        delete next[submissionId];
        return next;
      });
    }
  };

  return (
    <div className="app-shell">
      <div className="header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Hi, {user.name || 'there'}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
            {user.cp_code} · {user.company || '—'} · {user.city || 'All cities'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="add-btn" onClick={onAdd}>+</button>
          <button
            className="back-btn"
            onClick={logout}
            title="Log out"
            style={{ fontSize: 12, padding: '6px 10px' }}
          >
            Log out
          </button>
        </div>
      </div>

      <div className="dash-stats">
        <div className="dash-stat">
          <div className="dash-stat-num">{state.stats.submitted}</div>
          <div className="dash-stat-label">Submitted</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-num" style={{ color: 'var(--oh-orange)' }}>{state.stats.offers}</div>
          <div className="dash-stat-label">Offers</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-num" style={{ color: 'var(--oh-green)' }}>{state.stats.closures}</div>
          <div className="dash-stat-label">Closures</div>
        </div>
      </div>

      {/* Status filter pills */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          padding: '8px 16px 12px',
          whiteSpace: 'nowrap',
        }}
      >
        {FILTER_OPTIONS.map((f) => {
          const active = filter === f;
          const count =
            f === 'All'
              ? state.submissions.length
              : state.submissions.filter((s) => s.status === f).length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                border: `1.5px solid ${active ? 'var(--oh-orange)' : 'var(--oh-border)'}`,
                background: active ? 'var(--oh-orange)' : '#fff',
                color: active ? '#fff' : 'var(--oh-charcoal)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                flexShrink: 0,
              }}
            >
              {f === 'Unapproved' ? 'Pending Review' : f} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
            </button>
          );
        })}
      </div>

      <div className="section-title">Your Inventory</div>

      {state.loading ? (
        <>
          <UnitCardSkeleton />
          <UnitCardSkeleton />
        </>
      ) : state.error ? (
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <p>{state.error}</p>
        </div>
      ) : visibleSubmissions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏠</div>
          <p>
            {filter === 'All'
              ? <>No units submitted yet.<br />Tap + to add your first unit.</>
              : <>No units in <strong>{filter === 'Unapproved' ? 'Pending Review' : filter}</strong>.</>}
          </p>
        </div>
      ) : (
        visibleSubmissions.map((s) => {
          const thumbId = Array.isArray(s.photos) && s.photos.length > 0 ? s.photos[0] : null;
          const hasPendingCounter = s.counter_offer_status === 'pending' && s.counter_offer_price;
          const busy = counterBusy[s.id];
          return (
            <div className="unit-card" key={s.id}>
              <div className="unit-card-body" style={{ display: 'flex', gap: 14 }}>
                {thumbId && (
                  <img
                    src={thumbnailUrl(thumbId, 80)}
                    alt=""
                    style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="unit-card-header">
                    <div>
                      <div className="unit-card-society">{s.society_name}</div>
                      <div className="unit-card-config">
                        {[
                          s.tower && `${s.tower}${s.unit_no ? '-' + s.unit_no : ''}`,
                          s.bhk,
                          s.sqft && `${s.sqft} sqft`,
                          s.floor && `Floor ${s.floor}`,
                        ].filter(Boolean).join(' · ')}
                      </div>
                      {s.public_id && (
                        <div style={{
                          fontSize: 11, color: 'var(--oh-gray)', fontFamily: 'monospace',
                          fontWeight: 600, letterSpacing: '0.5px', marginTop: 2,
                        }}>
                          {s.public_id}
                        </div>
                      )}
                    </div>
                    <div className={badgeClass(s.status)} style={badgeStyle(s.status)}>
                      {badgeLabel(s.status)}
                    </div>
                  </div>
                  <div className="unit-card-price">
                    {formatPrice(s.asking_price)}
                    {s.sqft && s.asking_price ? (
                      <span>₹{Math.round(s.asking_price / s.sqft).toLocaleString('en-IN')}/sqft</span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Counter offer banner */}
              {hasPendingCounter && (
                <div
                  style={{
                    margin: '12px 0 0',
                    padding: '12px 14px',
                    background: 'linear-gradient(135deg, #FFF8EC 0%, #FFF3ED 100%)',
                    border: '1.5px solid var(--oh-orange)',
                    borderRadius: 10,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--oh-orange)', letterSpacing: '0.5px', marginBottom: 4 }}>
                    COUNTER OFFER FROM OPENHOUSE
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--oh-charcoal)' }}>
                    {formatPrice(s.counter_offer_price)}
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={() => handleCounterResponse(s.id, 'reject')}
                      disabled={!!busy}
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1.5px solid var(--oh-border)',
                        background: '#fff',
                        color: 'var(--oh-charcoal)',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: busy ? 'not-allowed' : 'pointer',
                        opacity: busy ? 0.5 : 1,
                        fontFamily: 'inherit',
                      }}
                    >
                      {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCounterResponse(s.id, 'accept')}
                      disabled={!!busy}
                      className="primary-btn"
                      style={{ flex: 1, marginTop: 0, padding: '10px 12px', fontSize: 13 }}
                    >
                      {busy === 'accept' ? 'Accepting…' : 'Accept'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      <Chatbot />
    </div>
  );
}
