import { useEffect, useState } from 'react';
import { ApiError, api } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { IconClose } from '../icons.jsx';

/**
 * Admin-only chat user management modal. Two sections:
 *   - Requests: CPs who tapped "Request admin to start chat" on the gate.
 *   - Manage CPs: search any CP and toggle their chat access.
 * Backend: /comet/requests, /comet/access, /comet/enable, /comet/disable.
 * Ported from CP's ChatUserManager into our modal chrome + tokens.
 */
export default function ChatUserManager({ onClose, onStartChat }) {
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState('');
  const [enablingCpId, setEnablingCpId] = useState(null);

  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [enabledMap, setEnabledMap] = useState({});
  const [togglingCpId, setTogglingCpId] = useState(null);
  const debouncedQ = useDebouncedValue(q, 300);

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
      setEnabledMap((prev) => ({ ...prev, [cpId]: true }));
      onStartChat?.(cpId);
    } catch (e) {
      setRequestsError(e instanceof ApiError ? e.message : 'Enable failed');
    } finally {
      setEnablingCpId(null);
    }
  };

  useEffect(() => {
    let alive = true;
    const trimmed = (debouncedQ || '').trim();
    if (trimmed.length < 2) { setResults([]); setSearchError(''); return; }
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
          } catch { /* non-fatal — buttons just won't show a definitive state */ }
        }
      } catch (e) {
        if (alive) { setSearchError(e instanceof ApiError ? e.message : 'CP search failed'); setResults([]); }
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

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head-row">
          <h3 style={{ marginBottom: 0 }}>Manage chat users</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>

        {/* Pending requests */}
        <div className="chat-mgr-section">
          <div className="field-lbl" style={{ marginBottom: 8 }}>Pending requests</div>
          {requestsError && <div className="modal-error" style={{ marginBottom: 10 }}>{requestsError}</div>}
          {requestsLoading ? (
            <div className="muted" style={{ fontSize: 13 }}>Loading…</div>
          ) : requests.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>No pending requests.</div>
          ) : (
            <ul className="chat-search-list">
              {requests.map((r) => (
                <li key={r.cp_id} className="chat-search-row chat-search-row-split">
                  <div style={{ minWidth: 0 }}>
                    <div className="chat-search-name">{r.name || `CP #${r.cp_id}`}</div>
                    <div className="chat-search-sub">
                      {r.phone || '—'}{r.city ? ` · ${r.city}` : ''}{r.requested_at ? ` · requested ${new Date(r.requested_at).toLocaleString()}` : ''}
                    </div>
                  </div>
                  <button type="button" className="btn-primary btn-xs" disabled={enablingCpId === r.cp_id} onClick={() => enableFromRequest(r.cp_id)}>
                    {enablingCpId === r.cp_id ? 'Enabling…' : 'Enable & start chat'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Manage CPs */}
        <div className="chat-mgr-section">
          <div className="field-lbl" style={{ marginBottom: 8 }}>Manage CPs</div>
          <input
            type="search"
            placeholder="Search CPs by name or phone (min 2 chars)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {searching && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>searching…</div>}
          {searchError && <div className="modal-error" style={{ marginTop: 8 }}>{searchError}</div>}
          {results.length > 0 && (
            <ul className="chat-search-list">
              {results.map((cp) => {
                const enabled = !!enabledMap[cp.id];
                const busy = togglingCpId === cp.id;
                return (
                  <li key={cp.id} className="chat-search-row chat-search-row-split">
                    <div style={{ minWidth: 0 }}>
                      <div className="chat-search-name">
                        {cp.name || '(no name)'}
                        {cp.cp_code ? <span className="muted"> · {cp.cp_code}</span> : null}
                        <span className={`chat-access-badge ${enabled ? 'on' : 'off'}`}>{enabled ? 'ENABLED' : 'DISABLED'}</span>
                      </div>
                      <div className="chat-search-sub">{cp.phone || '—'}{cp.city ? ` · ${cp.city}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {enabled && <button type="button" className="btn-soft btn-xs" onClick={() => onStartChat?.(cp.id)}>Message</button>}
                      <button type="button" className={`btn-xs ${enabled ? 'btn-ghost' : 'btn-primary'}`} disabled={busy} onClick={() => toggleAccess(cp, !enabled)}>
                        {busy ? '…' : (enabled ? 'Disable' : 'Enable')}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
