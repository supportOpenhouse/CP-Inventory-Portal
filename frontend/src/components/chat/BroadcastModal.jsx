import { useEffect, useState } from 'react';
import { ApiError, api } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { IconClose } from '../icons.jsx';

const CITY_TABS = ['All', 'Noida', 'Gurgaon', 'Ghaziabad'];

/**
 * Admin-only mass-message modal. Two mutually-exclusive target modes:
 *   - 'specific': pick individual CPs via search → sent as cp_ids.
 *   - 'city':     pick a city → sent as city.
 * Backend: POST /comet/broadcast { message, cp_ids? , city? } → { total, sent, failed, truncated }.
 * Ported from CP's BroadcastModal into our modal chrome + tokens.
 */
export default function BroadcastModal({ onClose }) {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState('specific'); // 'specific' | 'city'
  const [city, setCity] = useState('');
  const [selected, setSelected] = useState([]);

  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    const trimmed = (debouncedQ || '').trim();
    if (mode !== 'specific' || trimmed.length < 2) { setResults([]); setSearchError(''); return; }
    setSearching(true);
    setSearchError('');
    (async () => {
      try {
        const data = await api.adminCpSearch(trimmed, 20, '');
        if (alive) setResults(data?.results || []);
      } catch (e) {
        if (alive) { setSearchError(e instanceof ApiError ? e.message : 'CP search failed'); setResults([]); }
      } finally {
        if (alive) setSearching(false);
      }
    })();
    return () => { alive = false; };
  }, [debouncedQ, mode]);

  const addCp = (cp) => {
    setSelected((prev) => (prev.some((c) => c.id === cp.id) ? prev : [...prev, { id: cp.id, name: cp.name, cp_code: cp.cp_code, phone: cp.phone }]));
    setQ('');
    setResults([]);
  };
  const removeCp = (id) => setSelected((prev) => prev.filter((c) => c.id !== id));

  const canSubmit = message.trim().length > 0
    && (mode === 'specific' ? selected.length > 0 : Boolean(city))
    && !submitting;

  const handleSend = async () => {
    setError('');
    if (!message.trim()) { setError('Message is required.'); return; }
    if (mode === 'specific' && selected.length === 0) { setError('Pick at least one CP.'); return; }
    if (mode === 'city' && !city) { setError('Pick a city.'); return; }

    const confirmed = mode === 'city'
      ? window.confirm(`Send this message to all CPs in ${city}? (up to 100 per send)`)
      : window.confirm(`Send to ${selected.length} selected CP(s)?`);
    if (!confirmed) return;

    setSubmitting(true);
    setResult(null);
    try {
      const payload = mode === 'city'
        ? { message: message.trim(), city }
        : { message: message.trim(), cp_ids: selected.map((c) => c.id) };
      const data = await api.cometBroadcast(payload);
      setResult(data);
    } catch (e) {
      setError(e.message || 'Broadcast failed');
    } finally {
      setSubmitting(false);
    }
  };

  const sent = result !== null;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head-row">
          <h3 style={{ marginBottom: 0 }}>Broadcast message</h3>
          <button type="button" className="modal-close" onClick={() => (submitting ? null : onClose())} disabled={submitting} aria-label="Close"><IconClose /></button>
        </div>

        {error && <div className="modal-error" style={{ marginBottom: 12 }}>{error}</div>}
        {sent && (
          <div className="chat-result-banner">
            Sent {result.sent} of {result.total}
            {result.failed ? `, ${result.failed} failed` : ''}
            {result.truncated ? ' (list truncated to 100)' : ''}
          </div>
        )}

        <div className="form-field">
          <label>Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message to send from Openhouse…"
            disabled={submitting}
            rows={4}
            style={{ resize: 'vertical' }}
          />
        </div>

        <div className="form-field">
          <label>Send to</label>
          <div className="chat-seg">
            <button type="button" className={`chat-seg-btn${mode === 'specific' ? ' active' : ''}`} onClick={() => setMode('specific')} disabled={submitting}>Specific CPs</button>
            <button type="button" className={`chat-seg-btn${mode === 'city' ? ' active' : ''}`} onClick={() => setMode('city')} disabled={submitting}>By city</button>
          </div>
        </div>

        {mode === 'specific' ? (
          <div>
            {selected.length > 0 && (
              <div className="chat-chips">
                {selected.map((c) => (
                  <span key={c.id} className="chat-chip">
                    {c.name || `CP #${c.id}`}{c.cp_code ? ` · ${c.cp_code}` : (c.phone ? ` · ${c.phone}` : '')}
                    <button type="button" onClick={() => removeCp(c.id)} disabled={submitting} aria-label={`Remove ${c.name || c.id}`}>×</button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="search"
              placeholder="Search CPs by name or phone (min 2 chars)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              disabled={submitting}
            />
            {searching && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>searching…</div>}
            {searchError && <div className="modal-error" style={{ marginTop: 8 }}>{searchError}</div>}
            {results.length > 0 && (
              <ul className="chat-search-list">
                {results.map((cp) => (
                  <li key={cp.id} className="chat-search-row" onClick={() => addCp(cp)}>
                    <div style={{ minWidth: 0 }}>
                      <div className="chat-search-name">
                        {cp.name || '(no name)'}
                        {cp.cp_code ? <span className="muted"> · {cp.cp_code}</span> : null}
                      </div>
                      <div className="chat-search-sub">
                        {cp.phone || '—'}{cp.city ? ` · ${cp.city}` : ''}{cp.company ? ` · ${cp.company}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="form-field">
            <label>City</label>
            <select value={city} onChange={(e) => setCity(e.target.value)} disabled={submitting}>
              <option value="">— select city —</option>
              {CITY_TABS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>{sent ? 'Close' : 'Cancel'}</button>
          {!sent && (
            <button type="button" className="btn-primary" onClick={handleSend} disabled={!canSubmit}>
              {submitting ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
