import { useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../api';
import { clearSession } from '../auth';
import { thumbnailUrl } from '../cloudinary';
import { useAuth } from '../contexts/AuthContext';
import { formatBhk, formatPrice, stageLabel } from '../format';
import { UnitCardSkeleton } from '../components/Skeleton';
import SubmissionDetailModal from './SubmissionDetailModal';
import ConfirmDialog from '../components/ConfirmDialog';
import AgingStrip from './AgingStrip';
import ShareMediaModal from './ShareMediaModal';
import BookVisitModal from './BookVisitModal';
import MediaVisitActions from './MediaVisitActions';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { IconSearch } from '../components/icons.jsx';

// Real DB stages the accurate-count endpoint reports on (mirror of the backend
// VALID_STAGES); summed for the "ALL" box so the count reflects the CP's full
// history, not just the 100 rows the list endpoint returns.
const VALID_STAGES = ['Unapproved', 'Submitted', 'Visit Requested', 'Offer', 'Closure', 'Visit Scheduled', 'Visit Completed', 'Price Rejected', 'Rejected'];

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
  if (status === 'Visit Requested') return 'badge';  // violet style via badgeStyle
  return 'badge badge-submitted';
}

function badgeStyle(s) {
  // Token pairs / translucent tints so these read in BOTH light and dark
  // (the light-hex versions glared as white blobs in dark mode).
  if (s.perfect_match_at_submit) {
    return { background: 'var(--red-bg)', color: 'var(--red-fg)', border: '1px solid var(--red)' };
  }
  if (s.status === 'Unapproved') {
    return { background: '#ffd73b', color: '#1a1a1a', border: '1px solid #ffd73b' };
  }
  if (s.status === 'Visit Requested') {
    return { background: 'rgba(139,92,246,0.16)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.42)' };
  }
  return undefined;
}

function badgeLabel(s) {
  if (s.perfect_match_at_submit) return 'OH already has this';
  if (s.status === 'Unapproved') return 'Pending Review';
  return stageLabel(s.status);
}

export default function Dashboard({ rmPhone }) {
  const { user } = useAuth();
  const [state, setState] = useState({
    loading: true,
    submissions: [],
    error: null,
  });
  const [filter, setFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [counterBusy, setCounterBusy] = useState({});
  // Accurate per-stage counts (full history) for the filter boxes, and
  // server-side search results (past the 100-row list cap).
  const [statCounts, setStatCounts] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debouncedQuery = useDebouncedValue(searchQuery, 300);
  // Submission opened in the full-detail modal (null = modal closed)
  const [expandedSubmission, setExpandedSubmission] = useState(null);
  const [mediaSubmission, setMediaSubmission] = useState(null);  // card "Upload Media"
  const [bookSubmission, setBookSubmission] = useState(null);    // card "Book Visit Slot"
  // Confirmation dialog for the reject-counter-offer action
  const [pendingRejectId, setPendingRejectId] = useState(null);  // submission id awaiting reject confirmation

  const loadSubmissions = () => {
    setState((st) => ({ ...st, loading: true }));
    // Accurate filter-box counts over the CP's full history (list caps at 100).
    api.submissionsStats().then((d) => setStatCounts(d.stats || {})).catch(() => {});
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
    loadSubmissions();
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

  // Filter-box counts: accurate totals from /submissions/stats (full history),
  // falling back to the loaded set until the stats call lands.
  const counts = useMemo(() => {
    if (statCounts) {
      return {
        All: VALID_STAGES.reduce((a, k) => a + (Number(statCounts[k]) || 0), 0),
        Visited: Number(statCounts['Visit Completed']) || 0,
        Offer: Number(statCounts['Offer']) || 0,
        Closure: Number(statCounts['Closure']) || 0,
      };
    }
    const c = { All: state.submissions.length };
    for (const s of state.submissions) {
      const key = syntheticStatus(s);
      c[key] = (c[key] || 0) + 1;
    }
    return c;
  }, [statCounts, state.submissions]);

  // Server-side search over the CP's FULL history (past the 100-row list cap),
  // debounced. Empty query → clear results and fall back to the loaded list.
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) { setSearchResults([]); setSearching(false); return undefined; }
    let alive = true;
    setSearching(true);
    api.searchSubmissions(q)
      .then((d) => { if (alive) setSearchResults(d.submissions || []); })
      .catch(() => { if (alive) setSearchResults([]); })
      .finally(() => { if (alive) setSearching(false); });
    return () => { alive = false; };
  }, [debouncedQuery]);

  const searchActive = searchQuery.trim().length > 0;
  const visibleSubmissions = useMemo(() => {
    // When searching, the source is the server results (already matched across
    // all data); otherwise the loaded list. The tab filter applies on top.
    const source = searchActive ? searchResults : state.submissions;
    return filter === 'All' ? source : source.filter((s) => syntheticStatus(s) === filter);
  }, [searchActive, searchResults, state.submissions, filter]);

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
    <div className="cp-shell">
      {/* Header: logo flush-left, greeting to the right. */}
      <div className="header cp-home-header">
        <img src="/openhouse-logo.png" alt="Openhouse" className="cp-logo" />
        <div className="cp-greeting">Hi, {user.name || 'there'}</div>
      </div>

      {/* Filter chips: ALL / VISITED / OFFER / CLOSURE. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${FILTER_BOXES.length}, 1fr)`,
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
              type="button"
              onClick={() => setFilter(active && box.key !== 'All' ? 'All' : box.key)}
              className={`cp-filter${active ? ' active' : ''}`}
            >
              <div className="cp-filter-count">
                {count}
              </div>
              <div className="cp-filter-lbl">
                {box.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Always-visible search bar with a magnifier to its left. */}
      <div style={{ padding: '8px 16px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden style={{ display: 'flex', color: 'var(--text-faint)', flexShrink: 0 }}><IconSearch size={17} /></span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search society, tower, unit, ID…"
            className="input-field"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div className="section-title">
        {searchActive ? 'Search results' : (filter === 'All' ? 'Your Inventory' : `${FILTER_BOXES.find(b => b.key === filter)?.label || filter}`)}
      </div>

      {(state.loading || (searchActive && searching && visibleSubmissions.length === 0)) ? (
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
          <div className="empty-state-icon">{searchActive ? '🔍' : '🏠'}</div>
          <p>
            {searchActive
              ? <>No matches for “{searchQuery.trim()}”.</>
              : filter === 'All'
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
          // Once both a photo AND a video exist, drop "Upload Media" from the card
          // (it lives at the bottom of the popup instead).
          const bothMedia = (Array.isArray(s.photos) && s.photos.length > 0)
            && (Array.isArray(s.videos) && s.videos.length > 0);
          const showCardActions = !isRejected && (s.status === 'Submitted' || !bothMedia);
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
                {/* Photo thumbnail hidden on the front card view */}
                {/* {thumbId && (
                  <img
                    src={thumbnailUrl(thumbId, 80)}
                    alt=""
                    style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                  />
                )} */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="unit-card-header">
                    <div>
                      <div className="unit-card-society">{s.society_name}</div>
                      <div className="unit-card-config">
                        {[
                          s.tower && `${s.tower}${s.unit_no ? '-' + s.unit_no : ''}`,
                          s.bhk && formatBhk(s.bhk),
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
                  {/* Reminder timer/aging strip temporarily disabled */}
                  {/* <AgingStrip submission={s} placement="inline" /> */}
                </div>
              </div>

              {/* Upload Media / Book Visit Slot — inset to match the card body
                  (the card itself has no padding) so it reads as part of the card. */}
              {showCardActions && (
                <div style={{ padding: '0 18px 16px' }}>
                  <MediaVisitActions
                    submission={s}
                    hideUploadMedia={bothMedia}
                    onUploadMedia={() => setMediaSubmission(s)}
                    onBookSlot={() => setBookSubmission(s)}
                  />
                </div>
              )}

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

                  {/* Call RM — tel: link (WhatsApp removed, P6 Task 1) */}
                  {rmPhone && (
                    <a
                      href={`tel:${rmPhone.replace(/\D/g, '')}`}
                      onClick={(e) => e.stopPropagation()}
                      className="primary-btn"
                      style={{
                        display: 'block',
                        width: '100%',
                        marginTop: 10,
                        textAlign: 'center',
                        textDecoration: 'none',
                      }}
                    >
                      📞 Call your RM
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

      {expandedSubmission && (
        <SubmissionDetailModal
          submission={expandedSubmission}
          onClose={() => setExpandedSubmission(null)}
        />
      )}

      {mediaSubmission && (
        <ShareMediaModal
          open
          submissionId={mediaSubmission.id}
          photoCount={Array.isArray(mediaSubmission.photos) ? mediaSubmission.photos.length : 0}
          videoCount={Array.isArray(mediaSubmission.videos) ? mediaSubmission.videos.length : 0}
          onClose={() => setMediaSubmission(null)}
          onShared={loadSubmissions}
        />
      )}
      {bookSubmission && (
        <BookVisitModal
          open
          submissionId={bookSubmission.id}
          onClose={() => setBookSubmission(null)}
          onBooked={loadSubmissions}
        />
      )}

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
