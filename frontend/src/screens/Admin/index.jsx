import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, downloadAdminCsv } from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { STAGES } from '../../format';
import BoardView from './BoardView';
import TableView from './TableView';
import DetailPanel from './DetailPanel';
import CpHistoryDrawer from './CpHistoryDrawer';

const CITY_TABS = ['All', 'Noida', 'Gurgaon', 'Ghaziabad'];
const BHK_OPTIONS = ['', '1 BHK', '2 BHK', '3 BHK', '4 BHK', '5 BHK'];

export default function Admin() {
  const { user, logout } = useAuth();
  const isAdmin = user.role === 'admin';

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

  // Filter bar state
  const [showFilters, setShowFilters] = useState(false);
  const [bhk, setBhk] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const activeFilterCount = [bhk, dateFrom, dateTo].filter(Boolean).length;

  const effectiveFilters = useMemo(() => {
    const f = {};
    if (city && city !== 'All') f.city = city;
    if (search.trim().length >= 2) f.search = search.trim();
    if (bhk) f.bhk = bhk;
    if (dateFrom) f.date_from = dateFrom;
    if (dateTo) f.date_to = dateTo;
    return f;
  }, [city, search, bhk, dateFrom, dateTo]);

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

  return (
    <div className="admin-root">
      {/* Top bar */}
      <div className="admin-topbar">
        <div className="admin-topbar-left">
          <img src="/logo_long.png" alt="Openhouse" className="admin-logo-img" />
          <span className="admin-topbar-sub">Supply Inventory</span>
        </div>
        <div className="admin-topbar-right">
          <span className="admin-topbar-env">{isAdmin ? 'Admin' : 'RM'} · {user.city || 'All cities'}</span>
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
          {isAdmin ? (
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
          {isAdmin && (
            <button
              className={`filter-toggle ${bulkMode ? 'active' : ''}`}
              onClick={toggleBulkMode}
              title="Select multiple to change status"
            >
              {bulkMode ? `✕ Cancel${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}` : '☐ Select'}
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

      {/* Stats row */}
      <div className="admin-stats">
        {STAGES.map((s) => (
          <div className="stat-card" key={s.key}>
            <div className="stat-num" style={{ color: s.color }}>
              {counts[s.key] ?? 0}
            </div>
            <div className="stat-label">{s.key}</div>
          </div>
        ))}
        <div className="stat-card">
          <div className="stat-num" style={{ color: '#222' }}>{counts.Total ?? 0}</div>
          <div className="stat-label">Total</div>
        </div>
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
    </div>
  );
}