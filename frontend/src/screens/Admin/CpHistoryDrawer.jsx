import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../api';
import { formatDateTime, formatPrice, stageMeta, STAGES } from '../../format';
import { getUser } from '../../auth';

export default function CpHistoryDrawer({ cpId, onClose, onOpenSubmission }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const user = getUser();
  const isAdmin = user?.role === 'admin';
  const isStaff = isAdmin || user?.role === 'manager' || user?.role === 'rm';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [hist, noteRes] = await Promise.all([
        api.adminGetCpHistory(cpId),
        api.adminListCpNotes(cpId).catch(() => ({ notes: [] })),
      ]);
      setData(hist);
      setNotes(noteRes.notes || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [cpId]);

  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    const text = newNote.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.adminAddCpNote(cpId, text);
      setNewNote('');
      const r = await api.adminListCpNotes(cpId);
      setNotes(r.notes || []);
    } catch (err) {
      alert(err.message || 'Failed to add note');
    } finally {
      setBusy(false);
    }
  };

  const removeNote = async (id) => {
    if (busy || !confirm('Delete this note?')) return;
    setBusy(true);
    try {
      await api.adminDeleteCpNote(id);
      setNotes(notes.filter((n) => n.id !== id));
    } catch (err) {
      alert(err.message || 'Failed to delete note');
    } finally {
      setBusy(false);
    }
  };

  const cp = data?.cp;
  const subs = data?.submissions || [];
  const summary = data?.summary || {};

  return (
    <>
      <div className="panel-overlay" onClick={onClose} />
      <div className="admin-panel admin-panel-cp">
        <div className="admin-panel-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            {loading ? (
              <div style={{ fontSize: 16, color: '#999' }}>Loading CP history…</div>
            ) : error ? (
              <div style={{ fontSize: 14, color: 'var(--oh-red)' }}>{error}</div>
            ) : cp ? (
              <>
                <div className="admin-panel-title">{cp.name}</div>
                <div className="admin-panel-sub">
                  {cp.cp_code} · +91 {cp.phone}
                  {cp.company ? ` · ${cp.company}` : ''}
                  {cp.city ? ` · ${cp.city}` : ''}
                </div>
              </>
            ) : null}
          </div>
          <button className="panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="admin-panel-body">
          {cp && (
            <>
              {/* Summary stats */}
              <div className="admin-panel-section">
                <div className="admin-panel-section-title">
                  Summary · {subs.length} submission{subs.length === 1 ? '' : 's'}
                </div>
                <div className="cp-stats-row">
                  {STAGES.map((st) => (
                    <div key={st.key} className="cp-stat">
                      <span className="cp-stat-dot" style={{ background: st.color }} />
                      <span className="cp-stat-count">{summary[st.key] || 0}</span>
                      <span className="cp-stat-label">{st.label || st.key}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submissions list */}
              <div className="admin-panel-section" style={{ borderBottom: 'none' }}>
                <div className="admin-panel-section-title">All submissions</div>
                {subs.length === 0 && (
                  <div style={{ fontSize: 13, color: '#999' }}>No submissions yet.</div>
                )}
                {subs.map((s) => {
                  const stage = stageMeta(s.status);
                  return (
                    <button
                      key={s.id}
                      className="cp-history-row"
                      onClick={() => onOpenSubmission?.(s.id)}
                      title="Open this submission"
                    >
                      <div className="cp-history-main">
                        <div className="cp-history-title">
                          {s.society_name}
                          {s.weak_match && (
                            <span style={{ color: '#DC2626', marginLeft: 6 }} title="Weak match">⚠</span>
                          )}
                        </div>
                        {s.public_id && (
                          <div
                            style={{
                              fontSize: 11,
                              color: '#888',
                              fontFamily: 'monospace',
                              fontWeight: 600,
                              letterSpacing: '0.3px',
                              marginTop: 1,
                            }}
                          >
                            {s.public_id}
                          </div>
                        )}
                        <div className="cp-history-meta">
                          {[
                            s.bhk,
                            s.sqft ? `${s.sqft} sqft` : null,
                            s.tower && s.unit_no ? `${s.tower}-${s.unit_no}` : s.unit_no,
                            s.floor ? `Fl ${s.floor}` : null,
                            s.city,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="cp-history-right">
                        <span
                          className="status-pill"
                          style={{ background: stage.bg, color: stage.color }}
                        >
                          {s.status}
                        </span>
                        <div className="cp-history-price">{formatPrice(s.asking_price)}</div>
                        <div className="cp-history-time">{formatDateTime(s.submitted_at)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Notes thread */}
              <div className="admin-panel-section" style={{ borderBottom: 'none' }}>
                <div className="admin-panel-section-title">
                  Notes on this CP ({notes.length})
                </div>
                {notes.length === 0 && (
                  <div style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>
                    No notes yet{isStaff ? ' — add one below.' : '.'}
                  </div>
                )}
                {notes.map((n) => (
                  <div key={n.id} className="cp-note">
                    <div className="cp-note-head">
                      <strong>{n.actor_name}</strong>
                      {n.actor_role && n.actor_role !== 'cp' && (
                        <span className="admin-event-role">{n.actor_role}</span>
                      )}
                      <span className="admin-event-time">{formatDateTime(n.created_at)}</span>
                      {isStaff && (
                        <button
                          className="cp-note-delete"
                          onClick={() => removeNote(n.id)}
                          title="Delete note"
                        >✕</button>
                      )}
                    </div>
                    <div className="cp-note-body">{n.text}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Admin-only: add a note */}
        {isStaff && cp && (
          <div className="admin-comment-input">
            <input
              placeholder="Add a note about this CP…"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  addNote();
                }
              }}
              disabled={busy}
            />
            <button onClick={addNote} disabled={busy || !newNote.trim()}>
              {busy ? '…' : 'Save note'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}