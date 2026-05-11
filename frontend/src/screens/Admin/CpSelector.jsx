import { useEffect, useRef, useState } from 'react';

import { ApiError, api } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

/**
 * CP search + select widget for the on-behalf submission flow.
 *
 * Props:
 *   value: { id, name, phone, cp_code, company, city } | null  — the picked CP, or null
 *   onChange: (cp | null) => void
 *   city:  '' | 'Noida' | 'Gurgaon' | 'Ghaziabad'  — when set, results are
 *         restricted to that city AND the caller's personal scope is
 *         IGNORED (any active CP in the city is selectable). When empty,
 *         falls back to the caller's personal scope (legacy behavior).
 *
 * Behavior:
 *   - Type in the search box: live-search after 250ms debounce, min 2 chars.
 *   - Match is on phone digits (any substring) OR name (case-insensitive).
 *   - Results list appears below the input. Arrow keys + Enter to navigate; click to pick.
 *   - Once a CP is picked, shows a locked card with "Change CP" button.
 */
export default function CpSelector({ value, onChange, city = '' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  const debouncedQ = useDebouncedValue(q, 250);

  useEffect(() => {
    let alive = true;
    if (value) return; // don't search once a CP is locked in
    const trimmed = (debouncedQ || '').trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    (async () => {
      try {
        const data = await api.adminCpSearch(trimmed, 20, city);
        if (alive) {
          setResults(data?.results || []);
          setActiveIdx(0);
        }
      } catch (e) {
        if (alive) {
          setError(e instanceof ApiError ? e.message : 'CP search failed');
          setResults([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [debouncedQ, value, city]);

  const pick = (cp) => {
    onChange(cp);
    setQ('');
    setResults([]);
  };

  const onKeyDown = (e) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter')   { e.preventDefault(); if (results[activeIdx]) pick(results[activeIdx]); }
    else if (e.key === 'Escape')  { setResults([]); }
  };

  // ──────── selected state ────────
  if (value) {
    return (
      <div style={cardSelected}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.4 }}>CP</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{value.name || `(no name)`}</div>
          <div style={{ fontSize: 13, color: '#444', marginTop: 4 }}>
            <span style={{ fontFamily: 'monospace' }}>{value.phone || '—'}</span>
            {value.cp_code ? <span> · {value.cp_code}</span> : null}
            {value.city ? <span> · {value.city}</span> : null}
            {value.company ? <span> · {value.company}</span> : null}
          </div>
        </div>
        <button type="button" onClick={() => onChange(null)} style={btnSecondary}>
          Change CP
        </button>
      </div>
    );
  }

  // ──────── search state ────────
  return (
    <div style={cardSearch}>
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
        Pick CP
      </div>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="search"
          autoFocus
          placeholder="Search by phone number or name (min 2 chars)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          style={inputStyle}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#888' }}>
            searching…
          </span>
        )}
      </div>
      {error && (
        <div style={{ marginTop: 8, padding: 8, background: '#fee2e2', color: '#991b1b', borderRadius: 4, fontSize: 13 }}>
          {error}
        </div>
      )}
      {results.length > 0 && (
        <ul style={listStyle}>
          {results.map((cp, i) => (
            <li
              key={cp.id}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => pick(cp)}
              style={{
                ...rowStyle,
                background: i === activeIdx ? '#FFF5EE' : '#fff',
                borderLeft: i === activeIdx ? '3px solid #FF6B2B' : '3px solid transparent',
              }}
            >
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
      {!loading && (debouncedQ || '').trim().length >= 2 && results.length === 0 && !error && (
        <div style={{ marginTop: 8, padding: 12, color: '#888', fontSize: 13, textAlign: 'center' }}>
          No CPs match “{debouncedQ}”{city ? ` in ${city}` : ' in your scope'}.
        </div>
      )}
    </div>
  );
}

const cardSelected = {
  display: 'flex', alignItems: 'center', gap: 16,
  padding: '14px 16px', background: '#F0FDF4',
  border: '1px solid #6EE7B7', borderRadius: 8,
};
const cardSearch = {
  padding: '12px 16px', background: '#fff',
  border: '1px solid #e5e5e5', borderRadius: 8,
};
const inputStyle = {
  width: '100%', padding: '10px 12px',
  border: '1px solid #ccc', borderRadius: 6,
  fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
};
const listStyle = {
  marginTop: 8, padding: 0, listStyle: 'none',
  border: '1px solid #e5e5e5', borderRadius: 6, overflow: 'hidden',
  maxHeight: 280, overflowY: 'auto',
};
const rowStyle = {
  display: 'flex', alignItems: 'center', padding: '8px 12px',
  borderBottom: '1px solid #f0f0f0', cursor: 'pointer',
};
const btnSecondary = {
  padding: '6px 12px', border: '1px solid #ccc', background: '#fff',
  borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
