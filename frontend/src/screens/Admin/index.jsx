import { useCallback, useEffect, useMemo, useState } from 'react';

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

const CITY_TABS = ['All', 'Noida', 'Gurgaon', 'Ghaziabad'];
const BHK_OPTIONS = ['', '1 BHK', '2 BHK', '3 BHK', '4 BHK', '5 BHK'];

export default function Admin() {
  const { user, logout } = useAuth();
  const isAdmin = user.role === 'admin';
  // Managers and RMs get the same UI powers as admin — only the scope differs
  // (backend already enforces "CPs under you only"). `isAdmin` remains for the
  // display label, `isStaff` is for feature-visibility gates.
  const isStaff = isAdmin || user.role === 'manager' || user.role === 'rm';

  const defaultCity = isAdmin ? 'All' : user.city || 'All';
  const [city, setCity] = useState(defaultCity);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('board');
  const [submissions, setSubmissions] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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

  // Filter bar state
  const [showFilters, setShowFilters] = useState(false);
  const [bhk, setBhk] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rmFilter, setRmFilter] = useState('');  // '' = All RMs
  const [statusFilter, setStatusFilter] = useState('');  // '' = All

  // RM list for the filter dropdown + reassign modal. Loaded once for staff users.
  const [rms, setRms] = useState([]);
  useEffect(() => {
    if (!isStaff) return;
    let alive = true;
    api.adminListRms()
      .then((data) => { if (alive) setRms(data?.rms || []); })
      .catch(() => { if (alive) setRms([]); });
    return () => { alive = false; };
  }, [isStaff]);

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
    setLoading(true);
    setError(null);
    try {
      const data = await api.adminListSubmissions(effectiveFilters);
      setSubmissions(data.submissions || []);
      setCounts(data.counts || {});
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [effectiveFilters]);

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

  return (
    <div className="admin-root">
      {/* Top bar */}
      <div className="admin-topbar">
        <div className="admin-topbar-left">
          <img src="/logo_long.png" alt="Openhouse" className="admin-logo-img" />
          <span className="admin-topbar-sub">Supply Inventory</span>
        </div>
        <div className="admin-topbar-right">
          <span className="admin-topbar-env">
            {isAdmin ? 'Admin' : (user.isManager ? 'Manager' : 'RM')}
            {user.city ? ` · ${user.city}` : (isAdmin ? ' · All cities' : '')}
          </span>
          <div className="admin-topbar-user">
            <div className="admin-topbar-avatar">{(user.name || '?')[0]}</div>
            <span>{(user.name || '').split(' ')[0]}</span>
          </div>
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
            <div className="admin-scope-pill">Showing {user.city} only</div>
          )}
          <input
            className="search-box"
            placeholder="Search society, CP, unit, seller…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
          {isStaff && (
            <button
              className="filter-toggle"
              style={{ borderColor: '#6366F1', color: '#6366F1' }}
              onClick={() => setExternalInventoryOpen(true)}
              title="View OH Data (collated_data + properties)"
            >
              📂 OH Data
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
          {isStaff && (
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
        {STAGES.filter((s) => isStaff || !s.adminOnly).map((s) => {
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
          {STAGES.map((st) => (
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
          {isAdmin && (
            <button
              className="btn-secondary-sm"
              style={{ borderColor: '#7C3AED', color: '#7C3AED' }}
              onClick={() => setBulkReassignOpen(true)}
              disabled={bulkBusy}
              title="Move the selected CPs to a different RM (admin only)"
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
    </div>
  );
}