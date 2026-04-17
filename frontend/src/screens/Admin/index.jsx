import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, downloadAdminCsv } from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { STAGES } from '../../format';
import BoardView from './BoardView';
import TableView from './TableView';
import DetailPanel from './DetailPanel';

const CITY_TABS = ['All', 'Noida', 'Gurgaon', 'Ghaziabad'];

export default function Admin() {
  const { user, logout } = useAuth();
  const isAdmin = user.role === 'admin';

  // Admin can switch cities; RMs are locked to their own.
  const defaultCity = isAdmin ? 'All' : user.city || 'All';
  const [city, setCity] = useState(defaultCity);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('board');
  const [submissions, setSubmissions] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [exporting, setExporting] = useState(false);

  const effectiveFilters = useMemo(() => {
    const f = {};
    if (city && city !== 'All') f.city = city;
    if (search.trim().length >= 2) f.search = search.trim();
    return f;
  }, [city, search]);

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
    return () => {
      alive = false;
    };
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
            placeholder="Search society, CP, unit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="admin-toolbar-right">
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

      {view === 'board' ? (
        <BoardView
          submissions={submissions}
          loading={loading}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      ) : (
        <TableView
          submissions={submissions}
          loading={loading}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}

      {selectedId && (
        <DetailPanel
          submissionId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}