import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '../../api';
import { formatDateTime, formatPrice, STAGES } from '../../format';
import { getUser } from '../../auth';

// Fields the admin can edit (mirrors EDITABLE_FIELDS in backend/routes/admin.py)
const EDITABLE_FIELDS = [
  { key: 'tower',               label: 'Tower',            type: 'text'   },
  { key: 'unit_no',              label: 'Unit No',          type: 'text'   },
  { key: 'floor',                label: 'Floor',            type: 'text'   },
  { key: 'sqft',                 label: 'Area (sqft)',      type: 'number' },
  { key: 'bhk',                  label: 'BHK',              type: 'text'   },
  { key: 'furnishing',           label: 'Furnishing',       type: 'text'   },
  { key: 'exit_facing',          label: 'Exit facing',      type: 'text'   },
  { key: 'balcony_facing',       label: 'Balcony facing',   type: 'text'   },
  { key: 'balcony_view',         label: 'Balcony view',     type: 'text'   },
  { key: 'parking',              label: 'Parking',          type: 'text'   },
  { key: 'registry_status',      label: 'Registry',         type: 'text'   },
  { key: 'asking_price',         label: 'Asking price (₹)', type: 'number' },
  { key: 'closing_price',        label: 'Closing price (₹)', type: 'number' },
  { key: 'seller_name',          label: 'Seller name',      type: 'text'   },
  { key: 'seller_phone',         label: 'Seller phone',     type: 'text'   },
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
  const eventsEndRef = useRef(null);

  const user = getUser();
  const isAdmin = user?.role === 'admin';

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

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [data?.events?.length]);

  const handleStatusChange = async (newStatus) => {
    if (!data || busy || newStatus === data.submission.status) return;
    setBusy(true);
    try {
      await api.adminChangeStatus(submissionId, newStatus);
      await load();
      onChanged?.();
    } catch (err) {
      alert(err.message || 'Failed to change status');
    } finally {
      setBusy(false);
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

  const handleDelete = async () => {
    if (busy) return;
    if (!confirm('Archive this submission? It will be hidden from lists but kept in DB.')) return;
    setBusy(true);
    try {
      await api.adminDeleteSubmission(submissionId);
      onChanged?.();
      onClose?.();
    } catch (err) {
      alert(err.message || 'Failed to archive');
    } finally {
      setBusy(false);
    }
  };

  const s = data?.submission;
  const events = data?.events || [];

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
                <div className="admin-panel-sub">
                  {[s.city, s.tower && s.unit_no ? `${s.tower}-${s.unit_no}` : null, s.floor && `Floor ${s.floor}`]
                    .filter(Boolean).join(' · ')}
                </div>
              </>
            ) : null}
          </div>
          <button className="panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Admin action bar */}
        {s && isAdmin && !editMode && (
          <div className="admin-panel-actions">
            <button className="btn-secondary-sm" onClick={startEdit} disabled={busy}>✏ Edit</button>
            <button className="btn-danger-sm" onClick={handleDelete} disabled={busy}>🗑 Archive</button>
          </div>
        )}

        <div className="admin-panel-body">
          {s && !editMode && (
            <>
              {/* Status selector */}
              <div className="admin-panel-section">
                <div className="admin-panel-label">Status</div>
                <select
                  className="status-select"
                  value={s.status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  disabled={busy}
                >
                  {STAGES.map((st) => (
                    <option key={st.key} value={st.key}>{st.key}</option>
                  ))}
                </select>
              </div>

              {/* Unit details */}
              <div className="admin-panel-section">
                <div className="admin-panel-section-title">Unit details</div>
                <div className="admin-detail-grid">
                  <Row label="BHK" value={s.bhk} />
                  <Row label="Area" value={s.sqft ? `${s.sqft} sqft` : null} />
                  <Row label="Floor" value={s.floor} />
                  <Row label="Registry" value={s.registry_status} />
                  <Row label="Parking" value={s.parking} optional />
                  <Row label="Furnishing" value={s.furnishing} optional />
                  <Row label="Exit facing" value={s.exit_facing} optional />
                  <Row label="Balcony view" value={s.balcony_view} optional />
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div className="admin-panel-label">Extra rooms</div>
                    <div className="admin-panel-val">
                      {Array.isArray(s.extra_rooms) && s.extra_rooms.length > 0
                        ? s.extra_rooms.join(', ')
                        : '—'}
                    </div>
                  </div>
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
                  <div>
                    <div className="admin-panel-label">Closing</div>
                    <div className="admin-panel-val">{formatPrice(s.closing_price)}</div>
                  </div>
                  {s.asking_price && s.sqft ? (
                    <div>
                      <div className="admin-panel-label">Rate / sqft</div>
                      <div className="admin-panel-val">₹{Math.round(s.asking_price / s.sqft).toLocaleString('en-IN')}</div>
                    </div>
                  ) : null}
                </div>
              </div>

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

              {/* Events */}
              <div className="admin-panel-section" style={{ borderBottom: 'none' }}>
                <div className="admin-panel-section-title">Activity ({events.length})</div>
                <div className="admin-events">
                  {events.map((ev) => (
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
                        {ev.kind === 'comment' && <span>{ev.text}</span>}
                        {ev.kind === 'system' && <em>{ev.text || 'Unit submitted'}</em>}
                      </div>
                    </div>
                  ))}
                  <div ref={eventsEndRef} />
                </div>
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

        {/* Comment input */}
        {s && !editMode && (
          <div className="admin-comment-input">
            <input
              placeholder="Add a comment…"
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
      </div>
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