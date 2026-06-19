import { useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../api';
import { thumbnailUrl } from '../cloudinary';
import { useAuth } from '../contexts/AuthContext';
import { formatPrice, stageLabel } from '../format';
import { UnitCardSkeleton } from '../components/Skeleton';
import SubmissionDetailModal from './SubmissionDetailModal';
import ConfirmDialog from '../components/ConfirmDialog';
import AgingStrip from '../components/AgingStrip';

// Stats / filter boxes shown at the top. Clicking a box filters the list.
// Note: 'Price Rejected' / 'Rejected' are intentionally NOT in the filter row
//       (still visible under 'All').
// Buckets are coarser than DB statuses — see syntheticStatus() for the fold:
//   'Submitted' bucket = Submitted + Visit Scheduled + Visit Completed
//   'Offer'     bucket = Offer + Closure
const FILTER_BOXES = [
  { key: 'All',      label: 'ALL',      color: '#6366F1' },
  { key: 'Visited',  label: 'VISITED',  color: '#10B981' },
  { key: 'Offer',    label: 'OFFER',    color: '#FF6B2B' },
  { key: 'Closure',  label: 'CLOSURE',  color: '#16A34A' },
];

function badgeClass(s) {
  // Perfect-match auto-created rows get a distinct red badge — these are
  // CP submissions that were rejected as duplicates at submit time. They're
  // not in the normal pipeline; CP can ignore them or follow up with their RM.
  if (s.perfect_match_at_submit) return 'badge badge-rejected';
  const status = s.status;
  if (status === 'Unapproved') return 'badge';
  if (status === 'Offer' || status === 'Closure' || status === 'Accepted') return 'badge badge-offer';
  if (status === 'Visit Completed' || status === 'Visit Scheduled') return 'badge badge-closed';
  if (status === 'Price Rejected' || status === 'Rejected') return 'badge badge-rejected';
  return 'badge badge-submitted';
}

function badgeStyle(s) {
  if (s.perfect_match_at_submit) {
    return { background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' };
  }
  if (s.status === 'Unapproved') {
    return { background: '#FFF8E1', color: '#B8860B', border: '1px solid #E8C86A' };
  }
  return undefined;
}

function badgeLabel(s) {
  if (s.perfect_match_at_submit) return 'OH already has this';
  if (s.status === 'Unapproved') return 'Pending Review';
  return stageLabel(s.status);
}

export default function Dashboard({ onAdd }) {
  const { user, logout } = useAuth();
  const [state, setState] = useState({
    loading: true,
    submissions: [],
    error: null,
  });
  const [rmPhone, setRmPhone] = useState(null);
  const [rmName, setRmName] = useState(null);
  const [filter, setFilter] = useState('All');
  const [counterBusy, setCounterBusy] = useState({});
  // Submission opened in the full-detail modal (null = modal closed)
  const [expandedSubmission, setExpandedSubmission] = useState(null);
  // Confirmation dialogs for destructive actions
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [pendingRejectId, setPendingRejectId] = useState(null);  // submission id awaiting reject confirmation

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
    // Resolve CP's assigned RM (via channel_partners.rm -> rms table).
    // Falls back server-side to city-level RM / legacy cities.rm_phone.
    api.getMyRm()
      .then((data) => {
        if (!alive) return;
        const rm = data?.rm;
        if (rm?.phone) {
          setRmPhone(rm.phone);
          setRmName(rm.name || 'Openhouse RM');
        } else {
          setRmPhone('+919555666059');
          setRmName('Openhouse RM');
        }
      })
      .catch(() => {
        if (alive) {
          setRmPhone('+919555666059');
          setRmName('Openhouse RM');
        }
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.city]);

  // Synthetic status used for filtering/counting only (actual DB status unchanged).
  // Tabs: ALL / VISITED / OFFER / CLOSURE.
  //   - VISITED  = Visit Completed only.
  //   - OFFER    = Offer.
  //   - CLOSURE  = Closure.
  //   - Everything else (Submitted, Unapproved, Visit Scheduled, Rejected, …)
  //     has no dedicated tab and is only visible under ALL.
  const syntheticStatus = (s) => {
    if (s.status === 'Visit Completed') return 'Visited';
    if (s.status === 'Offer') return 'Offer';
    if (s.status === 'Closure') return 'Closure';
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
    try {
      await api.counterOfferResponse(submissionId, action);
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
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
            onClick={() => setShowLogoutConfirm(true)}
            title="Log out"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#fff',
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.3)',
              padding: '4px 12px',
              borderRadius: 999,
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.3px',
            }}
          >
            Log out
          </button>
        </div>
      </div>

      {/* Clickable filter/stat boxes — fixed-width chips centered as a group,
          so removing a box doesn't stretch the remaining ones. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${FILTER_BOXES.length}, 88px)`,
          gap: 8,
          justifyContent: 'center',
          padding: '12px 16px 8px',
        }}
      >
        {FILTER_BOXES.map((box) => {
          const active = filter === box.key;
          const count = counts[box.key] || 0;
          return (
            <button
              key={box.key}
              type="button"
              onClick={() => setFilter(active && box.key !== 'All' ? 'All' : box.key)}
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
          // Dim rejected listings so they visually recede in the CP list.
          const isRejected = s.status === 'Rejected' || s.status === 'Price Rejected' || s.perfect_match_at_submit;
          return (
            <div className="unit-card" key={s.id} style={isRejected ? { opacity: 0.6 } : undefined}>
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
                    <div className={badgeClass(s)} style={badgeStyle(s)}>
                      {badgeLabel(s)}
                    </div>
                  </div>
                  <div className="unit-card-price">
                    {formatPrice(s.asking_price)}
                    {s.sqft && s.asking_price ? (
                      <span>₹{Math.round(s.asking_price / s.sqft).toLocaleString('en-IN')}/sqft</span>
                    ) : null}
                  </div>
                  <AgingStrip submission={s} placement="inline" />
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

                  {/* Contact RM — full-width WhatsApp pill */}
                  {rmPhone && (
                    <a
                      href={`https://wa.me/${rmPhone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
                        `Hi ${rmName || 'RM'}, I have a question about the counter offer on my listing ${s.public_id || ''} at ${s.society_name}.`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        width: '100%',
                        marginTop: 10,
                        padding: '10px 14px',
                        borderRadius: 10,
                        background: '#25D366',
                        color: '#fff',
                        fontSize: 13,
                        fontWeight: 600,
                        textDecoration: 'none',
                        boxShadow: '0 2px 8px rgba(37, 211, 102, 0.3)',
                        fontFamily: 'inherit',
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01a1.095 1.095 0 0 0-.795.372c-.272.296-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                      </svg>
                      Contact RM
                    </a>
                  )}

                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => setPendingRejectId(s.id)}
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
      <button className="register-btn" onClick={onAdd} title="Register your Inventory">
        <span className="plus">+</span>
        <span>Register your Inventory</span>
      </button>

      {/* WhatsApp RM — same position as the old chatbot button (bottom-left) */}
      {rmPhone && (
        <a
          className="wa-fab"
          href={`https://wa.me/${rmPhone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
            `Hi ${rmName || 'RM'}, I need help with my listings on the Openhouse Sourcing Portal.`
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`WhatsApp ${rmName || 'your RM'}`}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01a1.095 1.095 0 0 0-.795.372c-.272.296-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
          </svg>
        </a>
      )}

      {expandedSubmission && (
        <SubmissionDetailModal
          submission={expandedSubmission}
          onClose={() => setExpandedSubmission(null)}
        />
      )}

      {/* Logout confirmation */}
      <ConfirmDialog
        open={showLogoutConfirm}
        title="Log out?"
        message="You'll need to sign in again to view or add your listings."
        confirmLabel="Log out"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => { setShowLogoutConfirm(false); logout(); }}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      {/* Reject counter offer confirmation */}
      <ConfirmDialog
        open={pendingRejectId !== null}
        title="Reject counter offer?"
        message="Are you sure you want to reject the counter offer?"
        confirmLabel="Reject"
        cancelLabel="Cancel"
        destructive
        busy={pendingRejectId !== null && counterBusy[pendingRejectId] === 'reject'}
        onConfirm={async () => {
          const id = pendingRejectId;
          if (id === null) return;
          // close dialog BEFORE the network call so UI feels snappy; handler shows its own spinner on the card
          setPendingRejectId(null);
          await handleCounterResponse(id, 'reject');
        }}
        onCancel={() => setPendingRejectId(null)}
      />
    </div>
  );
}