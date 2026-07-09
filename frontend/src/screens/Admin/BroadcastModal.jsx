import { useEffect, useState } from 'react';

import { ApiError, api } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

const CITY_TABS = ['All', 'Noida', 'Gurgaon', 'Ghaziabad'];

/**
 * Admin-only mass-message modal. Two target modes:
 *   - 'specific': pick individual CPs via search (adminCpSearch), sent as cp_ids.
 *   - 'city':     pick a city ('All' or a specific one), sent as city.
 * cp_ids takes precedence server-side, so the two modes are mutually exclusive here.
 *
 * Backend: POST /comet/broadcast — body { message, cp_ids? , city? } →
 * { total, sent, failed, truncated }.
 *
 * Props:
 *   onClose: () => void
 */
export default function BroadcastModal({ onClose }) {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState('specific'); // 'specific' | 'city'
  const [city, setCity] = useState('');
  const [selected, setSelected] = useState([]); // [{id, name}]

  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { total, sent, failed, truncated }

  // Live CP search for the "Specific CPs" picker (min 2 chars).
  useEffect(() => {
    let alive = true;
    const trimmed = (debouncedQ || '').trim();
    if (mode !== 'specific' || trimmed.length < 2) {
      setResults([]);
      setSearchError('');
      return;
    }
    setSearching(true);
    setSearchError('');
    (async () => {
      try {
        const data = await api.adminCpSearch(trimmed, 20, '');
        if (alive) setResults(data?.results || []);
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
  }, [debouncedQ, mode]);

  const addCp = (cp) => {
    setSelected((prev) => (prev.some((c) => c.id === cp.id) ? prev : [...prev, { id: cp.id, name: cp.name, cp_code: cp.cp_code, phone: cp.phone }]));
    setQ('');
    setResults([]);
  };

  const removeCp = (id) => {
    setSelected((prev) => prev.filter((c) => c.id !== id));
  };

  const canSubmit = (
    message.trim().length > 0 &&
    (mode === 'specific' ? selected.length > 0 : Boolean(city)) &&
    !submitting
  );

  const handleSend = async () => {
    setError('');
    if (!message.trim()) {
      setError('Message is required.');
      return;
    }
    if (mode === 'specific' && selected.length === 0) {
      setError('Pick at least one CP.');
      return;
    }
    if (mode === 'city' && !city) {
      setError('Pick a city.');
      return;
    }

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

  // ── styles (inline, matching other admin modals) ─────────────────
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
  const labelStyle = { fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, display: 'block' };
  const inputStyle = {
    padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14,
    width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const modeBtn = (active) => ({
    padding: '8px 16px', border: active ? '1px solid #FF6B2B' : '1px solid #ccc',
    background: active ? '#FFF5EE' : '#fff', color: active ? '#FF6B2B' : '#333',
    borderRadius: 4, cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: 13,
  });
  const chip = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', background: '#F3F4F6', border: '1px solid #e5e5e5',
    borderRadius: 999, fontSize: 13, marginRight: 8, marginBottom: 8,
  };
  const listStyle = {
    marginTop: 8, padding: 0, listStyle: 'none',
    border: '1px solid #e5e5e5', borderRadius: 6, overflow: 'hidden',
    maxHeight: 220, overflowY: 'auto',
  };
  const rowStyle = {
    display: 'flex', alignItems: 'center', padding: '8px 12px',
    borderBottom: '1px solid #f0f0f0', cursor: 'pointer', background: '#fff',
  };

  const sent = result !== null;

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div style={modal}>
        <div style={header}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Broadcast message</div>
          <button
            onClick={() => (submitting ? null : onClose())}
            disabled={submitting}
            style={{ background: 'transparent', border: 0, fontSize: 22, cursor: submitting ? 'not-allowed' : 'pointer', color: '#666' }}
            aria-label="Close"
          >×</button>
        </div>

        <div style={body}>
          {error && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 4, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {sent && (
            <div style={{ background: '#F0FDF4', color: '#166534', padding: 12, borderRadius: 4, fontSize: 14, marginBottom: 16 }}>
              Sent {result.sent} of {result.total}
              {result.failed ? `, ${result.failed} failed` : ''}
              {result.truncated ? ' (list truncated to 100)' : ''}
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Message to send from Openhouse…"
              disabled={submitting}
              rows={4}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Send to</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={modeBtn(mode === 'specific')} onClick={() => setMode('specific')} disabled={submitting}>
                Specific CPs
              </button>
              <button type="button" style={modeBtn(mode === 'city')} onClick={() => setMode('city')} disabled={submitting}>
                By city
              </button>
            </div>
          </div>

          {mode === 'specific' ? (
            <div>
              {selected.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  {selected.map((c) => (
                    <span key={c.id} style={chip}>
                      {c.name || `CP #${c.id}`}{c.cp_code ? ` · ${c.cp_code}` : (c.phone ? ` · ${c.phone}` : '')}
                      <button
                        type="button"
                        onClick={() => removeCp(c.id)}
                        disabled={submitting}
                        style={{ background: 'transparent', border: 0, cursor: submitting ? 'not-allowed' : 'pointer', color: '#666', fontSize: 14, lineHeight: 1, padding: 0 }}
                        aria-label={`Remove ${c.name || c.id}`}
                      >×</button>
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
                  {results.map((cp) => (
                    <li key={cp.id} onClick={() => addCp(cp)} style={rowStyle}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          {cp.name || '(no name)'}
                          {cp.cp_code ? <span style={{ fontWeight: 400, color: '#888', fontSize: 12 }}> · {cp.cp_code}</span> : null}
                        </div>
                        <div style={{ fontSize: 12, color: '#444', marginTop: 2, fontFamily: 'monospace' }}>
                          {cp.phone || '—'}
                          {cp.city ? <span style={{ fontFamily: 'inherit' }}> · {cp.city}</span> : null}
                          {cp.company ? <span style={{ fontFamily: 'inherit' }}> · {cp.company}</span> : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div>
              <label style={labelStyle}>City</label>
              <select value={city} onChange={(e) => setCity(e.target.value)} disabled={submitting} style={inputStyle}>
                <option value="">— select city —</option>
                {CITY_TABS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={footer}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{ padding: '8px 16px', border: '1px solid #ccc', background: '#fff', borderRadius: 4, cursor: submitting ? 'not-allowed' : 'pointer' }}
          >
            {sent ? 'Close' : 'Cancel'}
          </button>
          {!sent && (
            <button
              onClick={handleSend}
              disabled={!canSubmit}
              style={{
                padding: '8px 16px', border: 0, borderRadius: 4,
                background: canSubmit ? '#FF6B2B' : '#ccc',
                color: '#fff', cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontWeight: 600,
              }}
            >
              {submitting ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
