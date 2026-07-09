import { useEffect, useState } from 'react';

import { ApiError, api } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

/**
 * Admin-only chat user management modal. Two sections:
 *   - Requests: CPs who tapped "Request admin to start chat" on the gate
 *     (see CpChat.jsx). Enabling a request also resolves it server-side.
 *   - Manage CPs: search any CP and toggle their chat access directly.
 *
 * Backend:
 *   GET  /comet/requests            -> { requests: [{cp_id, name, phone, city, requested_at}] }
 *   GET  /comet/access?cp_ids=...   -> { enabled: [cpId] }
 *   POST /comet/enable  { cp_id }   -> { ok, uid }
 *   POST /comet/disable { cp_id }   -> { ok }
 *
 * Props:
 *   onClose: () => void
 */
export default function ChatUserManager({ onClose, onStartChat }) {
  // ── Requests ──────────────────────────────────────────────────────
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState('');
  const [enablingCpId, setEnablingCpId] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setRequestsLoading(true);
      setRequestsError('');
      try {
        const data = await api.cometListRequests();
        if (alive) setRequests(data?.requests || []);
      } catch (e) {
        if (alive) setRequestsError(e instanceof ApiError ? e.message : 'Failed to load requests');
      } finally {
        if (alive) setRequestsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const enableFromRequest = async (cpId) => {
    setEnablingCpId(cpId);
    try {
      await api.cometEnableCp(cpId);
      setRequests((prev) => prev.filter((r) => r.cp_id !== cpId));
      // Keep the "Manage CPs" search results in sync if this CP is visible there.
      setEnabledMap((prev) => ({ ...prev, [cpId]: true }));
      onStartChat?.(cpId);  // open the CP's thread in the inbox (closes this modal)
    } catch (e) {
      setRequestsError(e instanceof ApiError ? e.message : 'Enable failed');
    } finally {
      setEnablingCpId(null);
    }
  };

  // ── Manage CPs (search + toggle) ─────────────────────────────────
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [enabledMap, setEnabledMap] = useState({}); // { [cpId]: bool }
  const [togglingCpId, setTogglingCpId] = useState(null);
  const debouncedQ = useDebouncedValue(q, 300);

  useEffect(() => {
    let alive = true;
    const trimmed = (debouncedQ || '').trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearchError('');
      return;
    }
    setSearching(true);
    setSearchError('');
    (async () => {
      try {
        const data = await api.adminCpSearch(trimmed, 20, '');
        const list = data?.results || [];
        if (!alive) return;
        setResults(list);
        if (list.length > 0) {
          try {
            const accessData = await api.cometAccessStatus(list.map((r) => r.id));
            if (!alive) return;
            const enabledIds = new Set(accessData?.enabled || []);
            const next = {};
            list.forEach((cp) => { next[cp.id] = enabledIds.has(cp.id); });
            setEnabledMap((prev) => ({ ...prev, ...next }));
          } catch {
            // Non-fatal — buttons just won't show a definitive state.
          }
        }
      } catch (e) {
        if (alive) {
          setSearchError(e instanceof ApiError ? e.message : 'CP search failed');
          setResults([]);
        }
      } finally {
        if (alive) setSearching(false);
      }
    })();
    return () => { alive = false; };
  }, [debouncedQ]);

  const toggleAccess = async (cp, enable) => {
    setTogglingCpId(cp.id);
    try {
      if (enable) await api.cometEnableCp(cp.id);
      else await api.cometDisableCp(cp.id);
      setEnabledMap((prev) => ({ ...prev, [cp.id]: enable }));
      if (enable) setRequests((prev) => prev.filter((r) => r.cp_id !== cp.id));
    } catch (e) {
      setSearchError(e instanceof ApiError ? e.message : 'Update failed');
    } finally {
      setTogglingCpId(null);
    }
  };

  // ── styles (inline, matching BroadcastModal) ─────────────────────
  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  };
  const modal = {
    background: '#fff', borderRadius: 8, width: '100%', maxWidth: 640,
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  };
  const header = {
    padding: '18px 24px', borderBottom: '1px solid #eee',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  };
  const body = { padding: 24, overflow: 'auto', flex: 1 };
  const footer = {
    padding: '14px 24px', borderTop: '1px solid #eee',
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
  };
  const sectionTitle = { fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8, display: 'block', fontWeight: 600 };
  const inputStyle = {
    padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14,
    width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const listStyle = {
    marginTop: 8, padding: 0, listStyle: 'none',
    border: '1px solid #e5e5e5', borderRadius: 6, overflow: 'hidden',
  };
  const rowStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '10px 12px', borderBottom: '1px solid #f0f0f0', background: '#fff',
  };
  const btnBase = {
    padding: '6px 12px', borderRadius: 4, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', border: 0, whiteSpace: 'nowrap',
  };
  const enableBtn = { ...btnBase, background: '#FF6B2B', color: '#fff' };
  const disableBtn = { ...btnBase, background: '#f3f4f6', color: '#991b1b', border: '1px solid #e5e5e5' };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        <div style={header}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Manage chat users</div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 0, fontSize: 22, cursor: 'pointer', color: '#666' }}
            aria-label="Close"
          >×</button>
        </div>

        <div style={body}>
          {/* ── Requests ── */}
          <div style={{ marginBottom: 24 }}>
            <label style={sectionTitle}>Pending requests</label>
            {requestsError && (
              <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 4, marginBottom: 10, fontSize: 13 }}>
                {requestsError}
              </div>
            )}
            {requestsLoading ? (
              <div style={{ fontSize: 13, color: '#888' }}>Loading…</div>
            ) : requests.length === 0 ? (
              <div style={{ fontSize: 13, color: '#888' }}>No pending requests.</div>
            ) : (
              <ul style={listStyle}>
                {requests.map((r) => (
                  <li key={r.cp_id} style={rowStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{r.name || `CP #${r.cp_id}`}</div>
                      <div style={{ fontSize: 12, color: '#444', marginTop: 2, fontFamily: 'monospace' }}>
                        {r.phone || '—'}
                        {r.city ? <span style={{ fontFamily: 'inherit' }}> · {r.city}</span> : null}
                        {r.requested_at ? <span style={{ fontFamily: 'inherit' }}> · requested {new Date(r.requested_at).toLocaleString()}</span> : null}
                      </div>
                    </div>
                    <button
                      style={enableBtn}
                      disabled={enablingCpId === r.cp_id}
                      onClick={() => enableFromRequest(r.cp_id)}
                    >
                      {enablingCpId === r.cp_id ? 'Enabling…' : 'Enable & start chat'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Manage CPs ── */}
          <div>
            <label style={sectionTitle}>Manage CPs</label>
            <input
              type="search"
              placeholder="Search CPs by name or phone (min 2 chars)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={inputStyle}
            />
            {searching && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>searching…</div>}
            {searchError && (
              <div style={{ marginTop: 8, padding: 8, background: '#fee2e2', color: '#991b1b', borderRadius: 4, fontSize: 13 }}>
                {searchError}
              </div>
            )}
            {results.length > 0 && (
              <ul style={listStyle}>
                {results.map((cp) => {
                  const enabled = !!enabledMap[cp.id];
                  const busy = togglingCpId === cp.id;
                  return (
                    <li key={cp.id} style={rowStyle}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          {cp.name || '(no name)'}
                          {cp.cp_code ? <span style={{ fontWeight: 400, color: '#888', fontSize: 12 }}> · {cp.cp_code}</span> : null}
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: enabled ? '#166534' : '#991b1b' }}>
                            {enabled ? 'ENABLED' : 'DISABLED'}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: '#444', marginTop: 2, fontFamily: 'monospace' }}>
                          {cp.phone || '—'}
                          {cp.city ? <span style={{ fontFamily: 'inherit' }}> · {cp.city}</span> : null}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {enabled && (
                          <button
                            style={{ ...btnBase, background: '#FF6B2B', color: '#fff' }}
                            onClick={() => onStartChat?.(cp.id)}
                          >
                            Message
                          </button>
                        )}
                        <button
                          style={enabled ? disableBtn : enableBtn}
                          disabled={busy}
                          onClick={() => toggleAccess(cp, !enabled)}
                        >
                          {busy ? '…' : (enabled ? 'Disable' : 'Enable')}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div style={footer}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', border: '1px solid #ccc', background: '#fff', borderRadius: 4, cursor: 'pointer' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
