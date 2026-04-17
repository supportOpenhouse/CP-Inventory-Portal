import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '../../api';
import { formatDateTime, formatPrice, STAGES } from '../../format';

export default function DetailPanel({ submissionId, onClose, onChanged }) {
  const [data, setData] = useState(null); // { submission, events }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const eventsEndRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminGetSubmission(submissionId);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [data?.events?.length]);

  const handleStatusChange = async (newStatus) => {
    if (!data || busy) return;
    if (newStatus === data.submission.status) return;
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
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </>
            ) : null}
          </div>
          <button className="panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="admin-panel-body">
          {s && (
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

              {/* Unit details grid */}
              <div className="admin-panel-section">
                <div className="admin-panel-section-title">Unit details</div>
                <div className="admin-detail-grid">
                  <div>
                    <div className="admin-panel-label">BHK</div>
                    <div className="admin-panel-val">{s.bhk || '—'}</div>
                  </div>
                  <div>
                    <div className="admin-panel-label">Area</div>
                    <div className="admin-panel-val">{s.sqft ? `${s.sqft} sqft` : <span className="missing-flag">Missing</span>}</div>
                  </div>
                  <div>
                    <div className="admin-panel-label">Floor</div>
                    <div className="admin-panel-val">{s.floor || <span className="missing-flag">Missing</span>}</div>
                  </div>
                  <div>
                    <div className="admin-panel-label">Registry</div>
                    <div className="admin-panel-val">{s.registry_status || <span className="missing-flag">Missing</span>}</div>
                  </div>
                  <div>
                    <div className="admin-panel-label">Parking</div>
                    <div className="admin-panel-val">{s.parking || '—'}</div>
                  </div>
                  <div>
                    <div className="admin-panel-label">Furnishing</div>
                    <div className="admin-panel-val">{s.furnishing || '—'}</div>
                  </div>
                  <div>
                    <div className="admin-panel-label">Exit facing</div>
                    <div className="admin-panel-val">{s.exit_facing || '—'}</div>
                  </div>
                  <div>
                    <div className="admin-panel-label">Balcony view</div>
                    <div className="admin-panel-val">{s.balcony_view || '—'}</div>
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
                      {s.cp_name}
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

              {/* Events timeline */}
              <div className="admin-panel-section" style={{ borderBottom: 'none' }}>
                <div className="admin-panel-section-title">
                  Activity ({events.length})
                </div>
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
                          <span>
                            Status: <strong>{ev.from_status || '—'}</strong> → <strong>{ev.to_status}</strong>
                          </span>
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
        </div>

        {/* Comment input */}
        {s && (
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
            <button
              onClick={handleAddComment}
              disabled={busy || !newComment.trim()}
            >
              {busy ? '…' : 'Send'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}