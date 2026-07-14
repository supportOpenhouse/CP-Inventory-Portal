import { useEffect, useRef, useState } from 'react';

import { ApiError, api } from '../api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

/**
 * CP search + select widget — type-ahead by phone or name.
 *
 * Ported from CP-Inventory-Portal's `screens/Admin/CpSelector.jsx` (the
 * on-behalf submission flow) for the Impersonator page. Retokened: import
 * paths fixed for this project's layout (one level up to `src/`, not two),
 * and the "locked selected CP" card was dropped — the sole caller here
 * (`pages/Impersonator.jsx`) swaps to the framed CP view immediately on pick
 * and never renders this with a value already chosen, so that branch was
 * unreachable. Colors were switched from the source's hardcoded hex to this
 * app's themed CSS variables so the dropdown reads correctly in dark mode.
 *
 * Props:
 *   onSelect: (cp) => void — called with the picked CP row on click/Enter.
 *   city: '' | 'Noida' | 'Gurgaon' | 'Ghaziabad' — when set, results are
 *         restricted to that city AND the caller's personal scope is
 *         ignored (any active CP in the city is selectable). Empty falls
 *         back to the caller's personal scope.
 *
 * Behavior: live-search after 250ms debounce, min 2 chars. Match is on phone
 * digits (any substring) OR name (case-insensitive). Arrow keys + Enter
 * navigate the results list; click to pick.
 */
export default function CpSelector({ onSelect, city = '' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  const debouncedQ = useDebouncedValue(q, 250);

  useEffect(() => {
    let alive = true;
    const trimmed = (debouncedQ || '').trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError('');
      return undefined;
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
  }, [debouncedQ, city]);

  const pick = (cp) => {
    onSelect(cp);
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

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="search"
          autoFocus
          placeholder="Search by phone number or name (min 2 chars)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)' }}>
            searching…
          </span>
        )}
      </div>
      {error && <div className="modal-error">{error}</div>}
      {results.length > 0 && (
        <ul style={{ marginTop: 8, padding: 0, listStyle: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
          {results.map((cp, i) => (
            <li
              key={cp.id}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => pick(cp)}
              style={{
                display: 'flex', alignItems: 'center', padding: '8px 12px', cursor: 'pointer',
                borderBottom: '1px solid var(--hairline)',
                background: i === activeIdx ? 'var(--brand-softer)' : 'var(--surface)',
                borderLeft: i === activeIdx ? '3px solid var(--brand)' : '3px solid transparent',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                  {cp.name || '(no name)'}
                  {cp.cp_code ? <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}> · {cp.cp_code}</span> : null}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, fontFamily: 'monospace' }}>
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
        <div className="muted" style={{ marginTop: 8, padding: 12, fontSize: 13, textAlign: 'center' }}>
          No CPs match “{debouncedQ}”{city ? ` in ${city}` : ' in your scope'}.
        </div>
      )}
    </div>
  );
}
