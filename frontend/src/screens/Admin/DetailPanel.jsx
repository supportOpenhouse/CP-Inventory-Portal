import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '../../api';
import {
  formatDateTime, formatDateOnly, formatTime12, formatPrice, formatAcqPrice,
  STAGES, AUTO_ONLY_STAGES, REJECTED_REASONS, todayInIST,
} from '../../format';
import { getUser } from '../../auth';
import {
  uploadToCloudinary, validateFile, thumbnailUrl, previewUrl, MAX_PHOTOS,
} from '../../cloudinary';
import WhatsAppThread from './WhatsAppThread';

// Fields the admin can edit (mirrors EDITABLE_FIELDS in backend/routes/admin.py) go
const EDITABLE_FIELDS = [
  { key: 'tower',               label: 'Tower',            type: 'text'   },
  { key: 'unit_no',              label: 'Unit No',          type: 'text'   },
  { key: 'floor',                label: 'Floor',            type: 'text'   },
  { key: 'sqft',                 label: 'Area (sqft)',      type: 'number' },
  { key: 'bhk',                  label: 'BHK',              type: 'text'   },
  { key: 'occupancy_status',     label: 'Occupancy',        type: 'text'   },
  { key: 'asking_price',         label: 'Asking price (₹)', type: 'number' },
  { key: 'seller_name',          label: 'Seller name',      type: 'text'   },
  { key: 'seller_phone',         label: 'Seller phone',     type: 'text'   },
  { key: 'drive_links',          label: 'Google Drive URLs (one per line)', type: 'textarea' },
  { key: 'additional_comments',  label: 'Additional comments', type: 'textarea' },
];

export default function DetailPanel({ submissionId, onClose, onChanged, onOpenCpHistory }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  // 'Rejected' picked in the parent dropdown but reason not yet chosen —
  // shows the reason sub-dropdown without persisting the status change yet.
  const [pendingRejected, setPendingRejected] = useState(false);
  const [rms, setRms] = useState([]);
  const [uploadingPct, setUploadingPct] = useState(null);
  // Counter offer inputs
  const [counterOfferLakhs, setCounterOfferLakhs] = useState('');
  const [sendingCounter, setSendingCounter] = useState(false);
  const [lightboxId, setLightboxId] = useState(null);
  // RM-assignment scope: 'listing' = this listing only (default);
  // 'society' = this listing + future submissions of this society
  // (writes society_rm_mappings so the resolver picks up the mapping at
  // insert time for new submissions of the same society).
  const [rmAssignMode, setRmAssignMode] = useState('listing');
  const fileInputRef = useRef(null);
  const notesEndRef = useRef(null);
  // Tracks the notes (comment) count across renders so the auto-scroll fires
  // only when a new note is appended — never on a card's initial load. The
  // Add-a-note input lives at the top of the Notes section, so when a note
  // is added we scroll the notes list down to make the new entry visible.
  const prevNotesCount = useRef(null);

  const user = getUser();
  const isAdmin = user?.role === 'admin';
  const isViewer = user?.role === 'viewer';
  const isManager = !isAdmin && !isViewer && (user?.role === 'manager' || user?.isManager);
  const canReassign = isAdmin || isManager;
  // `isStaff` = can perform actions. Viewer is deliberately excluded —
  // they get a fully read-only detail panel.
  const isStaff = isAdmin || user?.role === 'manager' || user?.role === 'rm';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminGetSubmission(submissionId);
      setData(res);
      setEditMode(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    // New card opened — reset the scroll baseline so the notes effect
    // below doesn't treat the first populate as "new note".
    prevNotesCount.current = null;
    load();
  }, [load]);

  useEffect(() => {
    if ((!isStaff && !isViewer) || rms.length > 0) return;
    api.adminListRms().then((r) => setRms(r.rms || [])).catch(() => {});
  }, [isStaff, isViewer, rms.length]);

  // Events split: comments are "notes" (user-authored), the rest is "activity"
  // (status changes, system events). Computed here so the auto-scroll effect
  // and the render below share the same partition.
  const allEvents = data?.events || [];
  const notes = allEvents.filter((ev) => ev.kind === 'comment');
  const activityEvents = allEvents.filter((ev) => ev.kind !== 'comment');

  useEffect(() => {
    // Scroll the notes list to the latest note when one is appended — skip
    // the initial load (prevNotesCount starts null) so opening a card with
    // existing notes doesn't yank the whole panel.
    if (prevNotesCount.current != null && notes.length > prevNotesCount.current) {
      notesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevNotesCount.current = notes.length;
  }, [notes.length]);

  const handleStatusChange = async (newStatus, newReason = null) => {
    if (!data || busy) return;
    const cur = data.submission;
    if (newStatus === cur.status && (newReason || null) === (cur.status_reason || null)) return;
    setBusy(true);
    try {
      await api.adminChangeStatus(submissionId, newStatus, newReason);
      await load();
      onChanged?.();
    } catch (err) {
      alert(err.message || 'Failed to change status');
    } finally {
      setBusy(false);
    }
  };

  const handleSendCounterOffer = async () => {
    const lakhs = parseFloat(counterOfferLakhs);
    if (!isFinite(lakhs) || lakhs <= 0) {
      alert('Enter a valid counter offer in lakhs');
      return;
    }
    if (!window.confirm(
      `Send counter offer of ₹${lakhs} lakhs to the CP?\n\nThis moves the listing to 'Offer Given'. The CP can accept, reject (moves to 'Price Rejected'), or counter back.`
    )) return;
    setSendingCounter(true);
    try {
      await api.adminSendCounterOffer(submissionId, lakhs);
      setCounterOfferLakhs('');
      await load();
      onChanged?.();
    } catch (err) {
      alert(err.message || 'Failed to send counter offer');
    } finally {
      setSendingCounter(false);
    }
  };

  const handleAddComment = async () => {
    const text = newComment.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.adminAddComment(submissionId, text);
      setNewComment('');
      await load();
    } catch (err) {
      alert(err.message || 'Failed to add comment');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    const s = data?.submission;
    if (!s) return;
    const form = {};
    EDITABLE_FIELDS.forEach(({ key }) => {
      form[key] = s[key] ?? '';
    });
    setEditForm(form);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setEditForm({});
  };

  const saveEdit = async () => {
    if (busy) return;
    // Build payload of only changed fields
    const orig = data.submission;
    const payload = {};
    EDITABLE_FIELDS.forEach(({ key, type }) => {
      const newVal = editForm[key];
      const oldVal = orig[key];
      const normalizedOld = oldVal === null || oldVal === undefined ? '' : String(oldVal);
      const normalizedNew = newVal === null || newVal === undefined ? '' : String(newVal);
      if (normalizedOld !== normalizedNew) {
        if (type === 'number' && newVal !== '') {
          payload[key] = parseInt(newVal, 10);
        } else {
          payload[key] = newVal === '' ? null : newVal;
        }
      }
    });

    if (Object.keys(payload).length === 0) {
      setEditMode(false);
      return;
    }

    setBusy(true);
    try {
      await api.adminUpdateSubmission(submissionId, payload);
      await load();
      onChanged?.();
    } catch (err) {
      alert(err.message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  // Per-listing RM override (submissions.listing_rm_id). Doesn't touch the
  // CP's permanent RM. When updateSocietyMapping=true, also upserts
  // society_rm_mappings so future submissions of this society route to
  // the same RM.
  const assignListingRm = async (rmIdRaw, { updateSocietyMapping = false } = {}) => {
    if (busy) return;
    const rmId = rmIdRaw ? parseInt(rmIdRaw, 10) : null;
    const sid = data?.submission?.id;
    if (!sid) return;
    setBusy(true);
    try {
      await api.adminSetListingRm(sid, rmId, { updateSocietyMapping });
      await load();
      onChanged?.();
    } catch (err) {
      alert(err.message || 'Failed to set listing RM');
    } finally {
      setBusy(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const currentPhotos = Array.isArray(data?.submission?.photos) ? data.submission.photos : [];
    if (currentPhotos.length + files.length > MAX_PHOTOS) {
      alert(`Max ${MAX_PHOTOS} photos per submission. Already has ${currentPhotos.length}.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const newIds = [];
    for (const file of files) {
      const err = validateFile(file);
      if (err) { alert(err); continue; }
      try {
        setUploadingPct(0);
        const { publicId } = await uploadToCloudinary(file, setUploadingPct);
        newIds.push(publicId);
      } catch (uploadErr) {
        alert(`Upload failed: ${uploadErr.message}`);
      }
    }
    setUploadingPct(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (newIds.length) {
      try {
        await api.adminUpdateSubmission(submissionId, {
          photos: [...currentPhotos, ...newIds],
        });
        await load();
        onChanged?.();
      } catch (err) {
        alert(err.message || 'Failed to save photos');
      }
    }
  };

  const handleRemovePhoto = async (publicId) => {
    if (busy) return;
    if (!confirm('Remove this photo from the submission?')) return;
    const current = Array.isArray(data?.submission?.photos) ? data.submission.photos : [];
    const remaining = current.filter((p) => p !== publicId);
    setBusy(true);
    try {
      await api.adminUpdateSubmission(submissionId, { photos: remaining });
      await load();
      onChanged?.();
    } catch (err) {
      alert(err.message || 'Failed to remove');
    } finally {
      setBusy(false);
    }
  };

  const s = data?.submission;

  return (
    <>
      <div className="panel-overlay" onClick={onClose} />
      <div className="admin-panel">
        <div className="admin-panel-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            {loading ? (
              <div style={{ fontSize: 16, color: '#999' }}>Loading…</div>
            ) : error ? (
              <div style={{ fontSize: 14, color: 'var(--oh-red)' }}>{error}</div>
            ) : s ? (
              <>
                <div className="admin-panel-title">{s.society_name}</div>
                {s.public_id && (
                  <div
                    style={{
                      fontSize: 12,
                      color: '#666',
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      letterSpacing: '0.5px',
                      marginTop: 2,
                    }}
                  >
                    {s.public_id}
                  </div>
                )}
                <div className="admin-panel-sub">
                  {[s.city, s.tower && s.unit_no ? `${s.tower}-${s.unit_no}` : null, s.floor && `Floor ${s.floor}`]
                    .filter(Boolean).join(' · ')}
                </div>
              </>
            ) : null}
          </div>
          <button className="panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Staff action bar — edit open to managers/RMs too */}
        {s && isStaff && !editMode && (
          <div className="admin-panel-actions">
            <button className="btn-secondary-sm" onClick={startEdit} disabled={busy}>✏ Edit</button>
          </div>
        )}

        <div className="admin-panel-body">
          {s && !editMode && (
            <>
              {/* Banners for perfect-match / withdrawn / unit-less */}
              {s.perfect_match_at_submit && (
                <div style={{
                  margin: '0 0 14px',
                  padding: '10px 12px',
                  background: '#fef2f2',
                  border: '1.5px solid #fca5a5',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#991b1b',
                }}>
                  <strong>⚠ Perfect match detected at submit time.</strong>
                  <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                    Same society + BHK + floor + unit number was already in our system or properties DB
                    when the CP submitted this.
                  </div>
                </div>
              )}
              {s.deleted_at && (
                <div style={{
                  margin: '0 0 14px',
                  padding: '10px 12px',
                  background: '#fef3c7',
                  border: '1.5px solid #fcd34d',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#92400e',
                  fontWeight: 600,
                }}>
                  ✓ Withdrawn{s.withdraw_reason === 'cp_withdrawn' ? ' by CP' : ''}
                </div>
              )}
              {s.unit_less && !s.perfect_match_at_submit && !s.deleted_at && (() => {
                // Banner color reflects the strongest match signal:
                //   submissions_match → purple (another CP has this)
                //   collated_match    → yellow (99acres listing exists)
                //   neither           → soft yellow (auto-approved unit-less)
                const hasSubmissions = !!s.submissions_match;
                const hasCollated = !!s.collated_match;
                const bg = hasSubmissions ? '#f5f3ff' : '#fffbeb';
                const border = hasSubmissions ? '1px solid #c4b5fd' : '1px solid #fcd34d';
                const color = hasSubmissions ? '#5b21b6' : '#78350f';
                let suffix;
                if (hasSubmissions && hasCollated) suffix = ' · matches both another CP submission and a 99acres listing';
                else if (hasSubmissions) suffix = ' · matches another CP submission';
                else if (hasCollated) suffix = ' · matches a 99acres listing';
                else suffix = ' · auto-approved';
                return (
                  <div style={{
                    margin: '0 0 14px',
                    padding: '8px 12px',
                    background: bg,
                    border,
                    borderRadius: 8,
                    fontSize: 12,
                    color,
                  }}>
                    Submitted without unit number{suffix}
                  </div>
                );
              })()}

              {/* Status — selectable for staff, read-only label for viewers.
                  Restrictions:
                    - Visit Scheduled / Visit Completed / Offer Given are
                      AUTO_ONLY: never offered as manual destinations, and
                      when the row is already in one of them the dropdown is
                      hidden (transitions out happen via dedicated flows).
                    - Picking 'Rejected' reveals a second dropdown of 8
                      sub-reasons (status_reason) — submission only fires
                      once both are set. */}
              <div className="admin-panel-section">
                <div className="admin-panel-label">Status</div>
                {isStaff && !AUTO_ONLY_STAGES.has(s.status) ? (
                  <>
                    <select
                      className="status-select"
                      value={pendingRejected ? 'Rejected' : s.status}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'Rejected') {
                          // Show the reason sub-dropdown; don't persist yet.
                          // If the row is already Rejected, reuse existing reason.
                          setPendingRejected(true);
                          return;
                        }
                        setPendingRejected(false);
                        handleStatusChange(v, null);
                      }}
                      disabled={busy}
                    >
                      {STAGES.map((st) => (
                        <option
                          key={st.key}
                          value={st.key}
                          disabled={AUTO_ONLY_STAGES.has(st.key)}
                        >
                          {st.key}{AUTO_ONLY_STAGES.has(st.key) ? ' (auto)' : ''}
                        </option>
                      ))}
                    </select>
                    {(s.status === 'Rejected' || pendingRejected) && (
                      <select
                        className="status-select"
                        style={{ marginTop: 6 }}
                        value={s.status_reason || ''}
                        onChange={(e) => {
                          const reason = e.target.value || null;
                          setPendingRejected(false);
                          if (reason) handleStatusChange('Rejected', reason);
                        }}
                        disabled={busy}
                      >
                        <option value="" disabled>Select reason…</option>
                        {REJECTED_REASONS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    )}
                  </>
                ) : (
                  <div className="admin-panel-val" style={{ fontWeight: 500 }}>
                    {s.status}{s.status_reason ? ` (${s.status_reason})` : ''}
                    {AUTO_ONLY_STAGES.has(s.status) && (
                      <div style={{ fontSize: 11, color: '#888', fontWeight: 400, marginTop: 2 }}>
                        Set automatically — not manually changeable from here.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Schedule Visit — admin clicks this on a 'Submitted' row.
                  Successful scheduling auto-promotes status to 'Visit Scheduled'
                  (handled server-side). For rows already in 'Visit Scheduled'
                  the section shows the existing schedule pill so admins can
                  see/reschedule. Viewers see only the info pill. */}
              {(s.status === 'Submitted' || s.status === 'Visit Scheduled')
                && (s.forms_uid || isStaff) && (
                <ScheduleVisitSection
                  submission={s}
                  onScheduled={(result) => {
                    // Patch the local detail with the new schedule info so
                    // the section flips to "Already scheduled" without a refetch.
                    setData((prev) => prev ? {
                      ...prev,
                      submission: {
                        ...prev.submission,
                        forms_uid: result.uid,
                        scheduled_date: result.scheduled_date,
                        scheduled_time: result.scheduled_time,
                        field_exec_name: result.field_exec_name,
                        // Server auto-promotes Submitted → Visit Scheduled.
                        status: result.status_promoted ? 'Visit Scheduled' : prev.submission.status,
                        status_reason: result.status_promoted ? null : prev.submission.status_reason,
                      },
                    } : prev);
                    onChanged?.();
                  }}
                />
              )}

              {/* Unit details */}
              <div className="admin-panel-section">
                <div className="admin-panel-section-title">Unit details</div>
                <div className="admin-detail-grid">
                  <Row label="BHK" value={s.bhk} />
                  <Row label="Area" value={s.sqft ? `${s.sqft} sqft` : null} />
                  <Row label="Floor" value={s.floor} />
                  <Row label="Occupancy" value={s.occupancy_status} />
                </div>
              </div>

              {/* Pricing */}
              <div className="admin-panel-section">
                <div className="admin-panel-section-title">Pricing</div>
                <div className="admin-detail-grid">
                  <div>
                    <div className="admin-panel-label">Asking</div>
                    <div className="admin-panel-val" style={{ color: '#FF6B2B', fontWeight: 700 }}>{formatPrice(s.asking_price)}</div>
                  </div>
                  {(() => {
                    const acq = formatAcqPrice(s.acq_price_lakhs, s.acq_sqft, s.sqft);
                    if (!acq) return null;
                    const isSuggested = acq.display.includes('~');
                    return (
                      <div title={acq.tooltip}>
                        <div className="admin-panel-label">
                          Acq{isSuggested ? ' (suggested)' : ''}
                        </div>
                        <div className="admin-panel-val" style={{ color: '#16a34a', fontWeight: 700 }}>
                          {isSuggested ? '~' : ''}{formatPrice(s.acq_price_lakhs * 100000)}
                        </div>
                        {isSuggested && s.acq_sqft && (
                          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                            for {s.acq_sqft} sqft
                            {s.sqft ? ` · your unit: ${s.sqft} sqft` : ''}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {s.asking_price && s.sqft ? (
                    <div>
                      <div className="admin-panel-label">Rate / sqft</div>
                      <div className="admin-panel-val">₹{Math.round(s.asking_price / s.sqft).toLocaleString('en-IN')}</div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Counter offer — visible when in Visit Completed (admin can send one) or when one already exists */}
              {(s.status === 'Visit Completed' || s.counter_offer_status) && (
                <div className="admin-panel-section">
                  <div className="admin-panel-section-title">Counter Offer</div>

                  {/* Negotiation tally — how many offers we sent vs how many
                      times the CP countered back. Signals the CP's intent. */}
                  {(s.counter_offers_sent > 0 || s.cp_counter_offers > 0) && (
                    <div style={{ fontSize: 12, color: 'var(--oh-gray)', marginBottom: 10 }}>
                      <strong style={{ color: 'var(--oh-charcoal)' }}>{s.counter_offers_sent || 0}</strong> sent
                      {' · '}
                      <strong style={{ color: 'var(--oh-charcoal)' }}>{s.cp_counter_offers || 0}</strong> countered by CP
                    </div>
                  )}

                  {/* Show current counter offer state if any */}
                  {s.counter_offer_status && (
                    <div
                      style={{
                        padding: '10px 12px',
                        background:
                          s.counter_offer_status === 'pending' ? '#FFF8EC' :
                          s.counter_offer_status === 'accepted' ? '#ECFDF5' : '#FEE2E2',
                        border: `1px solid ${
                          s.counter_offer_status === 'pending' ? '#E8A838' :
                          s.counter_offer_status === 'accepted' ? '#10B981' : '#DC2626'
                        }`,
                        borderRadius: 8,
                        marginBottom: 10,
                        fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>
                        {formatPrice(s.counter_offer_price)} · {s.counter_offer_status.toUpperCase()}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--oh-gray)' }}>
                        Sent {s.counter_offer_at ? formatDateTime(s.counter_offer_at) : '—'}
                      </div>
                      {s.counter_offer_status === 'broker_countered' && s.broker_counter_price != null && (
                        <div style={{ fontWeight: 600, marginTop: 6 }}>
                          Broker countered: {formatPrice(s.broker_counter_price)}
                          {s.broker_counter_at && (
                            <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--oh-gray)', marginLeft: 6 }}>
                              {formatDateTime(s.broker_counter_at)}
                            </span>
                          )}
                        </div>
                      )}
                      {s.counter_offer_response_text && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: '8px 10px',
                            background: 'rgba(255,255,255,0.7)',
                            border: '1px solid rgba(0,0,0,0.08)',
                            borderRadius: 6,
                            fontSize: 12,
                            color: 'var(--oh-charcoal)',
                          }}
                        >
                          <div style={{
                            fontSize: 10, fontWeight: 700, color: 'var(--oh-gray)',
                            letterSpacing: '0.5px', marginBottom: 2, textTransform: 'uppercase',
                          }}>
                            CP note
                          </div>
                          "{s.counter_offer_response_text}"
                        </div>
                      )}
                    </div>
                  )}

                  {/* Input — shown for the first counter ('Visit Completed') and for a
                      follow-up counter once the broker has countered back ('Offer Given'
                      + 'broker_countered'). Hidden while a counter is still pending.
                      Gated on isStaff so viewers can't send one. */}
                  {isStaff && s.counter_offer_status !== 'pending'
                    && (s.status === 'Visit Completed'
                        || (s.status === 'Offer Given' && s.counter_offer_status === 'broker_countered')) && (
                    <>
                      <div className="admin-panel-label">Send counter offer (in lakhs)</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="e.g. 92"
                          value={counterOfferLakhs}
                          onChange={(e) => setCounterOfferLakhs(e.target.value.replace(/[^0-9.]/g, ''))}
                          style={{
                            flex: 1,
                            padding: '8px 10px',
                            border: '1.5px solid var(--oh-border)',
                            borderRadius: 8,
                            fontSize: 14,
                            fontFamily: 'inherit',
                          }}
                          disabled={sendingCounter}
                        />
                        <button
                          type="button"
                          onClick={handleSendCounterOffer}
                          disabled={sendingCounter || !counterOfferLakhs}
                          className="primary-btn"
                          style={{
                            flex: 0,
                            marginTop: 0,
                            padding: '8px 16px',
                            fontSize: 13,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {sendingCounter ? 'Sending…' : 'Send offer'}
                        </button>
                      </div>
                      {counterOfferLakhs && parseFloat(counterOfferLakhs) > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--oh-gray)', marginTop: 4 }}>
                          = {formatPrice(parseFloat(counterOfferLakhs) * 100000)}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--oh-gray)', marginTop: 6 }}>
                        CP will accept/reject from their dashboard. Status auto-updates on response.
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* People */}
              <div className="admin-panel-section">
                <div className="admin-panel-section-title">People</div>
                <div className="admin-detail-grid">
                  <div>
                    <div className="admin-panel-label">Channel partner</div>
                    <div className="admin-panel-val">
                      <button
                        className="link-btn"
                        onClick={() => onOpenCpHistory?.(s.cp_id)}
                        title="See all submissions by this CP"
                      >
                        {s.cp_name}
                      </button>
                      <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                        {s.cp_code} · +91 {s.cp_phone}
                      </div>
                      {s.submitted_by_name && (
                        <div
                          style={{
                            marginTop: 6, padding: '4px 8px',
                            background: '#FFF3ED', color: '#A0510E',
                            border: '1px solid #FFCBA8', borderRadius: 4,
                            fontSize: 12, lineHeight: 1.3,
                          }}
                        >
                          ✏ Submitted by <strong>{s.submitted_by_name}</strong> on behalf of <strong>{s.cp_name}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="admin-panel-label">Seller</div>
                    <div className="admin-panel-val">
                      {s.seller_name || <span className="missing-flag">Not provided</span>}
                      {s.seller_phone && (
                        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                          +91 {s.seller_phone}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Assigned RM — admin and manager get the full picker; plain
                  RMs see read-only effective RM. Listing-only is the default
                  scope (per user 2026-04-30). */}
              <div className="admin-panel-section">
                <div className="admin-panel-section-title">Assigned RM</div>
                {canReassign ? (
                  <>
                    <div style={{ marginBottom: 10, padding: 10, border: '1px solid #e5e5e5', borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
                        Reassign scope
                      </div>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, cursor: 'pointer', marginBottom: 4 }}>
                        <input
                          type="radio"
                          name={`rm-mode-${s.id}`}
                          checked={rmAssignMode === 'listing'}
                          onChange={() => setRmAssignMode('listing')}
                          disabled={busy}
                        />
                        <span style={{ fontSize: 13 }}>
                          <strong>This listing only</strong>
                          {' '}<span style={{ color: '#888' }}>(default)</span>
                        </span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`rm-mode-${s.id}`}
                          checked={rmAssignMode === 'society'}
                          onChange={() => setRmAssignMode('society')}
                          disabled={busy}
                        />
                        <span style={{ fontSize: 13 }}>
                          <strong>This listing + future submissions of {s.society_name || 'this society'}</strong>{' '}
                          <span style={{ color: '#888' }}>(writes society→RM mapping)</span>
                        </span>
                      </label>
                    </div>

                    <select
                      className="status-select"
                      value={s.listing_rm_id || ''}
                      onChange={(e) =>
                        assignListingRm(e.target.value, {
                          updateSocietyMapping: rmAssignMode === 'society',
                        })
                      }
                      disabled={busy}
                    >
                      <option value="">— No override (use city fallback) —</option>
                      {rms.map((rm) => (
                        <option key={rm.id} value={rm.id}>
                          {rm.name}{rm.city ? ` · ${rm.city}` : ''}{rm.is_manager ? ' · Manager' : ''}
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                      {rmAssignMode === 'listing'
                        ? `Reassigns THIS listing only. Other submissions for ${s.society_name || 'this society'} are not touched.`
                        : `Reassigns THIS listing AND points future submissions of ${s.society_name || 'this society'} at the chosen RM (existing other submissions of this society are unchanged).`}
                    </div>
                  </>
                ) : (
                  <div className="admin-panel-val" style={{ fontWeight: 500 }}>
                    {s.listing_rm_name ? (
                      <>
                        {s.listing_rm_name}
                        <span style={{ fontSize: 11, color: '#7C3AED', marginLeft: 6 }}>
                          (listing override)
                        </span>
                      </>
                    ) : (
                      s.cp_rm_name || <span style={{ color: '#999', fontStyle: 'italic' }}>Unassigned</span>
                    )}
                  </div>
                )}
              </div>

              {/* Attachments */}
              <div className="admin-panel-section">
                <div className="admin-panel-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Attachments</span>
                  {isStaff && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handlePhotoUpload}
                      />
                      <button
                        className="btn-secondary-sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy || uploadingPct !== null}
                      >
                        {uploadingPct !== null ? `Uploading ${uploadingPct}%` : '＋ Photos'}
                      </button>
                    </>
                  )}
                </div>

                {/* Photos grid */}
                {Array.isArray(s.photos) && s.photos.length > 0 ? (
                  <div className="admin-photo-grid">
                    {s.photos.map((pid) => (
                      <div key={pid} className="admin-photo-thumb">
                        <img src={thumbnailUrl(pid, 120)} alt="" onClick={() => setLightboxId(pid)} />
                        {isStaff && (
                          <button
                            className="admin-photo-remove"
                            onClick={() => handleRemovePhoto(pid)}
                            title="Remove photo"
                          >✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: '#999' }}>No photos.</div>
                )}

                {/* Drive links */}
                {s.drive_links && (
                  <div style={{ marginTop: 12 }}>
                    <div className="admin-panel-label">Google Drive URLs</div>
                    <div className="admin-panel-val" style={{ fontSize: 12 }}>
                      {s.drive_links.split(/[,\n]/).map((url) => url.trim()).filter(Boolean).map((url, i) => (
                        <div key={i} style={{ marginTop: 2 }}>
                          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--oh-orange)' }}>
                            {url.length > 60 ? url.slice(0, 60) + '…' : url}
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Notes — user-authored comments. Input lives at the top of
                  the section (staff only); the list of existing notes scrolls
                  below it. Was previously merged into the Activity timeline. */}
              <div className="admin-panel-section">
                <div className="admin-panel-section-title">Notes ({notes.length})</div>
                {isStaff && (
                  <div className="admin-comment-input" style={{ padding: 0, background: 'transparent', borderTop: 'none', marginBottom: notes.length > 0 ? 12 : 0 }}>
                    <input
                      placeholder="Add a note…"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleAddComment();
                        }
                      }}
                      disabled={busy}
                    />
                    <button onClick={handleAddComment} disabled={busy || !newComment.trim()}>
                      {busy ? '…' : 'Send'}
                    </button>
                  </div>
                )}
                {notes.length > 0 && (
                  <div className="admin-events">
                    {notes.map((ev) => (
                      <div key={ev.id} className="admin-event">
                        <div className="admin-event-head">
                          <strong>{ev.actor_name || 'System'}</strong>
                          {ev.actor_role && ev.actor_role !== 'cp' && (
                            <span className="admin-event-role">{ev.actor_role}</span>
                          )}
                          <span className="admin-event-time">{formatDateTime(ev.created_at)}</span>
                        </div>
                        <div className="admin-event-body"><span>{ev.text}</span></div>
                      </div>
                    ))}
                    <div ref={notesEndRef} />
                  </div>
                )}
              </div>

              {/* Activity — status changes and system events (no comments). */}
              <div className="admin-panel-section">
                <div className="admin-panel-section-title">Activity ({activityEvents.length})</div>
                <div className="admin-events">
                  {activityEvents.map((ev) => (
                    <div key={ev.id} className={`admin-event ${ev.kind === 'system' ? 'is-system' : ''}`}>
                      <div className="admin-event-head">
                        <strong>{ev.actor_name || 'System'}</strong>
                        {ev.actor_role && ev.actor_role !== 'cp' && (
                          <span className="admin-event-role">{ev.actor_role}</span>
                        )}
                        <span className="admin-event-time">{formatDateTime(ev.created_at)}</span>
                      </div>
                      <div className="admin-event-body">
                        {ev.kind === 'status_change' && (
                          <span>Status: <strong>{ev.from_status || '—'}</strong> → <strong>{ev.to_status}</strong></span>
                        )}
                        {ev.kind === 'system' ? (
                          <em>{ev.text || 'Unit submitted'}</em>
                        ) : (
                          ev.kind !== 'status_change' && ev.text ? <span>{ev.text}</span> : null
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* WhatsApp thread — outbound reminders the cron fired +
                  every CP reply Interakt forwarded for this CP's phone.
                  Staff (admin/manager/RM) get a composer to reply
                  free-text inside the 24h customer-service window;
                  viewers see read-only. */}
              <div className="admin-panel-section" style={{ borderBottom: 'none' }}>
                <div className="admin-panel-section-title">WhatsApp</div>
                <WhatsAppThread submissionId={s.id} hideEmpty={false} canSend={isStaff} autoScroll={false} />
              </div>
            </>
          )}

          {/* EDIT MODE */}
          {s && editMode && (
            <div className="admin-panel-section">
              <div className="admin-panel-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Edit unit details</span>
                <small style={{ fontWeight: 400, color: '#999' }}>Society &amp; CP cannot be changed</small>
              </div>
              <div className="admin-edit-grid">
                {EDITABLE_FIELDS.map(({ key, label, type }) => (
                  <div key={key} className={type === 'textarea' ? 'admin-edit-full' : ''}>
                    <label className="admin-panel-label">{label}</label>
                    {type === 'textarea' ? (
                      <textarea
                        className="admin-edit-input"
                        rows={3}
                        value={editForm[key] ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                      />
                    ) : (
                      <input
                        className="admin-edit-input"
                        type={type}
                        value={editForm[key] ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn-primary-sm" onClick={saveEdit} disabled={busy}>
                  {busy ? 'Saving…' : '✓ Save changes'}
                </button>
                <button className="btn-secondary-sm" onClick={cancelEdit} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox for photos */}
      {lightboxId && (
        <div className="photo-lightbox" onClick={() => setLightboxId(null)}>
          <img src={previewUrl(lightboxId)} alt="" onClick={(e) => e.stopPropagation()} />
          <button className="photo-lightbox-close" onClick={() => setLightboxId(null)}>✕</button>
        </div>
      )}
    </>
  );
}

function Row({ label, value, optional = false }) {
  return (
    <div>
      <div className="admin-panel-label">{label}</div>
      <div className="admin-panel-val">
        {value || (optional ? '—' : <span className="missing-flag">Missing</span>)}
      </div>
    </div>
  );
}
// ============================================================
// Schedule Visit — pushes listing to external Forms app.
//
// Two states:
//   1. NOT yet scheduled (no forms_uid): button "Schedule Visit" → opens modal.
//      Modal collects schedule_date, schedule_time, field_exec_id (dropdown
//      from /admin/field-execs). Validates required submission fields client-side
//      AND server-side. POSTs to /admin/submissions/<id>/schedule-visit.
//
//   2. Already scheduled (forms_uid set): shows green pill with the UID,
//      schedule date/time, and field exec name. No button.
// ============================================================
function ScheduleVisitSection({ submission: s, onScheduled }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [fieldExecs, setFieldExecs] = useState([]);
  const [loadingExecs, setLoadingExecs] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [fieldExecId, setFieldExecId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [missingFields, setMissingFields] = useState([]);
  const [toast, setToast] = useState(null);  // { kind: 'success' | 'error', text }

  // Auto-dismiss toast. MUST be declared before any conditional early-return —
  // React requires hook order to be identical on every render. If we return
  // early when s.forms_uid becomes truthy after success, this useEffect would
  // be skipped and React would throw "Rendered fewer hooks than expected",
  // crashing the entire DetailPanel tree.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // Already scheduled — show the info pill instead of the button.
  if (s.forms_uid) {
    return (
      <div className="admin-panel-section">
        <div className="admin-panel-section-title">Visit Schedule</div>
        <div style={{
          padding: '12px 14px',
          background: '#ECFDF5',
          border: '1.5px solid #6EE7B7',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#047857' }}>
            ✓ Visit scheduled
          </div>
          <div style={{ fontSize: 12, color: '#065F46', fontFamily: 'monospace', fontWeight: 600 }}>
            UID: {s.forms_uid}
          </div>
          <div style={{ fontSize: 13, color: '#065F46' }}>
            {formatDateOnly(s.scheduled_date) || '—'}{s.scheduled_time ? ` at ${formatTime12(s.scheduled_time)}` : ''}
            {s.field_exec_name ? ` · ${s.field_exec_name}` : ''}
          </div>
        </div>
      </div>
    );
  }

  const openModal = async () => {
    setError('');
    setMissingFields([]);
    setDate('');
    setTime('');
    setFieldExecId('');
    setModalOpen(true);
    if (fieldExecs.length === 0) {
      setLoadingExecs(true);
      try {
        const data = await api.adminListFieldExecs();
        setFieldExecs(data?.field_execs || []);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load field execs');
      } finally {
        setLoadingExecs(false);
      }
    }
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
  };

  const handleSubmit = async () => {
    setError('');
    setMissingFields([]);
    if (!date || !time || !fieldExecId) {
      setError('Please fill in all fields.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.adminScheduleVisit(s.id, {
        schedule_date: date,
        schedule_time: time,
        field_exec_id: Number(fieldExecId),
      });
      setModalOpen(false);
      const successMsg = result.already_existed
        ? `Visit was already scheduled — UID: ${result.uid}`
        : `Visit scheduled — UID: ${result.uid}`;
      setToast({ kind: 'success', text: successMsg });
      onScheduled?.(result);
    } catch (e) {
      if (e instanceof ApiError && e.data?.missing_fields) {
        setMissingFields(e.data.missing_fields);
        setError(e.message || 'Listing is missing required fields.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Failed to schedule visit');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-dismiss toast — moved above the early return.

  return (
    <div className="admin-panel-section">
      <div className="admin-panel-section-title">Visit Schedule</div>
      <button
        type="button"
        onClick={openModal}
        style={{
          width: '100%',
          padding: '12px 16px',
          borderRadius: 10,
          border: 'none',
          background: 'linear-gradient(135deg, #FF6B2B 0%, #FF8A50 100%)',
          color: '#fff',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: '0 2px 8px rgba(255, 107, 43, 0.3)',
        }}
      >
        📅 Schedule Visit
      </button>

      {toast && (
        <div style={{
          marginTop: 10,
          padding: '10px 12px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          background: toast.kind === 'success' ? '#ECFDF5' : '#FEF2F2',
          color: toast.kind === 'success' ? '#047857' : '#991B1B',
          border: `1px solid ${toast.kind === 'success' ? '#6EE7B7' : '#FCA5A5'}`,
        }}>
          {toast.text}
        </div>
      )}

      {modalOpen && (
        <div
          onClick={closeModal}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.45)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: 20,
              maxWidth: 440,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              Schedule Visit
            </div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
              {s.public_id} · {s.society_name}
            </div>

            {error && (
              <div style={{
                padding: '10px 12px',
                background: '#FEF2F2',
                border: '1px solid #FCA5A5',
                borderRadius: 8,
                fontSize: 13,
                color: '#991B1B',
                marginBottom: 14,
              }}>
                {error}
                {missingFields.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12 }}>
                    {missingFields.map((mf, i) => (
                      <li key={i}>{mf.label || mf.field}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div className="input-label">Date <span style={{ color: '#dc2626' }}>*</span></div>
                <input
                  type="date"
                  className="input-field"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  min={todayInIST()}
                />
              </div>

              <div>
                <div className="input-label">Time <span style={{ color: '#dc2626' }}>*</span></div>
                <input
                  type="time"
                  className="input-field"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>

              <div>
                <div className="input-label">Field Exec <span style={{ color: '#dc2626' }}>*</span></div>
                {loadingExecs ? (
                  <div style={{ fontSize: 13, color: '#999', padding: '8px 0' }}>Loading…</div>
                ) : fieldExecs.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#dc2626' }}>
                    No field execs available. Add users with can_visit=true in the properties DB.
                  </div>
                ) : (
                  <select
                    className="input-field"
                    value={fieldExecId}
                    onChange={(e) => setFieldExecId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {fieldExecs.map((fe) => (
                      <option key={fe.id} value={fe.id}>
                        {fe.name}{fe.email ? ` (${fe.email})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                Assigned by: <strong>{getUser()?.name || getUser()?.phone || 'admin'}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button
                type="button"
                onClick={closeModal}
                disabled={submitting}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1.5px solid var(--oh-border, #ddd)',
                  background: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || loadingExecs || fieldExecs.length === 0}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: 'none',
                  background: submitting ? '#FFB28D' : 'linear-gradient(135deg, #FF6B2B 0%, #FF8A50 100%)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {submitting ? 'Scheduling…' : 'Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}