import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, downloadAdminCsv } from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { STAGES } from '../../format';
import BoardView from './BoardView';
import TableView from './TableView';
import DetailPanel from './DetailPanel';
import CpHistoryDrawer from './CpHistoryDrawer';
import BulkScheduleVisitModal from './BulkScheduleVisitModal';
import AddInventoryOnBehalf from './AddInventoryOnBehalf';
import BulkReassignRmModal from './BulkReassignRmModal';
import ExternalInventory from './ExternalInventory';
import ActivityLog from './ActivityLog';
import AdminPanel from './AdminPanel';
import WhatsAppInbox, { WaIcon } from './WhatsAppInbox';

const CITY_TABS = ['All', 'Noida', 'Gurgaon', 'Ghaziabad'];
const BHK_OPTIONS = ['', '1 BHK', '2 BHK', '3 BHK', '4 BHK', '5 BHK'];

export default function Admin() {
  const { user, logout } = useAuth();
  const isAdmin = user.role === 'admin';
  const isViewer = user.role === 'viewer';
  // `isStaff` = "has acting permissions" — gates action buttons (status
  // change, comment, bulk, reassign, on-behalf submit, schedule visit).
  // Viewers are deliberately excluded: they see the board + filters + the
  // read-only Detail Panel, but no action UI.
  const isStaff = isAdmin || user.role === 'manager' || user.role === 'rm';

  const defaultCity = isAdmin ? 'All' : user.city || 'All';
  const [city, setCity] = useState(defaultCity);
  // `searchInput` is what the user is currently typing; `search` is the
  // committed value that actually filters the list. They diverge until the
  // user presses Enter (keyboard or the Search button), at which point the
  // committed value catches up and a reload fires. This avoids a request
  // per keystroke on a multi-thousand-row dataset.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('board');
  const [submissions, setSubmissions] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Pagination state. The backend returns the top PAGE_SIZE rows of each
  // stage on the initial load; when the user scrolls a column to the bottom,
  // BoardView calls loadMoreStage(stage) to fetch the next PAGE_SIZE rows of
  // *that one stage only*. `loadedByStage` tracks how many rows we currently
  // have loaded per stage so we know the right OFFSET to send next time.
  // `loadingByStage` is the per-stage spinner gate (also dedupes rapid
  // sentinel triggers). `reloadGen` is bumped on every fresh reload so any
  // in-flight load-more from a stale filter set discards its result.
  // PAGE_SIZE is intentionally small: the initial board load fans out to
  // 7 stage queries (Unapproved/Submitted/Visit Scheduled/…/Duplicate
  // Rejected) so the on-the-wire payload and DB cost scale as
  // 7 × PAGE_SIZE. Keeping this at 15 keeps first paint snappy and avoids
  // gateway timeouts when a popular stage has thousands of rows.
  const PAGE_SIZE = 15;
  const [loadedByStage, setLoadedByStage] = useState({});
  const [loadingByStage, setLoadingByStage] = useState({});
  const reloadGen = useRef(0);
  const [selectedId, setSelectedId] = useState(null);
  const [cpHistoryId, setCpHistoryId] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Bulk select state
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkScheduleOpen, setBulkScheduleOpen] = useState(false);
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false);
  const [addingInventory, setAddingInventory] = useState(false);
  const [externalInventoryOpen, setExternalInventoryOpen] = useState(false);
  const [activityLogOpen, setActivityLogOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [whatsappInboxOpen, setWhatsappInboxOpen] = useState(false);

  // Reset window scroll whenever the user enters or leaves a full-screen
  // subview (Add Inventory on Behalf, OH Properties, Activity Logs).
  // Without this, the scrollY they left behind on one screen carries over
  // to the next, so returning to the admin board lands them mid-page.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [addingInventory, externalInventoryOpen, activityLogOpen, whatsappInboxOpen]);

  // Filter bar state
  const [showFilters, setShowFilters] = useState(false);
  const [bhk, setBhk] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rmFilter, setRmFilter] = useState('');  // '' = All RMs
  const [statusFilter, setStatusFilter] = useState('');  // '' = All

  // RM list for the filter dropdown + reassign modal. Loaded for any user
  // with admin-board access (staff OR viewer) — the dropdown is a read
  // operation, so viewers get to filter by RM too.
  const [rms, setRms] = useState([]);
  useEffect(() => {
    if (!isStaff && !isViewer) return;
    let alive = true;
    api.adminListRms()
      .then((data) => { if (alive) setRms(data?.rms || []); })
      .catch(() => { if (alive) setRms([]); });
    return () => { alive = false; };
  }, [isStaff, isViewer]);

  const activeFilterCount = [bhk, dateFrom, dateTo, rmFilter].filter(Boolean).length;

  const effectiveFilters = useMemo(() => {
    const f = {};
    if (city && city !== 'All') f.city = city;
    if (search.trim().length >= 2) f.search = search.trim();
    if (bhk) f.bhk = bhk;
    if (dateFrom) f.date_from = dateFrom;
    if (dateTo) f.date_to = dateTo;
    if (rmFilter) f.rm_id = rmFilter;
    if (statusFilter) f.status = statusFilter;
    return f;
  }, [city, search, bhk, dateFrom, dateTo, rmFilter, statusFilter]);

  const reload = useCallback(async () => {
    const myGen = ++reloadGen.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.adminListSubmissions({ ...effectiveFilters, limit: PAGE_SIZE });
      // If a newer reload (or filter change) has fired while we were waiting,
      // drop this stale response on the floor.
      if (myGen !== reloadGen.current) return;
      const subs = data.submissions || [];
      setSubmissions(subs);
      setCounts(data.counts || {});
      // Seed loadedByStage from the response so loadMoreStage knows the
      // correct starting OFFSET for each stage.
      const loaded = {};
      for (const s of subs) {
        loaded[s.status] = (loaded[s.status] || 0) + 1;
      }
      setLoadedByStage(loaded);
      setLoadingByStage({});
    } catch (err) {
      if (myGen !== reloadGen.current) return;
      setError(err.message || 'Failed to load');
    } finally {
      if (myGen === reloadGen.current) setLoading(false);
    }
  }, [effectiveFilters]);

  // Fetch the next PAGE_SIZE rows of a single stage and append. Called from
  // BoardView's per-column scroll-to-end sentinel (and TableView's bottom
  // sentinel when a status filter is active). Skip-counts on the wire so we
  // don't re-run the COUNT-per-stage aggregate on every scroll trigger —
  // counts only change when filters change, and that path goes through
  // reload() above which fetches fresh counts.
  const loadMoreStage = useCallback(async (stage) => {
    if (loadingByStage[stage]) return;
    const loaded = loadedByStage[stage] || 0;
    const total = counts[stage] || 0;
    if (loaded >= total) return;

    const myGen = reloadGen.current;
    setLoadingByStage((m) => ({ ...m, [stage]: true }));
    try {
      const data = await api.adminListSubmissions({
        ...effectiveFilters,
        status: stage,
        offset: loaded,
        limit: PAGE_SIZE,
        skip_counts: 'true',
      });
      // Stale guard: if a reload happened while we were fetching, the
      // submissions state has been reset and these rows would be junk.
      if (myGen !== reloadGen.current) return;
      const newRows = data.submissions || [];
      if (newRows.length === 0) {
        // Nothing to append — but mark as fully loaded so we stop re-firing
        // (defensive: covers the case where counts disagree with reality).
        setLoadedByStage((m) => ({ ...m, [stage]: total }));
        return;
      }
      setSubmissions((prev) => [...prev, ...newRows]);
      setLoadedByStage((m) => ({ ...m, [stage]: (m[stage] || 0) + newRows.length }));
    } catch (err) {
      // Best-effort: log and let the user retry by scrolling again.
      // eslint-disable-next-line no-console
      console.error('[loadMoreStage] failed for', stage, err);
    } finally {
      setLoadingByStage((m) => ({ ...m, [stage]: false }));
    }
  }, [loadingByStage, loadedByStage, counts, effectiveFilters]);

  // Map of stage → boolean for "are more rows available on the server?"
  // Used by BoardView/TableView to decide whether to render the sentinel.
  const hasMoreByStage = useMemo(() => {
    const m = {};
    for (const stage of Object.keys(counts)) {
      if (stage === 'Total') continue;
      m[stage] = (counts[stage] || 0) > (loadedByStage[stage] || 0);
    }
    return m;
  }, [counts, loadedByStage]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await reload();
      } catch {
        if (alive) setError('Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [reload]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadAdminCsv(effectiveFilters);
    } catch (err) {
      alert(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setBhk('');
    setDateFrom('');
    setDateTo('');
    setRmFilter('');
  };

  const toggleBulkMode = () => {
    setBulkMode(!bulkMode);
    setSelectedIds(new Set());
  };

  const toggleBulkSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleBulkAll = () => {
    if (selectedIds.size === submissions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(submissions.map((s) => s.id)));
    }
  };

  const bulkChangeStatus = async (newStatus) => {
    if (selectedIds.size === 0 || bulkBusy) return;
    if (!confirm(`Move ${selectedIds.size} submission(s) to "${newStatus}"?`)) return;
    setBulkBusy(true);
    try {
      const res = await api.adminBulkStatus(Array.from(selectedIds), newStatus);
      alert(`Updated ${res.updated}. ${res.skipped_same_status ? res.skipped_same_status + ' were already ' + newStatus + '. ' : ''}${res.out_of_scope_or_deleted ? res.out_of_scope_or_deleted + ' out of scope.' : ''}`);
      setSelectedIds(new Set());
      setBulkMode(false);
      await reload();
    } catch (err) {
      alert(err.message || 'Bulk update failed');
    } finally {
      setBulkBusy(false);
    }
  };

  // Full-screen takeover when staff is entering on-behalf inventory.
  // Returning early (rather than rendering a modal) matches the CP-side
  // AddUnit flow and avoids stacking: while in this flow, the admin board
  // bulk/filter state stays exactly where it was.
  if (addingInventory) {
    return (
      <AddInventoryOnBehalf
        onClose={async () => {
          setAddingInventory(false);
          await reload();
        }}
      />
    );
  }

  // External Data viewer (collated_data + properties). Read-only; no reload
  // of the admin board needed when closed.
  if (externalInventoryOpen) {
    return <ExternalInventory onClose={() => setExternalInventoryOpen(false)} />;
  }

  // Activity Log feed. Admin only; gated server-side too.
  if (activityLogOpen) {
    return <ActivityLog onClose={() => setActivityLogOpen(false)} />;
  }

  // WhatsApp Inbox — read-only thread view per CP phone. Same scoping
  // rules as the rest of the admin app (require_staff on the API).
  if (whatsappInboxOpen) {
    return <WhatsAppInbox onClose={() => setWhatsappInboxOpen(false)} />;
  }

  return (
    <div className="admin-root">
      {/* Top bar */}
      <div className="admin-topbar">
        <div className="admin-topbar-left">
          <img src="/logo_h.png" alt="Openhouse" className="admin-logo-mark" />
          <span className="admin-topbar-title">CP Inventory (Sourcing)</span>
        </div>
        <div className="admin-topbar-right">
          <span className="admin-topbar-env">
            {isAdmin
              ? 'Admin'
              : isViewer
                ? 'Viewer'
                : (user.isManager ? 'Manager' : 'RM')}
            {user.city ? ` · ${user.city}` : (isAdmin ? ' · All cities' : '')}
          </span>
          <div className="admin-topbar-user">
            <div className="admin-topbar-avatar">{(user.name || '?')[0]}</div>
            <span>{(user.name || '').split(' ')[0]}</span>
          </div>
          {(isStaff || isViewer) && (
            <button
              className="logout-btn wa-topbar-btn"
              onClick={() => setWhatsappInboxOpen(true)}
              title="WhatsApp Inbox — CP replies + sent reminders"
            >
              <WaIcon size={30} />
            </button>
          )}
          {isAdmin && (
            <button
              className="logout-btn"
              onClick={() => setActivityLogOpen(true)}
              title="Activity Logs — feed of all dashboard mutations"
            >
              📜
            </button>
          )}
          {isAdmin && (
            <button
              className="logout-btn"
              onClick={() => setAdminPanelOpen(true)}
              title="Admin Panel — manage staff users, permissions, force-logout"
            >
              ⚙
            </button>
          )}
          <button className="logout-btn" onClick={logout} title="Log out">⏻</button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="admin-toolbar">
        <div className="admin-toolbar-left">
          {isStaff ? (
            <div className="city-tabs">
              {CITY_TABS.map((c) => (
                <button
                  key={c}
                  className={`city-tab ${city === c ? 'active' : ''}`}
                  onClick={() => setCity(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : (
            // Viewer (or legacy RM-on-channel_partners) — locked to one city.
            <div className="admin-scope-pill">Showing {user.city} only</div>
          )}
          {/* Submitting the form is the single trigger for "search now":
              fires for both the keyboard Enter key (PC + mobile virtual
              keyboard's Go/Search action) and a click on the Search button.
              type="search" hints mobile keyboards to render a Search key
              and shows the native clear-X. */}
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput.trim());
            }}
            role="search"
          >
            <input
              type="search"
              className="search-box"
              placeholder="Search society, CP, unit, seller…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              enterKeyHint="search"
            />
            <button
              type="submit"
              className="search-btn"
              title="Search (Enter)"
            >
              Search
            </button>
          </form>
          <button
            className={`filter-toggle ${showFilters ? 'active' : ''} ${activeFilterCount > 0 ? 'has-active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
            title="More filters"
          >
            ⚙ Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>
        <div className="admin-toolbar-right">
          {isStaff && (
            <button
              className={`filter-toggle ${bulkMode ? 'active' : ''}`}
              onClick={toggleBulkMode}
              title="Select multiple to change status"
            >
              {bulkMode ? `✕ Cancel${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}` : '☐ Select'}
            </button>
          )}
          {isStaff && (
            <button
              className="filter-toggle"
              style={{ borderColor: '#FF6B2B', color: '#FF6B2B' }}
              onClick={() => setAddingInventory(true)}
              title="Add inventory on behalf of a CP"
            >
              + Add Inventory
            </button>
          )}
          {(isStaff || isViewer) && (
            <button
              className="filter-toggle"
              style={{ borderColor: '#6366F1', color: '#6366F1' }}
              onClick={() => setExternalInventoryOpen(true)}
              title="View OH Properties (collated_data + properties)"
            >
              📂 OH Properties
            </button>
          )}
          <div className="view-toggle">
            <button
              className={`view-btn ${view === 'board' ? 'active' : ''}`}
              onClick={() => setView('board')}
            >
              Board
            </button>
            <button
              className={`view-btn ${view === 'table' ? 'active' : ''}`}
              onClick={() => setView('table')}
            >
              Table
            </button>
          </div>
          <button
            className="export-btn"
            onClick={handleExport}
            disabled={exporting || submissions.length === 0}
          >
            {exporting ? 'Exporting…' : `Export ${submissions.length > 0 ? '(' + submissions.length + ')' : ''}`}
          </button>
        </div>
      </div>

      {/* Filter bar (collapsible) */}
      {showFilters && (
        <div className="admin-filter-bar">
          <div className="filter-field">
            <label>BHK</label>
            <select value={bhk} onChange={(e) => setBhk(e.target.value)}>
              {BHK_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt || 'All BHKs'}</option>
              ))}
            </select>
          </div>
          {(isStaff || isViewer) && (
            <div className="filter-field">
              <label>RM</label>
              <select value={rmFilter} onChange={(e) => setRmFilter(e.target.value)}>
                <option value="">All RMs</option>
                {rms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.is_manager ? ' (Manager)' : ''}{r.city ? ` · ${r.city}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="filter-field">
            <label>From date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="filter-field">
            <label>To date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          {activeFilterCount > 0 && (
            <button className="btn-secondary-sm" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Stats row — clickable as filters */}
      <div className="admin-stats">
        <button
          className={`stat-card ${statusFilter === '' ? 'is-active' : ''}`}
          onClick={() => setStatusFilter('')}
          style={{
            cursor: 'pointer',
            fontFamily: 'inherit',
            border: statusFilter === '' ? '2px solid #222' : undefined,
            background: statusFilter === '' ? '#f5f5f5' : undefined,
          }}
          type="button"
        >
          <div className="stat-num" style={{ color: '#222' }}>{counts.Total ?? 0}</div>
          <div className="stat-label">All</div>
        </button>
        {STAGES.filter((s) => isStaff || isViewer || !s.adminOnly).map((s) => {
          const active = statusFilter === s.key;
          return (
            <button
              key={s.key}
              className={`stat-card ${active ? 'is-active' : ''}`}
              onClick={() => setStatusFilter(active ? '' : s.key)}
              style={{
                cursor: 'pointer',
                fontFamily: 'inherit',
                border: active ? `2px solid ${s.color}` : undefined,
                background: active ? s.bg : undefined,
              }}
              type="button"
            >
              <div className="stat-num" style={{ color: s.color }}>
                {counts[s.key] ?? 0}
              </div>
              <div className="stat-label">{s.key}</div>
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: '24px 28px', color: 'var(--oh-red)', fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Bulk action bar */}
      {bulkMode && selectedIds.size > 0 && (
        <div className="bulk-action-bar">
          <span>{selectedIds.size} selected</span>
          <span style={{ fontSize: 12, color: '#666' }}>Move to:</span>
          {STAGES.filter((st) => st.key !== 'Visit Completed').map((st) => (
            <button
              key={st.key}
              className="btn-secondary-sm"
              style={{ borderColor: st.color, color: st.color }}
              onClick={() => bulkChangeStatus(st.key)}
              disabled={bulkBusy}
            >
              {st.key}
            </button>
          ))}
          <button
            className="btn-secondary-sm"
            style={{ borderColor: '#FF6B2B', color: '#FF6B2B', marginLeft: 12 }}
            onClick={() => setBulkScheduleOpen(true)}
            disabled={bulkBusy || selectedIds.size > 20}
            title={selectedIds.size > 20 ? 'Max 20 listings per bulk request' : 'Schedule visits for selected listings'}
          >
            📅 Schedule visits…
          </button>
          {(isAdmin || user.isManager) && (
            <button
              className="btn-secondary-sm"
              style={{ borderColor: '#7C3AED', color: '#7C3AED' }}
              onClick={() => setBulkReassignOpen(true)}
              disabled={bulkBusy}
              title="Reassign the selected listings, or change each CP's permanent RM"
            >
              👤 Reassign RM…
            </button>
          )}
          <button
            className="btn-secondary-sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setSelectedIds(new Set())}
            disabled={bulkBusy}
          >
            Clear selection
          </button>
        </div>
      )}

      {view === 'board' ? (
        <BoardView
          submissions={submissions}
          loading={loading}
          selectedId={selectedId}
          onSelect={setSelectedId}
          bulkMode={bulkMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleBulkSelect}
          isAdmin={isAdmin} isStaff={isStaff}
          hasMoreByStage={hasMoreByStage}
          loadingByStage={loadingByStage}
          onLoadMore={loadMoreStage}
        />
      ) : (
        <TableView
          submissions={submissions}
          loading={loading}
          selectedId={selectedId}
          onSelect={setSelectedId}
          bulkMode={bulkMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleBulkSelect}
          onToggleAll={toggleBulkAll}
          isAdmin={isAdmin} isStaff={isStaff}
          statusFilter={statusFilter}
          hasMoreByStage={hasMoreByStage}
          loadingByStage={loadingByStage}
          onLoadMore={loadMoreStage}
        />
      )}

      {selectedId && (
        <DetailPanel
          submissionId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
          onOpenCpHistory={(cpId) => setCpHistoryId(cpId)}
        />
      )}

      {cpHistoryId && (
        <CpHistoryDrawer
          cpId={cpHistoryId}
          onClose={() => setCpHistoryId(null)}
          onOpenSubmission={(sid) => {
            setCpHistoryId(null);
            setSelectedId(sid);
          }}
        />
      )}

      {bulkScheduleOpen && (
        <BulkScheduleVisitModal
          selectedSubmissions={submissions.filter((s) => selectedIds.has(s.id))}
          onClose={() => setBulkScheduleOpen(false)}
          onSuccess={async () => {
            setSelectedIds(new Set());
            setBulkMode(false);
            await reload();
          }}
        />
      )}

      {bulkReassignOpen && (
        <BulkReassignRmModal
          selectedSubmissions={submissions.filter((s) => selectedIds.has(s.id))}
          onClose={() => setBulkReassignOpen(false)}
          onSuccess={async () => {
            setSelectedIds(new Set());
            setBulkMode(false);
            await reload();
          }}
        />
      )}

      {adminPanelOpen && (
        <AdminPanel onClose={() => setAdminPanelOpen(false)} />
      )}
    </div>
  );
}