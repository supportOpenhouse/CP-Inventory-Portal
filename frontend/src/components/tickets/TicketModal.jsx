/**
 * Full ticket detail: header (title + status badge), the property/RM
 * sub-line, the summary block, the message thread, a reply box, and
 * close/reopen. The Tickets list only carries `message_count` (not the
 * `messages` thread), so this fetches its own copy via `ticketGet(id)` on
 * mount — a skeleton renders until that lands.
 *
 * Ported from Direct_Inventory's `components/TicketModal.jsx`, adapted to
 * this app's split cp/rm staff identity (a ticket's creator/assignee is a
 * (source, id) pair, not a single users.id) and its submission-linked ticket
 * shape (`society_name`/`public_id` instead of Direct's `oh_id`).
 */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { formatDateTime, timeAgo } from '../../format';
import { ticketBadge } from './ticketStatus.js';
import { IconClose } from '../icons.jsx';

function initialsOf(name) {
  const s = (name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

// Deterministic HSL avatar color from a stable per-author key. Phone is
// preferred over name (passed as `author_phone || author_name`) so two
// staff sharing a name don't collide on the same color.
function avatarStyle(key) {
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return { background: `hsl(${hue}, 60%, 88%)`, color: `hsl(${hue}, 55%, 30%)` };
}

export default function TicketModal({ id, onChanged, onClose }) {
  const { user: me } = useAuth();
  const [t, setT] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Refetch the full ticket every time a different id opens.
  useEffect(() => {
    if (id == null) return undefined;
    let alive = true;
    setT(null);
    setLoadError('');
    setError('');
    setDraft('');
    api.ticketGet(id)
      .then((r) => { if (alive) setT(r); })
      .catch((e) => { if (alive) setLoadError(e?.data?.error || e.message || 'Failed to load ticket'); });
    return () => { alive = false; };
  }, [id]);

  // Esc closes, same as the other detail modals in this app (CardDetailModal).
  useEffect(() => {
    if (id == null) return undefined;
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, onClose]);

  if (id == null) return null;

  // Applies a mutation response everywhere it needs to land: this modal's own
  // state, the host page's list (onChanged patches in place), and any other
  // open tab/widget watching for ticket activity (pending-count dot, etc.).
  function apply(updated) {
    setT(updated);
    onChanged?.(updated);
    window.dispatchEvent(new Event('tickets:changed'));
  }

  async function send() {
    const body = draft.trim();
    if (!body || busy || !t) return;
    setError('');
    setBusy(true);
    try {
      const updated = await api.ticketReply(t.id, body);
      apply(updated);
      setDraft('');
    } catch (e) {
      setError(e?.data?.error || e.message || 'Failed to send reply');
    } finally {
      setBusy(false);
    }
  }

  async function doClose() {
    if (!t || busy) return;
    setError('');
    setBusy(true);
    try {
      apply(await api.ticketClose(t.id));
    } catch (e) {
      setError(e?.data?.error || e.message || 'Failed to close ticket');
    } finally {
      setBusy(false);
    }
  }

  async function doReopen() {
    if (!t || busy) return;
    setError('');
    setBusy(true);
    try {
      apply(await api.ticketReopen(t.id));
    } catch (e) {
      setError(e?.data?.error || e.message || 'Failed to reopen ticket');
    } finally {
      setBusy(false);
    }
  }

  // Permissions are a client-side hint only — the server re-checks every
  // mutation and this surfaces its 403/409 via `error` if the hint was stale.
  const myKey = me ? (me.role === 'admin' ? ['cp', me.cp_id] : ['rm', me.rm_id]) : [null, null];
  const isCreator = !!t && t.created_by_source === myKey[0] && t.created_by_id === myKey[1];
  const isAssignedRm = !!t && me?.role === 'rm' && me.rm_id === t.assigned_rm_id;
  const isOpen = !!t && t.status === 'open';
  const canReply = isOpen && (me?.role === 'admin' || isCreator || isAssignedRm);
  const canClose = !!t && (me?.role === 'admin' || isCreator);
  const messages = t
    ? [...(t.messages || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    : [];
  const badge = t ? ticketBadge(t) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head-row">
          <h3 style={{ marginBottom: 0 }}>
            {t ? t.title : <span className="inv-skel" style={{ display: 'inline-block', width: 160 }} />}
          </h3>
          {badge && <span className={`tk-badge ${badge.cls}`}>{badge.label}</span>}
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>

        {loadError ? (
          <div className="modal-error">{loadError}</div>
        ) : !t ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="inv-skel" style={{ width: '60%' }} />
            <div className="inv-skel" style={{ width: '90%' }} />
            <div className="inv-skel" style={{ width: '75%' }} />
          </div>
        ) : (
          <>
            <p className="modal-sub">
              {t.submission_id ? <>{t.society_name || '—'} · {t.public_id || '—'}</> : 'Direct ticket'}
              {t.assigned_rm_name && <> · RM: {t.assigned_rm_name}</>}
            </p>

            {t.summary && <div className="tk-summary">{t.summary}</div>}

            <div className="tk-thread">
              <div className="tk-thread-head">
                <strong>Conversation</strong>
                <span className="note-thread-count">{messages.length}</span>
              </div>
              <div className="note-list">
                {messages.length === 0 && <div className="note-empty">No replies yet.</div>}
                {messages.map((m) => (
                  <div key={m.id} className="note-item">
                    <span className="note-av" style={avatarStyle(m.author_phone || m.author_name)}>
                      {initialsOf(m.author_name)}
                    </span>
                    <div className="note-body">
                      <div className="note-meta">
                        <strong>{m.author_name || '—'}</strong>
                        {m.author_role && <span className="role-chip">{m.author_role}</span>}
                        <span className="note-time" title={formatDateTime(m.created_at)}>{timeAgo(m.created_at)}</span>
                      </div>
                      <div className="note-text">{m.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error && <div className="modal-error">{error}</div>}

            {canReply && (
              <div className="note-input-row tk-reply">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Write a reply…"
                  disabled={busy}
                />
                <button type="button" className="btn-primary" onClick={send} disabled={busy || !draft.trim()}>Reply</button>
              </div>
            )}
            {!isOpen && <div className="tk-closed-note muted">This ticket is closed.</div>}

            <div className="modal-actions">
              <span style={{ flex: 1 }} />
              {isOpen && canClose && <button type="button" className="btn-soft" onClick={doClose} disabled={busy}>Close ticket</button>}
              {!isOpen && canClose && <button type="button" className="btn-soft" onClick={doReopen} disabled={busy}>Reopen</button>}
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
