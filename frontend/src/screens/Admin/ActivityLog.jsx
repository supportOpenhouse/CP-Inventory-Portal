import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDateTime } from '../../format';

/**
 * Admin "Activity Logs" page — feed of all mutations across the
 * dashboard (status changes, reassigns, schedules, comments, staff
 * user mgmt, CP submits, CP counter-offer responses, etc.).
 *
 * Backed by GET /api/admin/activity-log + /facets. Server-side paginated;
 * default page_size = 100, hard cap = 500 to match the org-wide convention.
 *
 * Props:
 *   onClose: () => void   // back to admin board
 */
const PAGE_SIZE = 100;
const HARD_CAP = 500;

const HEADER_HEIGHT = 56;     // page header (Back + title)
const FILTER_HEIGHT = 64;     // single filter row

export default function ActivityLog({ onClose }) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const [action, setAction] = useState('');
  const [category, setCategory] = useState('');
  const [actorEmail, setActorEmail] = useState('');
  const [actorName, setActorName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState({ rows: [], total: 0, has_more: false, cap_reached: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [facets, setFacets] = useState({ actions: [], categories: [], dashboards: [], actors: [] });

  // Actor dropdowns: derived from the facets payload. We expose two
  // selects (name and email) that are loosely coordinated — picking a
  // name auto-fills the matching email and vice versa.
  const actorNames = useMemo(
    () => Array.from(new Set(facets.actors.map((a) => a.name).filter(Boolean))).sort(),
    [facets.actors],
  );
  const actorEmails = useMemo(
    () => Array.from(new Set(facets.actors.map((a) => a.email).filter(Boolean))).sort(),
    [facets.actors],
  );

  // Reset to page 1 when any filter changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, action, category, actorEmail, actorName, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = {
        search: debouncedSearch || undefined,
        action: action || undefined,
        category: category || undefined,
        actor_email: actorEmail || undefined,
        actor_name: actorName || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page,
        page_size: PAGE_SIZE,
      };
      const resp = await api.adminListActivityLog(filters);
      setData(resp || { rows: [], total: 0 });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load activity log');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, action, category, actorEmail, actorName, dateFrom, dateTo, page]);

  useEffect(() => { load(); }, [load]);

  // Facets load once on mount.
  useEffect(() => {
    let alive = true;
    api.adminListActivityLogFacets().then((f) => {
      if (alive) setFacets(f || { actions: [], categories: [], dashboards: [], actors: [] });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const total = data.total || 0;
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  const clearAll = () => {
    setSearch('');
    setAction('');
    setCategory('');
    setActorEmail('');
    setActorName('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };
  const anyFilterActive = (
    !!search || !!action || !!category || !!actorEmail || !!actorName || !!dateFrom || !!dateTo
  );

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa' }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 30,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', background: '#fff', borderBottom: '1px solid #eee',
        height: HEADER_HEIGHT, boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4,
              background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
            }}
          >← Back</button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>Activity Logs</div>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              CP Inventory Portal
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#666' }}>
          {loading ? 'Loading…' : (
            total > 0
              ? `${total.toLocaleString()}${data.cap_reached ? '+' : ''} rows · showing ${start}–${end}`
              : 'No rows'
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div style={{
        position: 'sticky', top: HEADER_HEIGHT, zIndex: 25,
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px',
        background: '#fff', borderBottom: '1px solid #eee',
        height: FILTER_HEIGHT, boxSizing: 'border-box',
        overflowX: 'auto', flexWrap: 'nowrap',
      }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by UID (e.g. OHLNC0091)"
          style={{ ...textInput, width: 240 }}
        />
        <FilterSelect label="Action" value={action} onChange={setAction} options={facets.actions} />
        <FilterSelect label="Category" value={category} onChange={setCategory} options={facets.categories} />
        <FilterSelect label="Actor email" value={actorEmail} onChange={setActorEmail} options={actorEmails} />
        <FilterSelect label="Actor name" value={actorName} onChange={setActorName} options={actorNames} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={fLabel}>Date:</span>
          <input
            type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            style={{ ...textInput, width: 130 }}
          />
          <span style={{ color: '#888' }}>to</span>
          <input
            type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            style={{ ...textInput, width: 130 }}
          />
        </label>
        {anyFilterActive && (
          <button
            onClick={clearAll}
            style={{
              padding: '6px 10px', borderRadius: 4, border: '1px solid #DC2626',
              background: '#fff', color: '#DC2626', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >Clear filters</button>
        )}
      </div>

      {/* Cap warning, mirroring the org-wide convention. */}
      {data.cap_reached && (
        <div style={{
          margin: '10px 20px 0', padding: '8px 12px',
          background: '#FEF3C7', color: '#7C4A03',
          border: '1px solid #FDE68A', borderRadius: 4, fontSize: 13,
        }}>
          Showing first {HARD_CAP} results. Narrow filters for more specific results.
        </div>
      )}

      {error && (
        <div style={{
          margin: '10px 20px', padding: '8px 12px',
          background: '#fee2e2', color: '#991b1b',
          border: '1px solid #fecaca', borderRadius: 4, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ padding: '12px 20px' }}>
        <table style={{
          width: '100%', borderCollapse: 'separate', borderSpacing: 0,
          background: '#fff', border: '1px solid #eee', borderRadius: 4,
          fontSize: 13,
        }}>
          <thead>
            <tr>
              <th style={th}>Timestamp</th>
              <th style={th}>UID</th>
              <th style={th}>Actor</th>
              <th style={th}>Action</th>
              <th style={th}>Category</th>
              <th style={th}>Dashboard</th>
              <th style={th}>Details</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && !loading && (
              <tr>
                <td style={{ ...td, textAlign: 'center', color: '#999', padding: 24 }} colSpan={7}>
                  No activity matches these filters.
                </td>
              </tr>
            )}
            {data.rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                <td style={{ ...td, color: '#444', whiteSpace: 'nowrap' }}>
                  {formatDateTime(r.created_at)}
                </td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                  {r.entity_uid || <span style={{ color: '#bbb' }}>—</span>}
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{r.actor_name || actorTypeLabel(r.actor_type)}</div>
                  {(r.actor_email || r.actor_phone) && (
                    <div style={{ fontSize: 11, color: '#888' }}>
                      {r.actor_email || r.actor_phone}
                    </div>
                  )}
                </td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{r.action}</td>
                <td style={td}>
                  <span style={categoryPill(r.category)}>{r.category}</span>
                </td>
                <td style={{ ...td, color: '#666' }}>{r.dashboard}</td>
                <td style={{ ...td, color: '#444', maxWidth: 360 }}>
                  <DetailsCell details={r.details} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination — hidden when everything fits on one page. */}
        {total > PAGE_SIZE && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              style={pageBtn(page <= 1)}
            >‹ Prev</button>
            <span style={{ fontSize: 12, color: '#666' }}>
              Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!data.has_more || loading}
              style={pageBtn(!data.has_more)}
            >Next ›</button>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={fLabel}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...textInput, minWidth: 130 }}
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </label>
  );
}

function DetailsCell({ details }) {
  if (!details || (typeof details === 'object' && Object.keys(details).length === 0)) {
    return <span style={{ color: '#bbb' }}>—</span>;
  }
  // Compact inline rendering of the most common shapes; fall back to JSON.
  if (typeof details === 'object') {
    const entries = Object.entries(details).slice(0, 5);
    return (
      <div style={{ fontSize: 12 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 4 }}>
            <span style={{ color: '#888' }}>{k}:</span>
            <span style={{ color: '#333', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {formatDetailValue(v)}
            </span>
          </div>
        ))}
        {Object.keys(details).length > 5 && (
          <div style={{ color: '#888', fontStyle: 'italic' }}>
            +{Object.keys(details).length - 5} more
          </div>
        )}
      </div>
    );
  }
  return <span>{String(details)}</span>;
}

function formatDetailValue(v) {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.length > 5 ? `[${v.length} items]` : `[${v.join(', ')}]`;
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

function actorTypeLabel(t) {
  switch (t) {
    case 'admin':   return 'Admin';
    case 'manager': return 'Manager';
    case 'rm':      return 'RM';
    case 'cp':      return 'Channel Partner';
    case 'system':  return 'System';
    default:        return t || '—';
  }
}

function categoryPill(category) {
  const palette = {
    submission:        { bg: '#DBEAFE', fg: '#1E3A8A' },
    cp_rm:             { bg: '#FEF3C7', fg: '#7C4A03' },
    note:              { bg: '#E0E7FF', fg: '#3730A3' },
    staff_user:        { bg: '#FCE7F3', fg: '#9D174D' },
    auth:              { bg: '#FEE2E2', fg: '#7F1D1D' },
  };
  const p = palette[category] || { bg: '#E5E7EB', fg: '#374151' };
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 12,
    background: p.bg, color: p.fg, fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: 0.3,
  };
}

const fLabel = { fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600 };
const textInput = {
  padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4,
  fontSize: 13, fontFamily: 'inherit', background: '#fff',
};
const th = {
  position: 'sticky',
  top: HEADER_HEIGHT + FILTER_HEIGHT,
  background: '#1a1a2e', color: '#fff',
  textAlign: 'left', padding: '10px 12px',
  fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700,
  zIndex: 10,
};
const td = { padding: '10px 12px', verticalAlign: 'top' };
const pageBtn = (disabled) => ({
  padding: '6px 10px', borderRadius: 4,
  border: '1px solid #ddd', background: '#fff',
  color: disabled ? '#bbb' : '#333',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 12, fontFamily: 'inherit',
});
