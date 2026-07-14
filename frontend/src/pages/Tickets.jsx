/**
 * Tickets workspace — staff only (admin/manager/rm; see App.jsx's route
 * guard). Three tabs: tickets needing this user's action (default), all
 * open, all closed.
 *
 * Ported from Direct's `pages/Tickets.jsx` pattern, adapted to this app's
 * ticket shape (submission_id/public_id/society_name instead of Direct's
 * oh_id) and its plain fetch-based api client — unlike Direct's `api.get`,
 * this app's `request()` has no client-side response cache, so we don't
 * prefetch the other two tabs in the background (it would just double real
 * network traffic for no benefit).
 *
 * Clicking a card sets `openId`, which mounts <TicketModal> (thread, reply,
 * close/reopen) — it fetches the full ticket itself and patches this page's
 * list in place via `onChanged`.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { formatDateTime, timeAgo } from '../format';
import { ticketBadge } from '../components/tickets/ticketStatus.js';
import TicketModal from '../components/tickets/TicketModal.jsx';
import SegToggle from '../components/SegToggle.jsx';
import { IconTicket } from '../components/icons.jsx';

const TABS = [
  { key: 'action', label: 'Needs my action' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
];

const PAGE_SIZE = 50;

// scope=action for the default tab; status=open/closed for the other two.
function filtersForTab(key, offset = 0) {
  const filters = key === 'action' ? { scope: 'action' } : { status: key };
  filters.limit = PAGE_SIZE;
  if (offset) filters.offset = offset;
  return filters;
}

export default function Tickets() {
  const [tab, setTab] = useState('action');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  // Reloads whichever tab is currently active — the initial load, the
  // tab-switch reload, the tickets:changed/:updated listeners below, and
  // TicketModal's onChanged (a reply/close/reopen on the open ticket) all
  // funnel through this one function.
  const reloadCurrentTab = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.ticketsList(filtersForTab(tab));
      setItems(r.items || []);
      setTotal(r.total || 0);
    } catch (e) {
      setError(e.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { reloadCurrentTab(); }, [reloadCurrentTab]);

  // Refetch when a ticket is created/replied/closed anywhere: locally
  // ('tickets:changed', e.g. a "New ticket" action elsewhere) or by another
  // user ('tickets:updated', broadcast by Layout's pending-count poll).
  useEffect(() => {
    const onChanged = () => reloadCurrentTab();
    window.addEventListener('tickets:changed', onChanged);
    window.addEventListener('tickets:updated', onChanged);
    return () => {
      window.removeEventListener('tickets:changed', onChanged);
      window.removeEventListener('tickets:updated', onChanged);
    };
  }, [reloadCurrentTab]);

  // "Load more" appends the next page (dedupe by id — replies/closes can
  // shift server offsets between pages).
  async function loadMore() {
    setLoadingMore(true);
    try {
      const r = await api.ticketsList(filtersForTab(tab, items.length));
      setItems((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...(r.items || []).filter((t) => !seen.has(t.id))];
      });
      setTotal(r.total || 0);
    } catch (e) {
      setError(e.message || 'Failed to load more tickets');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h2>Tickets</h2>
      </div>

      <div className="toolbar">
        <SegToggle
          options={TABS.map((t) => ({ value: t.key, label: t.label }))}
          value={tab}
          onChange={setTab}
        />
        <div className="muted" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600 }}>
          {total} ticket{total === 1 ? '' : 's'}
        </div>
      </div>

      {error && <div className="modal-error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div className="tk-list">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="tk-card card-block tk-card-skel" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <IconTicket size={28} />
          <p>{tab === 'action' ? 'Nothing needs your action right now.' : `No ${tab} tickets.`}</p>
        </div>
      ) : (
        <>
          <div className="tk-list">
            {items.map((t) => {
              const badge = ticketBadge(t);
              return (
                <div
                  key={t.id}
                  className="tk-card card-block"
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenId(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(t.id); }
                  }}
                >
                  <div className="tk-card-top">
                    <span className="tk-card-title">{t.title}</span>
                    <span className={`tk-badge ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <div className="tk-card-prop">
                    {t.submission_id
                      ? `${t.society_name || '—'} · ${t.public_id || '—'}${t.assigned_rm_name ? ` · RM ${t.assigned_rm_name}` : ''}`
                      : `Direct ticket${t.assigned_rm_name ? ` · RM ${t.assigned_rm_name}` : ''}`}
                  </div>
                  {t.summary && <div className="tk-card-summary">{t.summary}</div>}
                  <div className="tk-card-foot">
                    <span>{t.message_count ?? 0} repl{(t.message_count ?? 0) === 1 ? 'y' : 'ies'}</span>
                    <span title={formatDateTime(t.last_activity_at)}>{timeAgo(t.last_activity_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {items.length < total && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <button type="button" className="btn-ghost" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Load more (${items.length} of ${total})`}
              </button>
            </div>
          )}
        </>
      )}

      <TicketModal id={openId} onClose={() => setOpenId(null)} onChanged={reloadCurrentTab} />
    </div>
  );
}
