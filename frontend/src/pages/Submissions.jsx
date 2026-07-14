import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';

import { api, downloadAdminCsv } from '../api';
import { useAuth } from '../contexts/AuthContext.jsx';
import { STAGES } from '../format';
import { IconSearch, IconFilter, IconDownload } from '../components/icons.jsx';
import BoardView from '../components/submissions/BoardView.jsx';
import TableView from '../components/submissions/TableView.jsx';
import CardDetailModal from '../components/submissions/CardDetailModal.jsx';
import FilterModal from '../components/submissions/FilterModal.jsx';
import BulkBar from '../components/submissions/BulkBar.jsx';
import AddInventoryOnBehalf from '../components/submissions/AddInventoryOnBehalf.jsx';
import SegToggle from '../components/SegToggle.jsx';
import Loading from '../components/Loading.jsx';

const CITY_TABS = ['All', 'Noida', 'Gurgaon', 'Ghaziabad'];

export default function Submissions() {
  const { user } = useAuth();
  // Deep-link from Home: ?status=<stage> opens the board filtered to that stage
  // in table view. Read once to seed initial state (below).
  const [searchParams] = useSearchParams();
  const isAdmin = user.role === 'admin';
  const isManager = user.role === 'manager';
  const isViewer = user.role === 'viewer';
  // `isStaff` = "has acting permissions" — gates action buttons (bulk select,
  // CSV-independent actions, on-behalf submit). Viewers see the board/table +
  // filters + a read-only detail view, but no action UI.
  const isStaff = isAdmin || user.role === 'manager' || user.role === 'rm';
  // Convenience alias used by future sections (BoardView/TableView cards,
  // FilterModal, BulkBar) to gate anything mutating.
  const canAct = isStaff && !isViewer;

  const defaultCity = isAdmin ? 'All' : user.city || 'All';
  const [city, setCity] = useState(defaultCity);
  // `searchInput` is what the user is currently typing; `search` is the
  // committed value that actually filters the list. They diverge until the
  // user presses Enter (keyboard or the Search button), at which point the
  // committed value catches up and a reload fires. This avoids a request
  // per keystroke on a multi-thousand-row dataset.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('table');
  const [submissions, setSubmissions] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Pagination state. The backend returns the top PAGE_SIZE rows of each
  // stage on the initial load; when the user scrolls a column to the bottom,
  // BoardView (P3.3) calls loadMoreStage(stage) to fetch the next PAGE_SIZE
  // rows of *that one stage only*. `loadedByStage` tracks how many rows we
  // currently have loaded per stage so we know the right OFFSET to send
  // next time. `loadingByStage` is the per-stage spinner gate (also dedupes
  // rapid sentinel triggers). `reloadGen` is bumped on every fresh reload so
  // any in-flight load-more from a stale filter set discards its result.
  const PAGE_SIZE = 15;
  const [loadedByStage, setLoadedByStage] = useState({});
  const [loadingByStage, setLoadingByStage] = useState({});
  const reloadGen = useRef(0);

  // Bulk select state. BulkBar (P3.5) will render the actual action bar.
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Which submission's detail modal is open (board-card click). Table view
  // uses its own inline row-expand instead of this.
  const [selectedId, setSelectedId] = useState(null);

  const onToggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Table's header "select all" checkbox — toggles every currently-loaded
  // (visible) row, matching CP's onToggleAll semantics.
  const onToggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const ids = submissions.map((s) => s.id);
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }, [submissions]);

  // On-behalf "Add Inventory" flow — the trigger button lives in the topbar
  // (Layout) and fires this window event; the AddInventoryOnBehalf popup below
  // handles city → CP → form and posts via /admin/submissions/on-behalf.
  const [addingInventory, setAddingInventory] = useState(false);
  useEffect(() => {
    const open = () => setAddingInventory(true);
    window.addEventListener('submissions:add-inventory', open);
    return () => window.removeEventListener('submissions:add-inventory', open);
  }, []);

  // Filter bar state. FilterModal (P3.4) will render the actual UI for these.
  const [showFilters, setShowFilters] = useState(false);
  // Layout's topbar portal target — Select + Download CSV render into it so
  // they sit on the top strip while keeping their live state here.
  const [topbarSlot, setTopbarSlot] = useState(null);
  useEffect(() => { setTopbarSlot(document.getElementById('topbar-actions')); }, []);
  const [bhk, setBhk] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rmFilter, setRmFilter] = useState(''); // '' = All RMs
  // Multi-select stage filter: an array of stage keys (client-side union).
  // [] = All. Deep-links may pass a comma list (?status=Unapproved,Submitted).
  const [statusFilter, setStatusFilter] = useState(() => {
    const s = searchParams.get('status');
    return s ? s.split(',').filter(Boolean) : [];
  });
  const toggleStatus = (key) => setStatusFilter((prev) => (
    prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
  ));

  // Client-only refinements (FilterModal, P3.4) — CP's admin API has no
  // server params for these, so they post-filter the already-loaded rows
  // (see `clientFilteredSubmissions` below) instead of reaching the wire.
  const [matchTypes, setMatchTypes] = useState([]); // subset of perfect/collated/submissions/weak
  const [missingInfo, setMissingInfo] = useState([]); // subset of no_asking_price/no_seller
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [ohPriceFilter, setOhPriceFilter] = useState(''); // '' | 'has' | 'check'
  const [rejectReasons, setRejectReasons] = useState([]);

  // RM list for the filter dropdown (FilterModal) — loaded for any user with
  // board access (staff OR viewer); it's a read operation, so viewers get to
  // filter by RM too.
  const [rms, setRms] = useState([]);
  useEffect(() => {
    if (!isStaff && !isViewer) return;
    let alive = true;
    api.adminListRms()
      .then((data) => { if (alive) setRms(data?.rms || []); })
      .catch(() => { if (alive) setRms([]); });
    return () => { alive = false; };
  }, [isStaff, isViewer]);

  const clientFilterCount = [
    matchTypes.length > 0,
    missingInfo.length > 0,
    priceMin !== '' || priceMax !== '',
    !!ohPriceFilter,
    rejectReasons.length > 0,
  ].filter(Boolean).length;
  const activeFilterCount = [bhk, dateFrom, dateTo, rmFilter].filter(Boolean).length + clientFilterCount;

  // Post-filter the loaded rows for the client-only refinements above. Runs
  // after every server reload/load-more, over whatever's currently in
  // `submissions` — cheap, since it's at most a few hundred rows in memory.
  const clientFilteredSubmissions = useMemo(() => {
    const statusSet = statusFilter.length > 0 ? new Set(statusFilter) : null;
    if (clientFilterCount === 0 && !statusSet) return submissions;
    return submissions.filter((s) => {
      // Stage filter is client-side now (multi-select union) — the backend
      // `status` param only takes a single stage, so we post-filter instead.
      if (statusSet && !statusSet.has(s.status)) return false;
      if (matchTypes.length > 0) {
        const flags = {
          perfect: s.perfect_match_at_submit === true,
          collated: s.collated_match === true,
          submissions: s.submissions_match === true,
          weak: s.weak_match === true,
        };
        if (!matchTypes.some((t) => flags[t])) return false;
      }
      if (missingInfo.length > 0) {
        const flags = {
          no_asking_price: !s.asking_price,
          no_seller: !s.seller_name,
        };
        if (!missingInfo.some((t) => flags[t])) return false;
      }
      if (priceMin !== '' && (Number(s.asking_price) || 0) < Number(priceMin)) return false;
      if (priceMax !== '' && (Number(s.asking_price) || 0) > Number(priceMax)) return false;
      if (ohPriceFilter) {
        const state = s.oh_state;
        if (ohPriceFilter === 'has' && state !== 'match') return false;
        if (ohPriceFilter === 'check' && !(state && state !== 'match')) return false;
      }
      if (rejectReasons.length > 0 && !rejectReasons.includes(s.status_reason)) return false;
      return true;
    });
  }, [submissions, statusFilter, clientFilterCount, matchTypes, missingInfo, priceMin, priceMax, ohPriceFilter, rejectReasons]);

  // The stage filter is client-side for BOTH views now (multi-select union) —
  // reload always fetches every stage's first page and `clientFilteredSubmissions`
  // post-filters to the selected stages. `status` never reaches the wire (the
  // backend only accepts a single stage anyway); per-stage load-more still uses
  // it, keyed by the specific stage being paginated.
  const effectiveFilters = useMemo(() => {
    const f = {};
    if (city && city !== 'All') f.city = city;
    if (search.trim().length >= 2) f.search = search.trim();
    if (bhk) f.bhk = bhk;
    if (dateFrom) f.date_from = dateFrom;
    if (dateTo) f.date_to = dateTo;
    if (rmFilter) f.rm_id = rmFilter;
    return f;
  }, [city, search, bhk, dateFrom, dateTo, rmFilter]);

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
  // sentinel when a status filter is active) once P3.3 wires those views up.
  // Skip-counts on the wire so we don't re-run the COUNT-per-stage aggregate
  // on every scroll trigger — counts only change when filters change, and
  // that path goes through reload() above which fetches fresh counts.
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

  const toggleBulkMode = () => {
    setBulkMode(!bulkMode);
    setSelectedIds(new Set());
  };

  return (
    <div>
      <div className="page-head">
        <h2>Submissions</h2>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        {isStaff ? (
          <div className="city-tabs">
            {CITY_TABS.map((c) => (
              <button
                key={c}
                type="button"
                className={`tab${city === c ? ' tab-active' : ''}`}
                onClick={() => setCity(c)}
              >
                {c}
              </button>
            ))}
          </div>
        ) : (
          <div className="muted">Showing {user.city} only</div>
        )}

        {/* Search elongates (flex:1, follows the sidebar) and pins to the right
            next to Filters. Submitting the form is the single "search now"
            trigger (Enter or the Search button). */}
        <form
          className="search-form"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <input
            type="search"
            placeholder="Search society, CP, unit, seller…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            enterKeyHint="search"
          />
          <button type="submit" className="btn-primary" title="Search (Enter)">
            <IconSearch size={15} /> Search
          </button>
        </form>

        <button
          type="button"
          className={`btn-ghost${showFilters ? ' btn-soft' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
          title="More filters"
        >
          <IconFilter size={15} /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>

        {/* Board/Table toggle — last, after Filters. */}
        <SegToggle
          options={[{ value: 'board', label: 'Board' }, { value: 'table', label: 'Table' }]}
          value={view}
          onChange={setView}
        />
      </div>

      {/* Select + Download CSV live on the top strip (Layout), portaled so they
          keep their live labels (Cancel (n) / Exporting…). Add Inventory is
          rendered by Layout for this page. */}
      {topbarSlot && createPortal(
        <>
          {canAct && (
            <button
              type="button"
              className={`btn-ghost${bulkMode ? ' btn-soft' : ''}`}
              onClick={toggleBulkMode}
              title="Select multiple to change status"
            >
              {bulkMode ? `Cancel${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}` : 'Select'}
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              className="btn-ghost"
              onClick={handleExport}
              disabled={exporting || !counts.Total}
              title="Download the current filtered result set as CSV"
            >
              <IconDownload size={15} /> {exporting ? 'Exporting…' : 'Download CSV'}
            </button>
          )}
        </>,
        topbarSlot,
      )}

      <FilterModal
        open={showFilters}
        initial={{
          bhk, dateFrom, dateTo, rmFilter, statusFilter,
          matchTypes, missingInfo, priceMin, priceMax, ohPrice: ohPriceFilter, rejectReasons,
        }}
        rms={rms}
        canFilterRm={isAdmin || isManager}
        isStaff={isStaff}
        isViewer={isViewer}
        onClose={() => setShowFilters(false)}
        onApply={(applied) => {
          setBhk(applied.bhk);
          setDateFrom(applied.dateFrom);
          setDateTo(applied.dateTo);
          setRmFilter(applied.rmFilter);
          setStatusFilter(applied.statusFilter);
          setMatchTypes(applied.matchTypes);
          setMissingInfo(applied.missingInfo);
          setPriceMin(applied.priceMin);
          setPriceMax(applied.priceMax);
          setOhPriceFilter(applied.ohPrice);
          setRejectReasons(applied.rejectReasons);
          setShowFilters(false);
        }}
      />

      {addingInventory && (
        <AddInventoryOnBehalf
          onClose={() => setAddingInventory(false)}
          onCreated={reload}
        />
      )}

      {/* Stage count pills — multi-select status filter. Click stages to union
          them (Unapproved + Submitted shows both); "All" clears the selection.
          Filtering is client-side for both views. */}
      <div className="stage-counts">
        <div className="stage-pills">
          <button
            type="button"
            className={`count-pill${statusFilter.length === 0 ? ' count-pill-active' : ''}`}
            onClick={() => setStatusFilter([])}
          >
            <span className="num">{counts.Total ?? 0}</span>
            <span className="lbl">All</span>
          </button>
          {STAGES.filter((s) => isStaff || isViewer || !s.adminOnly).map((s) => {
            const active = statusFilter.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                className={`count-pill${active ? ' count-pill-active' : ''}`}
                onClick={() => toggleStatus(s.key)}
              >
                <span className="num" style={{ color: s.color }}>{counts[s.key] ?? 0}</span>
                <span className="lbl">{s.label || s.key}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="muted" style={{ padding: '10px 0', color: 'var(--red-fg)' }}>
          {error}
        </div>
      )}

      <BulkBar
        bulkMode={bulkMode}
        selectedIds={selectedIds}
        submissions={submissions}
        setSelectedIds={setSelectedIds}
        onClearSelection={() => setSelectedIds(new Set())}
        onExitBulkMode={() => setBulkMode(false)}
        onChanged={reload}
        canReassign={isAdmin || isManager}
      />

      {!loading && clientFilteredSubmissions.length === 0 ? (
        <div className="empty-state">No submissions match these filters.</div>
      ) : view === 'board' ? (
        <BoardView
          submissions={clientFilteredSubmissions}
          loading={loading}
          selectedId={selectedId}
          onOpen={setSelectedId}
          bulkMode={bulkMode}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          isStaff={isStaff}
          isViewer={isViewer}
          statusFilter={statusFilter}
          counts={counts}
          loadedByStage={loadedByStage}
          loadingByStage={loadingByStage}
          onLoadMore={loadMoreStage}
        />
      ) : (
        <TableView
          submissions={clientFilteredSubmissions}
          loading={loading}
          counts={counts}
          loadedByStage={loadedByStage}
          loadingByStage={loadingByStage}
          onLoadMore={loadMoreStage}
          canAct={canAct}
          bulkMode={bulkMode}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onToggleAll={onToggleAll}
          statusFilter={statusFilter}
          onOpenSubmission={setSelectedId}
        />
      )}

      <CardDetailModal id={selectedId} canAct={canAct} onClose={() => setSelectedId(null)} />
    </div>
  );
}
