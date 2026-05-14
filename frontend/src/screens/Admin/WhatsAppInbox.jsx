import { useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../../api';
import { getUser } from '../../auth';
import { formatDateTime, timeAgo } from '../../format';
import WhatsAppThread from './WhatsAppThread';

// Reusable WhatsApp logo (real one, used in headers + topbar). Color
// inherits from currentColor so we can recolor per surface.
function WaIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01a1.095 1.095 0 0 0-.795.372c-.272.296-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
    </svg>
  );
}

export { WaIcon };

/**
 * Two-pane WhatsApp inbox: phone-grouped thread list on the left,
 * full conversation on the right when a row is selected.
 *
 * Read-only — sending replies from the app needs Interakt's session
 * messaging API + opt-in handling, which isn't built yet.
 */
export default function WhatsAppInbox({ onClose }) {
  const user = getUser();
  const isStaff = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'rm';
  const [state, setState] = useState({ loading: true, threads: [], error: null });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedPhone, setSelectedPhone] = useState(null);

  useEffect(() => {
    let alive = true;
    setState((st) => ({ ...st, loading: true }));
    api.adminListWhatsAppThreads(search ? { search } : {})
      .then((data) => {
        if (!alive) return;
        setState({ loading: false, threads: data.threads || [], error: null });
      })
      .catch((err) => {
        if (!alive) return;
        setState({
          loading: false, threads: [],
          error: err instanceof ApiError ? err.message : 'Failed to load inbox',
        });
      });
    return () => { alive = false; };
  }, [search]);

  // Auto-select the first row if nothing's selected (better empty-pane UX).
  const activeThread = useMemo(
    () => state.threads.find((t) => t.phone === selectedPhone) || null,
    [state.threads, selectedPhone],
  );

  return (
    <div className="admin-root">
      <div className="admin-topbar">
        <div className="admin-topbar-left">
          <button className="back-btn" onClick={onClose} title="Back to Board">←</button>
          <span className="wa-topbar-title">
            <span className="wa-topbar-icon"><WaIcon size={20} /></span>
            WhatsApp Inbox
          </span>
        </div>
      </div>

      <div className="wa-inbox-wrap">
        <div className="wa-inbox-list">
          <div className="wa-inbox-search">
            <form
              onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); }}
              role="search"
            >
              <input
                type="search"
                placeholder="Search by phone or CP name…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                enterKeyHint="search"
              />
            </form>
          </div>

          {state.loading ? (
            <div className="wa-inbox-list-empty">Loading…</div>
          ) : state.error ? (
            <div className="wa-inbox-list-empty" style={{ color: '#B91C1C' }}>{state.error}</div>
          ) : state.threads.length === 0 ? (
            <div className="wa-inbox-list-empty">
              No WhatsApp threads yet.
              <br />
              They appear here once we send a reminder or a CP replies.
            </div>
          ) : (
            state.threads.map((t) => {
              const initials = (t.cp_name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
              return (
                <div
                  key={t.phone}
                  className={`wa-inbox-row ${selectedPhone === t.phone ? 'active' : ''}`}
                  onClick={() => setSelectedPhone(t.phone)}
                >
                  <div className="wa-inbox-row-avatar">{initials}</div>
                  <div className="wa-inbox-row-body">
                    <div className="wa-inbox-row-name">
                      <span>{t.cp_name || '(unknown CP)'}</span>
                      <span className="wa-inbox-row-time">{timeAgo(t.last_msg_at)}</span>
                    </div>
                    <div className="wa-inbox-row-preview">
                      {t.last_direction === 'outbound' ? '↗ ' : '↙ '}
                      {t.last_body || '(empty)'}
                    </div>
                    <div className="wa-inbox-row-meta">
                      <span>+91 {t.phone}</span>
                      {t.cp_code && <span>· {t.cp_code}</span>}
                      {t.inbound_count > 0 && (
                        <span className="wa-inbox-row-replies">
                          · {t.inbound_count} {t.inbound_count === 1 ? 'reply' : 'replies'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="wa-inbox-detail">
          {!activeThread ? (
            <div className="wa-inbox-detail-empty">
              {state.threads.length > 0
                ? 'Select a thread on the left to view the conversation.'
                : ''}
            </div>
          ) : (
            <>
              <div className="wa-inbox-detail-head">
                <div className="wa-inbox-detail-avatar">
                  {(activeThread.cp_name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div>
                  <div className="wa-inbox-detail-name">
                    {activeThread.cp_name || '(unknown CP)'}
                  </div>
                  <div className="wa-inbox-detail-sub">
                    +91 {activeThread.phone}
                    {activeThread.cp_code && <> · {activeThread.cp_code}</>}
                    {activeThread.cp_company && <> · {activeThread.cp_company}</>}
                    {activeThread.last_msg_at && (
                      <> · last message {formatDateTime(activeThread.last_msg_at)}</>
                    )}
                  </div>
                </div>
              </div>
              <WhatsAppThread phone={activeThread.phone} canSend={isStaff} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
