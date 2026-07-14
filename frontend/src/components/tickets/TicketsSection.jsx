/**
 * Inline Tickets section on a submission's expand panel (P5 Task 4) — the
 * last of the 10+ sections `SubmissionSections` composes. Lazy-loads this
 * submission's tickets on mount, shows the latest few with a "+N more"
 * toggle, and — admin/manager only — a collapsible inline create form.
 *
 * Row click opens the same `TicketModal` the Tickets workspace page (Task 1)
 * uses for the thread/reply/close/reopen flow; this section owns its own
 * `openId` and patches the clicked row in place via the modal's `onChanged`,
 * same pattern as `pages/Tickets.jsx`. `ticketBadge` (Task 1) renders the
 * status pill.
 *
 * `canCreate` is a client-side hint only (admin/manager) — the backend
 * re-checks on POST /tickets and any 403 surfaces via `createError`.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { timeAgo } from '../../format';
import { ticketBadge } from './ticketStatus.js';
import TicketModal from './TicketModal.jsx';

const VISIBLE = 3;

export default function TicketsSection({ submissionId, publicId, canCreate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Refetch (and reset all local UI state) whenever a different submission
  // is shown — CardDetailModal reuses one mounted instance across cards, so
  // `submissionId` can change without this component remounting.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setExpanded(false);
    setOpenId(null);
    setShowCreate(false);
    setTitle('');
    setSummary('');
    setCreateError('');
    api.ticketsList({ submission_id: submissionId })
      .then((r) => { if (alive) setItems(r.items || []); })
      .catch((e) => { if (alive) setError(e?.data?.error || e.message || 'Failed to load tickets'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [submissionId]);

  function cancelCreate() {
    setShowCreate(false);
    setTitle('');
    setSummary('');
    setCreateError('');
  }

  async function handleCreate() {
    const t = title.trim();
    if (!t || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const created = await api.ticketCreate({ submission_id: submissionId, title: t, summary: summary.trim() });
      setItems((prev) => [created, ...prev]);
      cancelCreate();
      window.dispatchEvent(new Event('tickets:changed'));
    } catch (e) {
      setCreateError(e?.data?.error || e.message || 'Failed to create ticket');
    } finally {
      setCreating(false);
    }
  }

  const visible = expanded ? items : items.slice(0, VISIBLE);
  const hiddenCount = items.length - visible.length;

  return (
    <>
      <div className="card-block">
      <div className="card-head">
        <h3>Tickets</h3>
        {canCreate && !showCreate && (
          <button type="button" className="btn-soft" onClick={() => setShowCreate(true)}>+ New Ticket</button>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="inv-skel" style={{ width: '80%' }} />
          <div className="inv-skel" style={{ width: '55%' }} />
        </div>
      ) : error ? (
        <div className="modal-error">{error}</div>
      ) : items.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>No tickets yet{publicId ? ` for ${publicId}` : ''}.</div>
      ) : (
        <>
          <ul className="tk-mini-list">
            {visible.map((t) => {
              const badge = ticketBadge(t);
              return (
                <li key={t.id}>
                  <button type="button" className="tk-mini" onClick={() => setOpenId(t.id)}>
                    <div className="tk-mini-top">
                      <span className="tk-mini-title">{t.title}</span>
                      <span className={`tk-badge ${badge.cls}`}>{badge.label}</span>
                    </div>
                    <div className="tk-mini-meta">{timeAgo(t.last_activity_at)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
          {items.length > VISIBLE && (
            <button type="button" className="btn-link tk-more" onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Show less' : `+${hiddenCount} more`}
            </button>
          )}
        </>
      )}

      {canCreate && showCreate && (
          <div className="tk-create" style={{ marginTop: 12 }}>
            <input
              className="tk-create-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ticket title"
              autoFocus
              disabled={creating}
            />
            <textarea
              className="tk-create-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Details (optional)"
              rows={2}
              disabled={creating}
            />
            {createError && <div className="modal-error">{createError}</div>}
            <div className="tk-create-actions">
              <button type="button" className="btn-ghost" onClick={cancelCreate} disabled={creating}>Cancel</button>
              <button type="button" className="btn-primary" onClick={handleCreate} disabled={creating || !title.trim()}>
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
      )}
      </div>

      <TicketModal
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={(updated) => setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
      />
    </>
  );
}
