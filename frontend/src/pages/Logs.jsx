/**
 * Activity Logs — admin-only feed of every mutation across the CP Inventory
 * Portal (status changes, RM reassignments, ticket activity, staff user mgmt,
 * CP-side actions, etc).
 *
 * Data logic ported verbatim (in spirit) from CP's `screens/Admin/
 * ActivityLog.jsx`: 300ms-debounced search, facet-driven Action/Category/
 * Actor filters (from adminListActivityLogFacets), a date range, server-side
 * pagination (PAGE_SIZE=100, HARD_CAP=500 with a "narrow your filters"
 * banner), Prev/Next via `has_more`. Same request params, same response
 * shape (`{ rows, total, has_more, cap_reached }`) — this project's own
 * backend (backend/routes/admin.py `list_activity_log`) mirrors CP's shape
 * exactly. No hooks/ dir exists in this project, so the debounce is inlined
 * (a committed-on-Enter `search`/`searchInput` split) rather than a
 * `useDebouncedValue` hook.
 *
 * Re-skinned into Direct's `.al-*` shell (single-line filter bar + sticky
 * table) instead of CP's inline-styled sticky header/filter rows.
 *
 * `Details` below covers every action this app's `log_activity()` actually
 * emits (see grep over backend/routes/*.py) with a friendly one-line
 * summary; anything uncovered (e.g. a future action) falls back to
 * `KeyValues` — up to 5 raw key:value pairs, "+N more".
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '../api';
import { formatDateTime, formatPrice } from '../format';
import Loading from '../components/Loading.jsx';
import CardDetailModal from '../components/submissions/CardDetailModal.jsx';
import { IconCalendar } from '../components/icons.jsx';

const PAGE_SIZE = 100;
const HARD_CAP = 500;

function categoryClass(cat) {
  return ({
    submission: 'cat-pill cat-inventory',
    cp_rm: 'cat-pill cat-sync',
    note: 'cat-pill cat-note',
    security: 'cat-pill cat-auth',
    society: 'cat-pill cat-society',
    staff_user: 'cat-pill cat-user',
    ticket: 'cat-pill cat-ticket',
  })[cat] || 'cat-pill cat-default';
}

function actorTypeLabel(t) {
  switch (t) {
    case 'admin': return 'Admin';
    case 'manager': return 'Manager';
    case 'rm': return 'RM';
    case 'cp': return 'Channel Partner';
    case 'system': return 'System';
    default: return t || '—';
  }
}

function formatDetailValue(v) {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.length > 5 ? `[${v.length} items]` : `[${v.join(', ')}]`;
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/** Fallback renderer — up to 5 key:value pairs, "+N more". Same shape as
 *  CP's DetailsCell default branch. */
function KeyValues({ d }) {
  if (!d || typeof d !== 'object' || Object.keys(d).length === 0) {
    return <span className="muted">—</span>;
  }
  const entries = Object.entries(d).slice(0, 5);
  return (
    <div style={{ fontSize: 12 }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 4 }}>
          <span className="muted">{k}:</span>
          <span>{formatDetailValue(v)}</span>
        </div>
      ))}
      {Object.keys(d).length > 5 && (
        <div className="muted" style={{ fontStyle: 'italic' }}>+{Object.keys(d).length - 5} more</div>
      )}
    </div>
  );
}

function Details({ row }) {
  const d = row.details || {};
  switch (row.action) {
    // ── submissions ──
    case 'status_change':
      return <>Status <b>{d.from}</b> → <b className="val-green">{d.to}</b>{d.to_reason ? ` · ${d.to_reason}` : ''}</>;
    case 'status_change_bulk':
      return <>Bulk status → <b className="val-green">{d.to}</b> · {d.updated ?? 0} updated{d.skipped_same_status ? `, ${d.skipped_same_status} skipped` : ''}</>;
    case 'comment_added':
      return <>📝 Note: {d.text}</>;
    case 'submission_edited': {
      const changes = d.changes || [];
      return <>✏️ Edited: {changes.slice(0, 3).join('; ')}{changes.length > 3 ? ` +${changes.length - 3} more` : ''}</>;
    }
    case 'submission_created':
      return <>✅ Submission created{d.initial_status ? ` · ${d.initial_status}` : ''}</>;
    case 'submission_created_on_behalf':
      return <>✅ Submitted on behalf of {d.target_cp_name}{d.submitted_by_name ? ` · by ${d.submitted_by_name}` : ''}</>;
    case 'submission_deleted':
      return <>🗑️ Submission deleted</>;
    case 'submission_withdrawn':
      return <>↩️ Withdrawn by CP</>;
    case 'asking_price_updated':
      return <>Asking price <span className="det-before">{formatPrice(d.old)}</span><span className="det-arrow"> → </span><span className="det-after">{formatPrice(d.new)}</span></>;

    // ── counter offers ──
    case 'counter_offer_sent':
      return <>💰 Counter offer sent: <b>{formatPrice(d.price_rupees)}</b></>;
    case 'counter_offer_broker_countered':
      return <>💰 CP countered: <b>{formatPrice(d.counter_price)}</b>{d.comment ? ` · ${d.comment}` : ''}</>;
    case 'counter_offer_accepted':
      return <>✅ Counter offer accepted{d.comment ? ` · ${d.comment}` : ''}</>;
    case 'counter_offer_rejected':
      return <>❌ Counter offer rejected{d.comment ? ` · ${d.comment}` : ''}</>;

    // ── visits ──
    case 'visit_scheduled':
      return <><IconCalendar size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Visit scheduled {d.schedule_date} {d.schedule_time} with {d.field_exec_name}</>;
    case 'visit_scheduled_bulk':
      return <><IconCalendar size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Bulk visit scheduled · {d.n_scheduled ?? 0} scheduled, {d.n_already_scheduled ?? 0} already set</>;
    case 'cp_visit_requested':
      return <>🙋 CP requested a visit · {d.date} {d.slot}{d.rm_name ? ` · ${d.rm_name}` : ''}</>;

    // ── media ──
    case 'cp_media_shared':
      return <>📷 Media shared · {(d.photos || []).length} photos, {(d.videos || []).length} videos</>;
    case 'cp_media_deleted':
      return <>🗑️ Video removed</>;

    // ── RM / society routing ──
    case 'cp_rm_changed':
      return <>🔁 CP's RM changed{d.new_rm_id ? ` → RM #${d.new_rm_id}` : ''}</>;
    case 'cp_rm_changed_bulk':
      return <>🔁 Bulk RM reassign → {d.target_rm_name} · {d.reassigned ?? 0} CPs</>;
    case 'listing_rm_set':
      return <>🔁 Listing RM override → {d.target_rm_name}</>;
    case 'listing_rm_cleared':
      return <>🔁 Listing RM override cleared</>;
    case 'listing_rm_set_bulk':
      return <>🔁 Bulk listing RM override → {d.target_rm_name} · {d.updated_count ?? 0} listings</>;
    case 'listing_rm_cleared_bulk':
      return <>🔁 Bulk listing RM override cleared · {d.updated_count ?? 0} listings</>;
    case 'society_rm_mapping_set':
      return <>🏘️ {d.society_name || 'Society'} mapped → {d.rm_name}</>;
    case 'society_rm_mapping_set_bulk':
      return <>🏘️ {d.society_count ?? 0} societies mapped → {d.rm_name}</>;

    // ── CP notes ──
    case 'cp_note_added':
      return <>📝 CP note: {d.text}</>;
    case 'cp_note_deleted':
      return <>🗑️ CP note deleted</>;

    // ── staff / security ──
    case 'staff_user_added':
      return <>👤 Staff user added: {d.name} ({d.role})</>;
    case 'force_logout_user':
      return <>🔒 Force-logged-out</>;
    case 'force_logout_all':
      return <>🔒 Force-logged-out all · {d.admins ?? 0} admins, {d.rms ?? 0} RMs</>;
    case 'cp_impersonation_started':
      return <>🕵️ Viewed as CP{d.impersonated_by_name ? ` · by ${d.impersonated_by_name}` : ''}</>;

    // ── tickets ──
    case 'ticket_created':
      return <>🎫 Ticket "{d.title}" raised → RM #{d.assigned_rm_id}{d.submission_id ? ` on submission #${d.submission_id}` : ''}</>;
    case 'ticket_reply':
      return <>💬 Ticket reply: {d.body}</>;
    case 'ticket_closed':
      return <>✅ Ticket #{d.ticket_id} closed</>;

    default:
      return <KeyValues d={d} />;
  }
}

function SortableTh({ field, label, sort, onSort }) {
  const active = sort.field === field;
  const arrow = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕';
  return (
    <th
      className={`al-th-sortable${active ? ' al-th-active' : ''}`}
      onClick={() => onSort(field)}
      title={`Sort by ${label}`}
    >
      {label} <span>{arrow}</span>
    </th>
  );
}

export default function Logs() {
  // `searchInput` is what the user is typing; `search` is the debounced
  // (300ms) value that actually reaches the wire — mirrors CP's
  // useDebouncedValue without needing a dedicated hook file.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [propId, setPropId] = useState(null); // submission whose detail popup is open
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [action, setAction] = useState('');
  const [category, setCategory] = useState('');
  const [actorEmail, setActorEmail] = useState('');
  const [actorName, setActorName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  // Client-only sort of the currently-loaded page. The backend's fixed
  // ORDER BY created_at DESC, id DESC has no `sort`/`dir` params, so
  // "sortable" here re-orders the ≤100 rows already on screen rather
  // than re-querying the server.
  const [sort, setSort] = useState({ field: 'created_at', dir: 'desc' });

  const [data, setData] = useState({ rows: [], total: 0, has_more: false, cap_reached: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [facets, setFacets] = useState({ actions: [], categories: [], actors: [] });

  // Actor dropdowns: derived from the facets payload, same as CP.
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
  }, [search, action, category, actorEmail, actorName, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = {
        search: search || undefined,
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
      setData(resp || { rows: [], total: 0, has_more: false, cap_reached: false });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load activity log');
    } finally {
      setLoading(false);
    }
  }, [search, action, category, actorEmail, actorName, dateFrom, dateTo, page]);

  useEffect(() => { load(); }, [load]);

  // Facets load once on mount.
  useEffect(() => {
    let alive = true;
    api.adminListActivityLogFacets().then((f) => {
      if (alive) setFacets(f || { actions: [], categories: [], actors: [] });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const total = data.total || 0;
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  function onSort(field) {
    setSort((s) => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: field === 'created_at' ? 'desc' : 'asc' }));
  }

  const sortedRows = useMemo(() => {
    const rows = data.rows ? [...data.rows] : [];
    const { field, dir } = sort;
    const key = (r) => {
      switch (field) {
        case 'created_at': return new Date(r.created_at).getTime() || 0;
        case 'entity_uid': return (r.entity_uid || '').toLowerCase();
        case 'actor': return (r.actor_name || r.actor_email || '').toLowerCase();
        case 'action': return (r.action || '').toLowerCase();
        case 'category': return (r.category || '').toLowerCase();
        default: return '';
      }
    };
    rows.sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }, [data.rows, sort]);

  return (
    <div>
      <div className="al-head">
        <div className="al-result-count">
          {loading
            ? <Loading />
            : total > 0
              ? `${total.toLocaleString()}${data.cap_reached ? '+' : ''} rows · showing ${start}–${end}`
              : 'No rows'}
        </div>
      </div>

      <div className="al-filters">
        <input
          className="al-filter-input"
          type="search"
          placeholder="Search by UID (e.g. OHLNC0091)"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setSearch(searchInput); }}
          enterKeyHint="search"
        />
        <select className="al-filter-select" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Action</option>
          {facets.actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="al-filter-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Category</option>
          {facets.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="al-filter-select" value={actorEmail} onChange={(e) => setActorEmail(e.target.value)}>
          <option value="">Actor email</option>
          {actorEmails.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="al-filter-select" value={actorName} onChange={(e) => setActorName(e.target.value)}>
          <option value="">Actor name</option>
          {actorNames.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="al-date-range">
          <span className="al-date-lbl">Date</span>
          <input type="date" className="al-date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span className="al-date-sep">to</span>
          <input type="date" className="al-date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <button type="button" className="btn-primary" onClick={() => setSearch(searchInput)}>Apply</button>
      </div>

      {data.cap_reached && (
        <div className="al-banner">Showing first {HARD_CAP} results.</div>
      )}

      {error && (
        <div className="muted" style={{ padding: '10px 0', color: 'var(--red-fg)' }}>{error}</div>
      )}

      <div className="al-table-wrap">
        <table className="al-table">
          <thead>
            <tr>
              <SortableTh field="created_at" label="Timestamp" sort={sort} onSort={onSort} />
              <SortableTh field="entity_uid" label="UID" sort={sort} onSort={onSort} />
              <SortableTh field="actor" label="Actor" sort={sort} onSort={onSort} />
              <SortableTh field="action" label="Action" sort={sort} onSort={onSort} />
              <SortableTh field="category" label="Category" sort={sort} onSort={onSort} />
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && sortedRows.length === 0 && Array.from({ length: 10 }).map((_, i) => (
              <tr key={`sk-${i}`} className="inv-row-skel">
                {Array.from({ length: 6 }).map((_, c) => (
                  <td key={c}><span className="inv-skel" style={{ width: `${50 + (c * 11) % 40}%` }} /></td>
                ))}
              </tr>
            ))}
            {sortedRows.length === 0 && !loading && (
              <tr>
                <td className="al-empty" colSpan={6}>No activity matches these filters.</td>
              </tr>
            )}
            {sortedRows.map((r) => (
              <tr key={r.id}>
                <td className="al-ts">{formatDateTime(r.created_at)}</td>
                <td className="al-uid">
                  {r.entity_uid
                    ? (r.entity_type === 'submission' && r.entity_id
                      // Log rows carry the numeric entity_id, so a submission UID
                      // opens its detail popup directly (CardDetailModal by id).
                      ? <button type="button" className="btn-link al-uid-link" onClick={() => setPropId(r.entity_id)}>{r.entity_uid}</button>
                      : r.entity_uid)
                    : <span className="muted">—</span>}
                </td>
                <td>
                  <div className="al-actor-name">{r.actor_name || actorTypeLabel(r.actor_type)}</div>
                  {(r.actor_email || r.actor_phone) && (
                    <div className="al-actor-email">{r.actor_email || r.actor_phone}</div>
                  )}
                </td>
                <td className="al-action"><code>{r.action}</code></td>
                <td><span className={categoryClass(r.category)}>{r.category}</span></td>
                <td><Details row={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >‹ Prev</button>
          <span className="muted" style={{ fontSize: 12 }}>
            Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setPage((p) => p + 1)}
            disabled={!data.has_more || loading}
          >Next ›</button>
        </div>
      )}

      {propId && <CardDetailModal id={propId} canAct onClose={() => setPropId(null)} />}
    </div>
  );
}
