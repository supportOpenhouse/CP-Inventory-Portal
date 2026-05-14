import { useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../../api';
import { formatDateTime, timeAgo } from '../../format';
import WhatsAppThread from './WhatsAppThread';

/**
 * Two-pane WhatsApp inbox: phone-grouped thread list on the left,
 * full conversation on the right when a row is selected.
 *
 * Read-only — sending replies from the app needs Interakt's session
 * messaging API + opt-in handling, which isn't built yet.
 */
export default function WhatsAppInbox({ onClose }) {
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
          <span className="admin-topbar-sub">WhatsApp Inbox</span>
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
            state.threads.map((t) => (
              <div
                key={t.phone}
                className={`wa-inbox-row ${selectedPhone === t.phone ? 'active' : ''}`}
                onClick={() => setSelectedPhone(t.phone)}
              >
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
                    <span style={{ color: '#16A34A', fontWeight: 700 }}>
                      · {t.inbound_count} {t.inbound_count === 1 ? 'reply' : 'replies'}
                    </span>
                  )}
                </div>
              </div>
            ))
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
              <WhatsAppThread phone={activeThread.phone} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
