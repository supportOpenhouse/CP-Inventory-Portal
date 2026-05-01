import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDateOnly } from '../../format';

/**
 * Admin "OH Properties" page — read-only view of inventory rows that are
 * NOT in our submissions table:
 *   - "D Data" => collated_data (App DB; 99acres etc. scrape)
 *   - "F Data" => properties      (Properties DB; the prod inventory pool)
 *
 * Server-side merged + paginated via GET /api/admin/external-inventory.
 *
 * Props:
 *   onClose: () => void   // back to admin board
 */
const PAGE_SIZE = 100;

// Sticky offsets, top to bottom. Each row's `top` = sum of preceding heights.
const HEADER_HEIGHT       = 56;   // page header (Back + title)
const SEARCH_ROW_HEIGHT   = 56;   // search + type toggle + counts
const FILTER_ROW_HEIGHT   = 60;   // city / source / bhk / floor / area / date inline
const HEADERS_TOP         = HEADER_HEIGHT + SEARCH_ROW_HEIGHT + FILTER_ROW_HEIGHT;

const COLUMNS = [
  { key: 'type',    label: 'Type',       sortable: false },
  { key: 'id',      label: 'ID',         sortable: false },
  { key: 'source',  label: 'Source',     sortable: false },
  { key: 'society', label: 'Society',    sortable: false },
  { key: 'city',    label: 'City',       sortable: true  },
  { key: 'bhk',     label: 'BHK',        sortable: true  },
  { key: 'floor',   label: 'Floor',      sortable: true  },
  { key: 'tower',   label: 'Tower',      sortable: false },
  { key: 'unit_no', label: 'Unit',       sortable: false },
  { key: 'area',    label: 'Area (sqft)', sortable: true, align: 'right' },
  { key: 'date',    label: 'Date',       sortable: true  },
];

const DATE_PRESETS = ['All', 'Yesterday', 'This Week', 'This Month', 'Custom'];

/** ISO date (YYYY-MM-DD) helpers in local time. */
function isoDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
function startOfWeekMonday(d) {
  const day = d.getDay() || 7; // 1..7, Mon=1
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function rangeForPreset(preset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (preset === 'Yesterday') {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { from: isoDate(y), to: isoDate(y) };
  }
  if (preset === 'This Week') {
    return { from: isoDate(startOfWeekMonday(today)), to: isoDate(today) };
  }
  if (preset === 'This Month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: isoDate(first), to: isoDate(today) };
  }
  return { from: '', to: '' };  // 'All' or 'Custom' (custom is filled by user)
}

export default function ExternalInventory({ onClose }) {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);

  const [city, setCity] = useState('');
  const [source, setSource] = useState('');
  const [bhk, setBhk] = useState('');
  const [floor, setFloor] = useState('');
  const [areaMin, setAreaMin] = useState('');
  const [areaMax, setAreaMax] = useState('');
  const [datePreset, setDatePreset] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [typeFilter, setTypeFilter] = useState('');  // '' = both, 'D', 'F'
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);

  const [data, setData] = useState({
    results: [], total: 0,
    counts: { D: 0, F: 0 },
    facets: { sources: [], cities: [], bhks: [] },
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // When a date preset is picked, derive from/to from it.
  useEffect(() => {
    if (datePreset === 'Custom') return;  // user manages from/to manually
    const { from, to } = rangeForPreset(datePreset);
    setDateFrom(from);
    setDateTo(to);
  }, [datePreset]);

  // Reset page to 1 whenever a filter changes
  useEffect(() => { setPage(1); }, [search, city, source, bhk, floor, areaMin, areaMax, datePreset, dateFrom, dateTo, typeFilter, sortCol, sortDir]);

  const filters = useMemo(() => {
    const f = { page, page_size: PAGE_SIZE, sort: sortCol, direction: sortDir };
    if (search.trim().length >= 2) f.q = search.trim();
    if (city)     f.city = city;
    if (source)   f.source = source;
    if (bhk)      f.bhk = bhk;
    if (floor)    f.floor = floor;
    if (areaMin)  f.area_min = areaMin;
    if (areaMax)  f.area_max = areaMax;
    if (dateFrom) f.date_from = dateFrom;
    if (dateTo)   f.date_to = dateTo;
    if (typeFilter) f.type = typeFilter;
    return f;
  }, [search, city, source, bhk, floor, areaMin, areaMax, dateFrom, dateTo, typeFilter, sortCol, sortDir, page]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.adminListExternalInventory(filters);
      setData({
        results: res.results || [],
        total:   res.total || 0,
        counts:  res.counts || { D: 0, F: 0 },
        facets:  res.facets || { sources: [], cities: [], bhks: [] },
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load OH Properties');
      setData({ results: [], total: 0, counts: { D: 0, F: 0 }, facets: { sources: [], cities: [], bhks: [] } });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { reload(); }, [reload]);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const start = data.results.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = (page - 1) * PAGE_SIZE + data.results.length;

  const onSort = (col) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir(col === 'date' || col === 'area' ? 'desc' : 'asc');
    }
  };
  const sortIcon = (col, isSortable) => {
    if (!isSortable) return '';
    if (sortCol !== col) return ' ⇅';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  // ── render ──────────────────────────────────────────────────
  return (
    <div className="app-shell" style={{ maxWidth: 'none' }}>
      {/* Page header — sticky at the very top */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: '#fff', borderBottom: '1px solid #eee',
        padding: '12px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
        height: HEADER_HEIGHT, boxSizing: 'border-box',
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
        <span style={{ fontSize: 16, fontWeight: 600, color: '#222' }}>OH Properties</span>
      </div>

      {/* Search row — sticky just below the page header */}
      <div style={{
        position: 'sticky', top: HEADER_HEIGHT, zIndex: 25,
        display: 'flex', gap: 12, padding: '10px 20px',
        alignItems: 'center', flexWrap: 'wrap',
        borderBottom: '1px solid #eee', background: '#fafafa',
        height: SEARCH_ROW_HEIGHT, boxSizing: 'border-box',
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
        <span style={{ fontSize: 12, color: '#666' }}>
          {loading ? 'Loading…' : `${data.total.toLocaleString()} rows · showing ${start}–${end}`}
        </span>
      </div>

      {/* Filter row — sticky below search row */}
      <div style={{
        position: 'sticky', top: HEADER_HEIGHT + SEARCH_ROW_HEIGHT, zIndex: 20,
        display: 'flex', gap: 14, padding: '10px 20px',
        alignItems: 'center', flexWrap: 'wrap',
        borderBottom: '1px solid #eee', background: '#fff',
        minHeight: FILTER_ROW_HEIGHT, boxSizing: 'border-box', fontSize: 13,
      }}>
        <FilterSelect label="City"   value={city}   onChange={setCity}   options={['Noida', 'Gurgaon', 'Ghaziabad']} />
        <FilterSelect label="Source" value={source} onChange={setSource} options={data.facets.sources} />
        <FilterSelect label="BHK"    value={bhk}    onChange={setBhk}    options={data.facets.bhks} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={fLabel}>Floor:</span>
          <input
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            placeholder="e.g. 5 / Lower"
            style={{ ...textInput, width: 110 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={fLabel}>Area (sqft):</span>
          <input
            type="number" min={0}
            value={areaMin}
            onChange={(e) => setAreaMin(e.target.value)}
            placeholder="min"
            style={{ ...textInput, width: 80 }}
          />
          <span style={{ color: '#888' }}>—</span>
          <input
            type="number" min={0}
            value={areaMax}
            onChange={(e) => setAreaMax(e.target.value)}
            placeholder="max"
            style={{ ...textInput, width: 80 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={fLabel}>Date:</span>
          <div style={{ display: 'inline-flex', border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden' }}>
            {DATE_PRESETS.map((p) => {
              const active = datePreset === p;
              return (
                <button
                  key={p}
                  onClick={() => setDatePreset(p)}
                  style={{
                    padding: '5px 10px',
                    background: active ? '#222' : '#fff',
                    color: active ? '#fff' : '#444',
                    border: 0, borderRight: '1px solid #ddd',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >{p}</button>
              );
            })}
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDatePreset('Custom'); setDateFrom(e.target.value); }}
            disabled={datePreset !== 'Custom'}
            style={{ ...textInput, width: 130, opacity: datePreset === 'Custom' ? 1 : 0.6 }}
          />
          <span style={{ color: '#888' }}>to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDatePreset('Custom'); setDateTo(e.target.value); }}
            disabled={datePreset !== 'Custom'}
            style={{ ...textInput, width: 130, opacity: datePreset === 'Custom' ? 1 : 0.6 }}
          />
        </label>
        {(city || source || bhk || floor || areaMin || areaMax || datePreset !== 'All') && (
          <button
            onClick={() => {
              setCity(''); setSource(''); setBhk(''); setFloor('');
              setAreaMin(''); setAreaMax('');
              setDatePreset('All'); setDateFrom(''); setDateTo('');
            }}
            style={{
              padding: '6px 10px', border: '1px solid #ddd', background: '#fff',
              borderRadius: 6, fontSize: 12, color: '#666', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Clear filters</button>
        )}
      </div>

      {error && (
        <div style={{ padding: 16, color: '#991b1b', background: '#fee2e2', margin: 12, borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* Table — borderCollapse MUST be 'separate' for sticky <th> to work
          in Chrome/Firefox. With 'collapse' the borders are shared between
          th and td, which prevents the th from positioning independently.
          Row separators are therefore moved from <tr> to <td>. */}
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, background: '#fff' }}>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                onClick={c.sortable ? () => onSort(c.key) : undefined}
                style={{
                  ...thStyle,
                  textAlign: c.align || 'left',
                  cursor: c.sortable ? 'pointer' : 'default',
                  userSelect: 'none',
                  background: (c.sortable && sortCol === c.key) ? '#FFEEE0' : '#FAFAF8',
                  color:      (c.sortable && sortCol === c.key) ? '#FF6B2B' : '#999',
                }}
                title={c.sortable ? `Sort by ${c.label}` : undefined}
              >
                {c.label}{sortIcon(c.key, c.sortable)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.results.length === 0 && !loading ? (
            <tr>
              <td colSpan={COLUMNS.length} style={{ ...tdStyle, padding: 40, textAlign: 'center', color: '#999', borderBottom: 0 }}>
                No OH Properties match your filters.
              </td>
            </tr>
          ) : (
            data.results.map((r, i) => (
              <tr key={`${r.type}-${r.id}-${i}`}>
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

// ── small components / styles ────────────────────────────────────────
function FilterSelect({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={fLabel}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...textInput, minWidth: 110 }}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

const fLabel = {
  fontSize: 12, fontWeight: 700, color: '#666',
  textTransform: 'uppercase', letterSpacing: 0.4,
};
const textInput = {
  padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6,
  fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
};
const thStyle = {
  textAlign: 'left', padding: '10px 14px',
  fontSize: 11, fontWeight: 600, color: '#999',
  textTransform: 'uppercase', letterSpacing: 0.4,
  borderBottom: '2px solid #E8E6E0',
  position: 'sticky',
  top: HEADERS_TOP,
  zIndex: 10,
  background: '#FAFAF8',
};
// Row separator on td (not tr) because borderCollapse is 'separate' for the
// sticky thead to work — borders on tr don't render in that mode.
const tdStyle = {
  padding: '10px 14px',
  verticalAlign: 'top',
  borderBottom: '1px solid #F3F2EE',
};
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
