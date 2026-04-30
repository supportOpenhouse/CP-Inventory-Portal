import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDateOnly } from '../../format';

/**
 * Admin "External Data" page — read-only view of inventory rows that are NOT
 * in our submissions table:
 *   - "D Data" => collated_data (App DB; 99acres etc. scrape)
 *   - "F Data" => properties      (Properties DB; the prod inventory pool)
 *
 * Server-side merged + paginated via GET /api/admin/external-inventory.
 *
 * Props:
 *   onClose: () => void   // back to admin board
 */
const PAGE_SIZE = 100;
const CITY_OPTIONS = ['', 'Noida', 'Gurgaon', 'Ghaziabad'];

export default function ExternalInventory({ onClose }) {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [city, setCity] = useState('');
  const [typeFilter, setTypeFilter] = useState('');  // '' = both, 'D', 'F'
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ results: [], total: 0, counts: { D: 0, F: 0 } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset page to 1 when filters change
  useEffect(() => { setPage(1); }, [search, city, typeFilter]);

  const filters = useMemo(() => {
    const f = { page, page_size: PAGE_SIZE };
    if (search.trim().length >= 2) f.q = search.trim();
    if (city) f.city = city;
    if (typeFilter) f.type = typeFilter;
    return f;
  }, [search, city, typeFilter, page]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.adminListExternalInventory(filters);
      setData({
        results: res.results || [],
        total: res.total || 0,
        counts: res.counts || { D: 0, F: 0 },
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load external inventory');
      setData({ results: [], total: 0, counts: { D: 0, F: 0 } });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { reload(); }, [reload]);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const start = data.results.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = (page - 1) * PAGE_SIZE + data.results.length;

  return (
    <div className="app-shell" style={{ maxWidth: 'none' }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#fff', borderBottom: '1px solid #eee',
        padding: '12px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          onClick={onClose}
          type="button"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#fff', border: '1px solid #ddd',
            borderRadius: 6, padding: '6px 12px',
            color: '#222', fontSize: 14, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >← Back</button>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#222' }}>
          External Data{' '}
          <span style={{ fontWeight: 400, color: '#888' }}>
            (collated · D Data · {data.counts.D} &nbsp;·&nbsp; properties · F Data · {data.counts.F})
          </span>
        </span>
      </div>

      {/* Filter row */}
      <div style={{
        display: 'flex', gap: 12, padding: '12px 20px',
        alignItems: 'center', flexWrap: 'wrap',
        borderBottom: '1px solid #eee', background: '#fafafa',
      }}>
        <input
          type="search"
          placeholder="Search society, locality, source… (min 2 chars)"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{
            flex: 1, minWidth: 240,
            padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6,
            fontSize: 14, fontFamily: 'inherit',
          }}
        />
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, fontFamily: 'inherit' }}
        >
          {CITY_OPTIONS.map((c) => (
            <option key={c} value={c}>{c || 'All cities'}</option>
          ))}
        </select>
        <div style={{ display: 'inline-flex', border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden' }}>
          {[
            { val: '',  label: 'Both' },
            { val: 'D', label: `D Data (${data.counts.D})` },
            { val: 'F', label: `F Data (${data.counts.F})` },
          ].map((opt) => {
            const active = typeFilter === opt.val;
            return (
              <button
                key={opt.val}
                onClick={() => setTypeFilter(opt.val)}
                style={{
                  padding: '7px 14px',
                  background: active ? '#FF6B2B' : '#fff',
                  color: active ? '#fff' : '#444',
                  border: 0, borderRight: '1px solid #ddd',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >{opt.label}</button>
            );
          })}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#666' }}>
          {loading ? 'Loading…' : `${data.total.toLocaleString()} rows · showing ${start}–${end}`}
        </span>
      </div>

      {error && (
        <div style={{ padding: 16, color: '#991b1b', background: '#fee2e2', margin: 12, borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff' }}>
          <thead style={{ position: 'sticky', top: 56, zIndex: 5, background: '#FAFAF8' }}>
            <tr>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>Source</th>
              <th style={thStyle}>Society</th>
              <th style={thStyle}>City</th>
              <th style={thStyle}>BHK</th>
              <th style={thStyle}>Floor</th>
              <th style={thStyle}>Tower</th>
              <th style={thStyle}>Unit</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Area (sqft)</th>
              <th style={thStyle}>Date</th>
            </tr>
          </thead>
          <tbody>
            {data.results.length === 0 && !loading ? (
              <tr>
                <td colSpan={11} style={{ padding: 40, textAlign: 'center', color: '#999' }}>
                  No external inventory matches your filters.
                </td>
              </tr>
            ) : (
              data.results.map((r, i) => (
                <tr key={`${r.type}-${r.id}-${i}`} style={{ borderBottom: '1px solid #F3F2EE' }}>
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px', borderRadius: 3,
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
                      background: r.type === 'D Data' ? '#EEF2FF' : '#FFF3ED',
                      color:      r.type === 'D Data' ? '#6366F1' : '#FF6B2B',
                    }}>{r.type}</span>
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: '#555' }}>
                    {r.id || '—'}
                  </td>
                  <td style={tdStyle}>{r.source || '—'}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    {r.society || '—'}
                    {r.locality && (
                      <div style={{ fontSize: 11, color: '#888', fontWeight: 400 }}>{r.locality}</div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: '#666' }}>{r.city || '—'}</td>
                  <td style={tdStyle}>{r.bhk || '—'}</td>
                  <td style={tdStyle}>{r.floor || '—'}</td>
                  <td style={tdStyle}>{r.tower || '—'}</td>
                  <td style={tdStyle}>{r.unit_no || '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {r.area != null ? Number(r.area).toLocaleString() : '—'}
                  </td>
                  <td style={{ ...tdStyle, color: '#666', whiteSpace: 'nowrap' }}>
                    {r.date ? formatDateOnly(r.date) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data.total > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: 16, borderTop: '1px solid #eee', background: '#fafafa',
        }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            style={pagBtn(page === 1 || loading)}
          >← Prev</button>
          <span style={{ fontSize: 13, color: '#555' }}>
            Page <strong>{page}</strong> of <strong>{totalPages.toLocaleString()}</strong>
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            style={pagBtn(page >= totalPages || loading)}
          >Next →</button>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  textAlign: 'left', padding: '10px 14px',
  fontSize: 11, fontWeight: 600, color: '#999',
  textTransform: 'uppercase', letterSpacing: 0.4,
  borderBottom: '2px solid #E8E6E0',
};
const tdStyle = { padding: '10px 14px', verticalAlign: 'top' };
function pagBtn(disabled) {
  return {
    padding: '6px 14px',
    background: disabled ? '#eee' : '#fff',
    color: disabled ? '#999' : '#222',
    border: '1px solid #ddd', borderRadius: 6,
    fontSize: 13, fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
  };
}
