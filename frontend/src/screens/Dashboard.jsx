import { useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../api';
import { thumbnailUrl } from '../cloudinary';
import { useAuth } from '../contexts/AuthContext';
import { formatPrice } from '../format';
import { UnitCardSkeleton } from '../components/Skeleton';
import Chatbot from './Chatbot';
import SubmissionDetailModal from './SubmissionDetailModal';

// Stats / filter boxes shown at the top. Clicking a box filters the list.
// Note: 'Rejected' is intentionally NOT in the filter row (still visible under 'All').
const FILTER_BOXES = [
  { key: 'All',         label: 'All',            color: '#6366F1' },
  { key: 'Unapproved',  label: 'Pending Review', color: '#B8860B' },
  { key: 'Submitted',   label: 'Submitted',      color: '#6366F1' },
  { key: 'Offer Given', label: 'Offers',         color: '#FF6B2B' },
  { key: 'Closed',      label: 'Closures',       color: '#10B981' },
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
    error: null,
  });
  const [rmPhone, setRmPhone] = useState(null);
  const [filter, setFilter] = useState('All');
  const [counterBusy, setCounterBusy] = useState({});
  // Per-submission counter-offer comment text (optional CP note)
  const [counterComment, setCounterComment] = useState({});
  // Submission opened in the full-detail modal (null = modal closed)
  const [expandedSubmission, setExpandedSubmission] = useState(null);

  const loadSubmissions = () => {
    setState((st) => ({ ...st, loading: true }));
    return api.listSubmissions().then((data) => {
      setState({
        loading: false,
        submissions: data.submissions || [],
        error: null,
      });
    }).catch((err) => {
      setState({
        loading: false,
        submissions: [],
        error: err instanceof ApiError ? err.message : 'Failed to load your listings',
      });
    });
  };

  useEffect(() => {
    let alive = true;
    loadSubmissions();
    // Resolve CP's RM phone for the chatbot fallback
    api.getRmContacts()
      .then((data) => {
        if (!alive) return;
        const contacts = data?.contacts || {};
        const myRm = user.city && contacts[user.city];
        setRmPhone(myRm?.phone || '+919555666059');
      })
      .catch(() => {
        if (alive) setRmPhone('+919555666059');
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.city]);

  // Synthetic status used for filtering/counting only (actual DB status unchanged).
  // While admin has a submission in 'Evaluation' AND/OR there's a pending counter offer,
  // the CP sees it in the 'Submitted' filter. The counter offer banner still appears on
  // the card itself. Once the CP accepts or admin moves to Offer Given, it moves.
  const syntheticStatus = (s) => {
    if (s.counter_offer_status === 'pending') return 'Submitted';
    if (s.status === 'Evaluation') return 'Submitted';
    return s.status;
  };

  // Per-stage counts (used by the boxes and empty-state messaging)
  const counts = useMemo(() => {
    const c = { All: state.submissions.length };
    for (const s of state.submissions) {
      const key = syntheticStatus(s);
      c[key] = (c[key] || 0) + 1;
    }
    return c;
  }, [state.submissions]);

  const visibleSubmissions = useMemo(() => {
    if (filter === 'All') return state.submissions;
    return state.submissions.filter((s) => syntheticStatus(s) === filter);
  }, [state.submissions, filter]);

  const handleCounterResponse = async (submissionId, action) => {
    setCounterBusy((b) => ({ ...b, [submissionId]: action }));
    const comment = counterComment[submissionId] || '';
    try {
      await api.counterOfferResponse(submissionId, action, comment);
      setCounterComment((c) => {
        const next = { ...c };
        delete next[submissionId];
        return next;
      });
      await loadSubmissions();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not record your response.');
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
      {/* Header: name + CP code on left; city + logout top-right */}
      <div className="header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Hi, {user.name || 'there'}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
            {user.cp_code} · {user.company || '—'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#fff',
              background: 'rgba(255,255,255,0.15)',
              padding: '3px 10px',
              borderRadius: 999,
              letterSpacing: '0.3px',
            }}
          >
            📍 {user.city || 'All'}
          </div>
          <button
            className="back-btn"
            onClick={logout}
            title="Log out"
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            Log out
          </button>
        </div>
      </div>

      {/* 5 clickable filter/stat boxes */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 8,
          padding: '12px 16px 8px',
        }}
      >
        {FILTER_BOXES.map((box) => {
          const active = filter === box.key;
          const count = counts[box.key] || 0;
          return (
            <button
              key={box.key}
              onClick={() => setFilter(box.key)}
              style={{
                padding: '10px 6px',
                borderRadius: 10,
                border: `1.5px solid ${active ? box.color : 'var(--oh-border)'}`,
                background: active ? box.color : '#fff',
                color: active ? '#fff' : 'var(--oh-charcoal)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 64,
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                fontSize: 20,
                fontWeight: 700,
                color: active ? '#fff' : box.color,
                lineHeight: 1,
                marginBottom: 4,
              }}>
                {count}
              </div>
              <div style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
                textAlign: 'center',
                lineHeight: 1.2,
                opacity: active ? 0.95 : 0.7,
              }}>
                {box.label}
              </div>
            </button>
          );
        })}
      </div>

      <div className="section-title">
        {filter === 'All' ? 'Your Inventory' : `${FILTER_BOXES.find(b => b.key === filter)?.label || filter}`}
      </div>

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
              : <>No units in this stage.</>}
          </p>
        </div>
      ) : (
        visibleSubmissions.map((s) => {
          const thumbId = Array.isArray(s.photos) && s.photos.length > 0 ? s.photos[0] : null;
          const hasPendingCounter = s.counter_offer_status === 'pending' && s.counter_offer_price;
          const busy = counterBusy[s.id];
          return (
            <div className="unit-card" key={s.id}>
              <div
                className="unit-card-body"
                style={{ display: 'flex', gap: 14, cursor: 'pointer' }}
                onClick={() => setExpandedSubmission(s)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpandedSubmission(s);
                  }
                }}
              >
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
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--oh-orange)',
                    letterSpacing: '0.5px', marginBottom: 4,
                  }}>
                    COUNTER OFFER FROM OPENHOUSE
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--oh-charcoal)' }}>
                    {formatPrice(s.counter_offer_price)}
                  </div>

                  {/* Optional CP comment */}
                  <textarea
                    placeholder="Add a note (optional)"
                    rows={2}
                    value={counterComment[s.id] || ''}
                    onChange={(e) =>
                      setCounterComment((c) => ({ ...c, [s.id]: e.target.value }))
                    }
                    onClick={(e) => e.stopPropagation()}
                    disabled={!!busy}
                    maxLength={500}
                    style={{
                      width: '100%',
                      marginTop: 10,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--oh-border)',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      resize: 'none',
                      background: '#fff',
                    }}
                  />

                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
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

      {/* Floating-action-button — restored from pre-revamp UI */}
      <button className="fab" onClick={onAdd} title="Add unit">+</button>
      <Chatbot rmPhone={rmPhone} />

      {expandedSubmission && (
        <SubmissionDetailModal
          submission={expandedSubmission}
          onClose={() => setExpandedSubmission(null)}
        />
      )}
    </div>
  );
}
