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
import SegmentedTabs from '../components/SegmentedTabs.jsx';
import { matchesClientFilters } from '../components/submissions/clientFilters.js';
import AddInventoryOnBehalf from '../components/submissions/AddInventoryOnBehalf.jsx';
import SegToggle from '../components/SegToggle.jsx';
import Loading from '../components/Loading.jsx';

const CITY_TABS = ['All', 'Noida', 'Gurgaon', 'Ghaziabad'];

// Server tops out at LIMIT 5000 in _list_submissions_core — the same number the
// bulk-status cap uses. One source of truth; the label renders from it.
const SELECT_ALL_CAP = 5000;

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
  // Bumped on every filter change (server or client — see `filterKey` below)
  // so an in-flight onSelectAll can detect that the filter moved under it.
  // Must be a ref, not the filterKey string itself: a plain const is
  // captured per-closure, so comparing it to itself inside one invocation
  // always matches and guards nothing.
  const clientFilterGen = useRef(0);

  // Bulk select state. BulkBar (P3.5) will render the actual action bar.
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectAllNote, setSelectAllNote] = useState('');

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

  // The client-only filter values, bundled once so both the memo below and
  // onSelectAll (Task 4) feed the SAME object to the SAME predicate.
  const clientFilters = useMemo(() => ({
    statusFilter, matchTypes, missingInfo, priceMin, priceMax, ohPriceFilter, rejectReasons,
  }), [statusFilter, matchTypes, missingInfo, priceMin, priceMax, ohPriceFilter, rejectReasons]);

  // Post-filter the loaded rows for the client-only refinements above. Runs
  // after every server reload/load-more, over whatever's currently in
  // `submissions` — cheap, since it's at most a few hundred rows in memory.
  const clientFilteredSubmissions = useMemo(() => {
    if (clientFilterCount === 0 && statusFilter.length === 0) return submissions;
    return submissions.filter((s) => matchesClientFilters(s, clientFilters));
  }, [submissions, clientFilterCount, statusFilter, clientFilters]);

  // Table's header "select all" checkbox — toggles every currently-loaded
  // *visible* row. Must read `clientFilteredSubmissions`, not `submissions`:
  // the latter holds every stage's loaded rows, so selecting from it would
  // grab rows the active filter is hiding. Defined after that memo (its deps
  // reference it, which would hit the TDZ if this stayed above).
  const onToggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const ids = clientFilteredSubmissions.map((s) => s.id);
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }, [clientFilteredSubmissions]);

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

  // A selection must never outlive the filter it was made under. BOTH the
  // server-side filters (city/search/bhk/date range/RM — effectiveFilters)
  // and the client-only refinements (stage/match-type/price/etc.) change
  // which rows are visible; `selectedIds` must not survive either kind of
  // change, since bulk actions POST those ids verbatim. Keying on
  // `effectiveFilters` too — not just the client-side values — is what
  // stops a bulk action from mutating rows that a server-filter change
  // (e.g. switching the city tab) hid from view. `effectiveFilters` is a
  // new object every render, but it's plain data, so JSON.stringify-ing it
  // into the key is safe and gives the effect a stable primitive dep.
  //
  // Also clears any leftover Select-all note here: a stale "capped at 5000"
  // or "Select all failed" message must not sit next to a selection that
  // this same filter change just wiped.
  //
  // Defined below `effectiveFilters` (not up near the other filter state,
  // despite that being the more natural home) — it closes over
  // `effectiveFilters`, and that identifier is in the TDZ until its own
  // `const` line runs earlier in this render. Same ordering constraint
  // `onSelectAll` documents below.
  //
  // Bumps `clientFilterGen`, never `reloadGen` — this ref exists purely so
  // `onSelectAll` can detect "the filter changed while my fetch was in
  // flight" independently of `reload`'s own generation counter.
  const filterKey = JSON.stringify([
    effectiveFilters,
    statusFilter, matchTypes, missingInfo, priceMin, priceMax, ohPriceFilter, rejectReasons,
  ]);
  useEffect(() => {
    clientFilterGen.current += 1;
    setSelectedIds(new Set());
    setSelectAllNote('');
  }, [filterKey]);

  // "Select all": fetch EVERY row matching the server filters, then select the
  // ones that also pass the client-only refinements.
  //
  // It filters `rows` directly rather than reading `clientFilteredSubmissions`:
  // that memo has not recomputed yet at this point in the handler, so it still
  // holds the pre-fetch page — selecting from it would silently select the old
  // rows. Same predicate, so selection and view cannot disagree.
  //
  // Defined below `effectiveFilters` (not immediately after
  // `clientFilteredSubmissions`, despite that being the more natural home) —
  // it closes over `effectiveFilters`, and that identifier is in the TDZ until
  // its own `const` line runs earlier in this render.
  const onSelectAll = useCallback(async () => {
    setSelectingAll(true);
    setSelectAllNote('');
    // Staleness guard, mirroring `reload` below — but unlike `reload`,
    // Select-all also OWNS the generation: it bumps `reloadGen` itself
    // (not just captures it), so any `reload`/`loadMoreStage` already in
    // flight discards its result instead of racing the 5000-row fetch
    // that's about to land and clobbering it with a smaller page.
    // `myFilterGen` still just captures `clientFilterGen` (bumped only by
    // the filterKey effect above, never by this handler) — a filter change,
    // not a reload, is what should invalidate Select-all's own in-flight
    // fetch. Both must be refs — a plain value closed over by this callback
    // would just be compared to itself and never detect a change.
    //
    // Trap this creates: bumping `reloadGen` here means a `reload` that was
    // already in flight when Select-all started will find its own guard
    // (`myGen === reloadGen.current`) false when it lands, so ITS `finally`
    // skips `setLoading(false)` — which would otherwise strand the board on
    // `loading: true` forever. This handler's `finally` below compensates
    // by owning that flag itself whenever it still holds the current
    // generation (i.e. nothing newer superseded it in turn).
    const myGen = ++reloadGen.current;
    const myFilterGen = clientFilterGen.current;
    try {
      const data = await api.adminListSubmissions({ ...effectiveFilters, all: 'true' });
      if (myGen !== reloadGen.current || myFilterGen !== clientFilterGen.current) return;
      const rows = data.submissions || [];
      setSubmissions(rows);
      if (data.counts) setCounts(data.counts);
      const loaded = {};
      for (const s of rows) loaded[s.status] = (loaded[s.status] || 0) + 1;
      setLoadedByStage(loaded);
      setLoadingByStage({});
      setSelectedIds(new Set(
        rows.filter((s) => matchesClientFilters(s, clientFilters)).map((s) => s.id),
      ));
      // No silent caps: the server stops at 5000 rows. Say so whenever the
      // fetch actually hit the cap — `rows.length >= SELECT_ALL_CAP` alone
      // must drive this, not a comparison against `counts.Total`: that
      // count is seeded from VALID_STAGES and excludes NULL-status rows
      // (admin.py `_stage_counts`), so it can under-report and would let
      // this note silently miss the exact truncation it exists to surface.
      // When `Total` IS available and over the cap, it still adds a rough
      // "+more" hint, but it only counts server-filter matches (it knows
      // nothing about the client-only refinements below), so that part is
      // phrased as an approximation.
      if (rows.length >= SELECT_ALL_CAP) {
        const total = data.counts?.Total ?? 0;
        const more = total > SELECT_ALL_CAP
          ? ` — ${total - SELECT_ALL_CAP}+ more matched before filtering`
          : '';
        setSelectAllNote(`capped at ${SELECT_ALL_CAP}${more}`);
      }
    } catch (err) {
      if (myGen !== reloadGen.current || myFilterGen !== clientFilterGen.current) return;
      setSelectAllNote(err.message || 'Select all failed');
    } finally {
      setSelectingAll(false);
      // Compensates for the trap documented above: if this call still owns
      // the generation it bumped, no other reload will ever clear `loading`
      // on its behalf, so this must — otherwise a reload that was in
      // flight when Select-all started leaves the board spinning forever.
      if (myGen === reloadGen.current) setLoading(false);
    }
  }, [effectiveFilters, clientFilters]);

  // "All" filter: load-more in the table pulls the full remaining set in ONE
  // request (all: 'true') instead of fanning out a per-stage request per stage.
  // Deferred until the scroll sentinel fires, so the default All view still
  // opens with reload()'s cheap first-page-per-stage payload. A ref guards
  // against the sentinel double-firing a second 5000-row fetch mid-flight.
  const [loadingAll, setLoadingAll] = useState(false);
  const loadingAllRef = useRef(false);
  const loadAll = useCallback(async () => {
    if (loadingAllRef.current) return;
    loadingAllRef.current = true;
    const myGen = ++reloadGen.current;
    setLoadingAll(true);
    try {
      // fresh: bypass the 30-min GET cache — the full set backs table sorting,
      // which must reflect the real current DB order, not a stale page.
      const data = await api.adminListSubmissions({ ...effectiveFilters, all: 'true' }, { fresh: true });
      if (myGen !== reloadGen.current) return;
      const rows = data.submissions || [];
      setSubmissions(rows);
      if (data.counts) setCounts(data.counts);
      const loaded = {};
      for (const s of rows) loaded[s.status] = (loaded[s.status] || 0) + 1;
      setLoadedByStage(loaded);
      setLoadingByStage({});
    } catch {
      // Best-effort: leave the loaded page in place; scrolling retries.
    } finally {
      loadingAllRef.current = false;
      if (myGen === reloadGen.current) setLoadingAll(false);
    }
  }, [effectiveFilters]);

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
    setSelectAllNote('');
  };

  return (
    <div>
      <div className="page-head">
        <h2>Submissions</h2>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        {isStaff ? (
          <SegmentedTabs
            options={CITY_TABS}
            value={city}
            onChange={setCity}
            ariaLabel="Filter by city"
          />
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
        submissions={clientFilteredSubmissions}
        onSelectAll={onSelectAll}
        selectingAll={selectingAll}
        selectAllNote={selectAllNote}
        selectAllCap={SELECT_ALL_CAP}
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
          onLoadAll={loadAll}
          loadingAll={loadingAll}
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
