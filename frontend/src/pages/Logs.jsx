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
import { createPortal } from 'react-dom';

import { ApiError, api } from '../api';
import { useStickyState } from '../hooks/useStickyState.js';
import { formatDateTime, formatPrice } from '../format';
import Loading from '../components/Loading.jsx';
import CardDetailModal from '../components/submissions/CardDetailModal.jsx';
import {
  IconCalendar, IconNote, IconEdit, IconCheck, IconTrash, IconUndo, IconToken,
  IconRejected, IconHandRaise, IconCamera, IconReload, IconBuilding, IconProfile,
  IconLock, IconEye, IconTicket, IconChat,
  IconArrowUp, IconArrowDown, IconArrowRight, IconSort,
} from '../components/icons.jsx';

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

// Every Details line opens with a small icon on the text baseline. One wrapper
// so the size + alignment isn't restated at each of the 25 call sites.
const DIcon = ({ icon: I }) => <I size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />;

function Details({ row }) {
  const d = row.details || {};
  switch (row.action) {
    // ── submissions ──
    case 'status_change':
      return <>Status <b>{d.from}</b> <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} /> <b className="val-green">{d.to}</b>{d.to_reason ? ` · ${d.to_reason}` : ''}</>;
    case 'status_change_bulk':
      return <>Bulk status <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} /> <b className="val-green">{d.to}</b> · {d.updated ?? 0} updated{d.skipped_same_status ? `, ${d.skipped_same_status} skipped` : ''}</>;
    case 'comment_added':
      return <><DIcon icon={IconNote} />Note: {d.text}</>;
    case 'submission_edited': {
      const changes = d.changes || [];
      return <><DIcon icon={IconEdit} />Edited: {changes.slice(0, 3).join('; ')}{changes.length > 3 ? ` +${changes.length - 3} more` : ''}</>;
    }
    case 'submission_created':
      return <><DIcon icon={IconCheck} />Submission created{d.initial_status ? ` · ${d.initial_status}` : ''}</>;
    case 'submission_created_on_behalf':
      return <><DIcon icon={IconCheck} />Submitted on behalf of {d.target_cp_name}{d.submitted_by_name ? ` · by ${d.submitted_by_name}` : ''}</>;
    case 'submission_deleted':
      return <><DIcon icon={IconTrash} />Submission deleted</>;
    case 'submission_withdrawn':
      return <><DIcon icon={IconUndo} />Withdrawn by CP</>;
    case 'asking_price_updated':
      return <>Asking price <span className="det-before">{formatPrice(d.old)}</span><span className="det-arrow"> <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} /> </span><span className="det-after">{formatPrice(d.new)}</span></>;

    // ── counter offers ──
    case 'counter_offer_sent':
      return <><DIcon icon={IconToken} />Counter offer sent: <b>{formatPrice(d.price_rupees)}</b></>;
    case 'counter_offer_broker_countered':
      return <><DIcon icon={IconToken} />CP countered: <b>{formatPrice(d.counter_price)}</b>{d.comment ? ` · ${d.comment}` : ''}</>;
    case 'counter_offer_accepted':
      return <><DIcon icon={IconCheck} />Counter offer accepted{d.comment ? ` · ${d.comment}` : ''}</>;
    case 'counter_offer_rejected':
      return <><DIcon icon={IconRejected} />Counter offer rejected{d.comment ? ` · ${d.comment}` : ''}</>;

    // ── visits ──
    case 'visit_scheduled':
      return <><DIcon icon={IconCalendar} />Visit scheduled {d.schedule_date} {d.schedule_time} with {d.field_exec_name}</>;
    case 'visit_scheduled_bulk':
      return <><DIcon icon={IconCalendar} />Bulk visit scheduled · {d.n_scheduled ?? 0} scheduled, {d.n_already_scheduled ?? 0} already set</>;
    case 'cp_visit_requested':
      return <><DIcon icon={IconHandRaise} />CP requested a visit · {d.date} {d.slot}{d.rm_name ? ` · ${d.rm_name}` : ''}</>;

    // ── media ──
    case 'cp_media_shared':
      return <><DIcon icon={IconCamera} />Media shared · {(d.photos || []).length} photos, {(d.videos || []).length} videos</>;
    case 'cp_media_deleted':
      return <><DIcon icon={IconTrash} />Video removed</>;

    // ── RM / society routing ──
    case 'cp_rm_changed':
      return <><DIcon icon={IconReload} />CP's RM changed{d.new_rm_id ? <> <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} /> RM #{d.new_rm_id}</> : ''}</>;
    case 'cp_rm_changed_bulk':
      return <><DIcon icon={IconReload} />Bulk RM reassign <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} /> {d.target_rm_name} · {d.reassigned ?? 0} CPs</>;
    case 'listing_rm_set':
      return <><DIcon icon={IconReload} />Listing RM override <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} /> {d.target_rm_name}</>;
    case 'listing_rm_cleared':
      return <><DIcon icon={IconReload} />Listing RM override cleared</>;
    case 'listing_rm_set_bulk':
      return <><DIcon icon={IconReload} />Bulk listing RM override <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} /> {d.target_rm_name} · {d.updated_count ?? 0} listings</>;
    case 'listing_rm_cleared_bulk':
      return <><DIcon icon={IconReload} />Bulk listing RM override cleared · {d.updated_count ?? 0} listings</>;
    case 'society_rm_mapping_set':
      return <><DIcon icon={IconBuilding} />{d.society_name || 'Society'} mapped <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} /> {d.rm_name}</>;
    case 'society_rm_mapping_set_bulk':
      return <><DIcon icon={IconBuilding} />{d.society_count ?? 0} societies mapped <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} /> {d.rm_name}</>;

    // ── CP notes ──
    case 'cp_note_added':
      return <><DIcon icon={IconNote} />CP note: {d.text}</>;
    case 'cp_note_deleted':
      return <><DIcon icon={IconTrash} />CP note deleted</>;

    // ── staff / security ──
    case 'staff_user_added':
      return <><DIcon icon={IconProfile} />Staff user added: {d.name} ({d.role})</>;
    case 'force_logout_user':
      return <><DIcon icon={IconLock} />Force-logged-out</>;
    case 'force_logout_all':
      return <><DIcon icon={IconLock} />Force-logged-out all · {d.admins ?? 0} admins, {d.rms ?? 0} RMs</>;
    case 'cp_impersonation_started':
      return <><DIcon icon={IconEye} />Viewed as CP{d.impersonated_by_name ? ` · by ${d.impersonated_by_name}` : ''}</>;

    // ── tickets ──
    case 'ticket_created':
      return <><DIcon icon={IconTicket} />Ticket "{d.title}" raised <IconArrowRight size={12} style={{ verticalAlign: '-2px' }} /> RM #{d.assigned_rm_id}{d.submission_id ? ` on submission #${d.submission_id}` : ''}</>;
    case 'ticket_reply':
      return <><DIcon icon={IconChat} />Ticket reply: {d.body}</>;
    case 'ticket_closed':
      return <><DIcon icon={IconCheck} />Ticket #{d.ticket_id} closed</>;

    default:
      return <KeyValues d={d} />;
  }
}

function SortableTh({ field, label, sort, onSort }) {
  const active = sort.field === field;
  // Sort state as an icon rather than ▲/▼/↕ text glyphs — those render in the
  // font's fallback and sit at a different weight to every other icon in the
  // table chrome.
  const SortIcon = active ? (sort.dir === 'asc' ? IconArrowUp : IconArrowDown) : IconSort;
  return (
    <th
      className={`al-th-sortable${active ? ' al-th-active' : ''}`}
      onClick={() => onSort(field)}
      title={`Sort by ${label}`}
    >
      {label} <SortIcon size={11} style={{ verticalAlign: '-1px', opacity: active ? 1 : 0.4 }} />
    </th>
  );
}

export default function Logs() {
  // `searchInput` is what the user is typing; `search` is the debounced
  // (300ms) value that actually reaches the wire — mirrors CP's
  // useDebouncedValue without needing a dedicated hook file.
  // Filter selections are sticky (localStorage, see useStickyState) so leaving
  // the page and coming back restores what was applied. `page` is deliberately
  // NOT sticky — returning to page 7 of a list you no longer remember filtering
  // is disorienting, and the rows will have shifted anyway.
  const [search, setSearch] = useStickyState('logs.search', '');
  const [searchInput, setSearchInput] = useState(search);
  const [propId, setPropId] = useState(null); // submission whose detail popup is open
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [action, setAction] = useStickyState('logs.action', '');
  const [category, setCategory] = useStickyState('logs.category', '');
  const [actorEmail, setActorEmail] = useStickyState('logs.actorEmail', '');
  const [actorName, setActorName] = useStickyState('logs.actorName', '');
  const [dateFrom, setDateFrom] = useStickyState('logs.dateFrom', '');
  const [dateTo, setDateTo] = useStickyState('logs.dateTo', '');
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

  // Layout's topbar portal target — the row count renders into it so it sits
  // on the "Activity Logs" strip (right of .topbar-spacer = right-aligned)
  // while keeping its live state here.
  const [topbarSlot, setTopbarSlot] = useState(null);
  useEffect(() => { setTopbarSlot(document.getElementById('topbar-actions')); }, []);

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
      {topbarSlot && createPortal(
        <div className="al-result-count">
          {loading
            ? <Loading />
            : total > 0
              ? `${total.toLocaleString()}${data.cap_reached ? '+' : ''} rows · showing ${start}–${end}`
              : 'No rows'}
        </div>,
        topbarSlot,
      )}

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
