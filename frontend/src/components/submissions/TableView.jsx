/**
 * Sticky sortable table — Direct's `InventoryTable` shell (sticky `.inv-th`
 * headers with sort glyphs, skeleton rows, bulk checkboxes) carrying CP's
 * `screens/Admin/TableView.jsx` columns, `SORT_ACCESSORS`, and row-tint
 * priority verbatim. CHANGE from CP: row click toggles an inline
 * `<ExpandPanel>` row instead of opening a side panel (Direct's row-expand
 * pattern); bulk mode still toggles the row's checkbox on click.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import {
  formatBhk, formatPrice, formatOhPrice, formatDateOnly, formatTime12,
  stageLabel, stageMeta, timeAgo, STAGES,
} from '../../format';
import MatchDetailsModal from '../MatchDetailsModal.jsx';
import ExpandPanel from './ExpandPanel.jsx';
import Loading from '../Loading.jsx';
import DotLoader from '../DotLoader.jsx';
import { IconCalendar } from '../icons.jsx';

/**
 * Bottom-of-table infinite-scroll sentinel. The stage filter is a client-side
 * multi-select now, so the backend still paginates per stage: when the sentinel
 * fires we fan out `onLoadMore(stage)` across the selected stages (or every
 * stage with more rows when nothing is selected).
 */
function TableLoadMoreSentinel({ hasMore, loading, onVisible }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!hasMore || loading) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisible();
      },
      { rootMargin: '300px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, onVisible]);

  if (!hasMore && !loading) return null;
  return (
    <div ref={ref} style={{ padding: '14px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
      {loading ? <Loading label="Loading more" /> : ''}
    </div>
  );
}

// How to extract the sort key for each column. All accessors return
// primitives (number or string) so compare is predictable.
const SORT_ACCESSORS = {
  listing_id: (s) => (s.public_id || '').toString(),
  society:    (s) => (s.society_name || '').toString().toLowerCase(),
  city:       (s) => (s.city || '').toString().toLowerCase(),
  unit:       (s) => {
    const t = (s.tower || '').toString();
    const u = (s.unit_no || '').toString();
    return `${t}-${u}`.toLowerCase();
  },
  config:     (s) => {
    const bhkMatch = (s.bhk || '').toString().match(/\d+/);
    const bhkNum = bhkMatch ? parseInt(bhkMatch[0], 10) : 0;
    const sqft = parseInt(s.sqft, 10) || 0;
    return bhkNum * 100000 + sqft;
  },
  asking:     (s) => parseInt(s.asking_price, 10) || 0,
  cp:         (s) => (s.cp_name || '').toString().toLowerCase(),
  status:     (s) => (s.status || '').toString(),
  submitted:  (s) => {
    if (!s.submitted_at) return 0;
    const t = new Date(s.submitted_at).getTime();
    return isNaN(t) ? 0 : t;
  },
};

const COL_COUNT = 10; // data columns (+1 more when bulkMode adds the checkbox column)

export default function TableView({
  submissions, loading,
  counts = {}, loadedByStage = {}, loadingByStage = {}, onLoadMore,
  canAct = false,
  bulkMode = false, selectedIds = new Set(), onToggleSelect, onToggleAll,
  statusFilter = [],
  onOpenSubmission,
}) {
  // { key, dir }  dir = 'asc' | 'desc'. Default: newest submissions first.
  const [sort, setSort] = useState({ key: 'submitted', dir: 'desc' });
  // Match-details modal: null = closed; an array = matched records to show.
  const [matchModalItems, setMatchModalItems] = useState(null);
  // Which row's inline ExpandPanel is open (Direct row-expand pattern).
  const [openId, setOpenId] = useState(null);
  // Per-row optimistic patches from ExpandPanel edits, so the collapsed row
  // (status pill / price / etc.) doesn't go stale between full reloads.
  const [overrides, setOverrides] = useState({});

  // Derived per-stage "is there more to load" — mirrors BoardView's
  // derivation from the same counts + loadedByStage props.
  const hasMoreByStage = {};
  for (const st of STAGES) {
    hasMoreByStage[st.key] = (loadedByStage[st.key] || 0) < (counts[st.key] || 0);
  }

  const toggleSort = (key) => {
    setSort((s) => {
      if (s.key !== key) return { key, dir: 'asc' };
      if (s.dir === 'asc') return { key, dir: 'desc' };
      return { key: 'submitted', dir: 'desc' };
    });
  };

  const patchRow = (updated) => {
    setOverrides((m) => ({ ...m, [updated.id]: updated }));
  };

  const merged = useMemo(
    () => (submissions || []).map((s) => (overrides[s.id] ? { ...s, ...overrides[s.id] } : s)),
    [submissions, overrides],
  );

  // Sort is wrapped in try/catch — if any single row crashes the accessor
  // (e.g. a malformed date), we fall back to the original order instead of
  // rendering an empty table.
  const sorted = useMemo(() => {
    try {
      const acc = SORT_ACCESSORS[sort.key] || SORT_ACCESSORS.submitted;
      const copy = [...merged];
      copy.sort((a, b) => {
        let av, bv;
        try { av = acc(a); } catch { av = ''; }
        try { bv = acc(b); } catch { bv = ''; }
        let cmp = 0;
        if (typeof av === 'number' && typeof bv === 'number') {
          cmp = av - bv;
        } else {
          cmp = String(av).localeCompare(String(bv));
        }
        return sort.dir === 'asc' ? cmp : -cmp;
      });
      return copy;
    } catch (err) {
      console.error('Table sort failed, falling back to unsorted', err);
      return [...merged];
    }
  }, [merged, sort]);

  // Empty state only when NOT loading — during the initial load we fall through
  // to the table shell + skeleton rows (in the tbody below) instead of swapping
  // in a blank spinner, so the table shimmers in place of a whole-page reload.
  if (!loading && (!merged || merged.length === 0)) {
    return <div className="admin-table-loading">No submissions match.</div>;
  }

  const allChecked = bulkMode && merged.length > 0 && merged.every((s) => selectedIds.has(s.id));
  const someChecked = bulkMode && merged.some((s) => selectedIds.has(s.id));
  const colCount = COL_COUNT + (bulkMode ? 1 : 0);

  const TH = ({ sortKey, children }) => {
    const state = sort.key === sortKey ? sort.dir : null;
    const arrow = state === 'asc' ? '▲' : state === 'desc' ? '▼' : '↕';
    return (
      <th
        className={`inv-th inv-th-sortable ${state ? 'inv-th-active' : ''}`}
        onClick={() => toggleSort(sortKey)}
        title={`Sort by ${typeof children === 'string' ? children : sortKey}`}
      >
        {children} <span className={state ? 'inv-th-arrow-active' : 'inv-th-arrow'}>{arrow}</span>
      </th>
    );
  };

  const rows = sorted.length > 0 ? sorted : merged;

  return (
    <>
    <div className="inv-table-wrap">
      <table className="inv-table">
        <thead>
          <tr>
            {bulkMode && (
              <th className="inv-th inv-th-sel">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                  onChange={() => onToggleAll?.()}
                />
              </th>
            )}
            <TH sortKey="listing_id">Listing ID</TH>
            <TH sortKey="society">Society</TH>
            <TH sortKey="city">City</TH>
            <TH sortKey="unit">Unit</TH>
            <TH sortKey="config">Config</TH>
            <TH sortKey="asking">Asking</TH>
            <th className="inv-th" title="Openhouse price (society + area match)">OH Price</th>
            <TH sortKey="cp">CP</TH>
            <TH sortKey="status">Status</TH>
            <TH sortKey="submitted">Submitted</TH>
          </tr>
        </thead>
        <tbody>
          {/* On any load — search, filter, sort or city change — drop the stale
              rows immediately and show the bouncing-dots loader, so old data
              never sits under the new query while the request is in flight. */}
          {loading ? (
            <tr>
              <td colSpan={colCount} style={{ textAlign: 'center', padding: '56px 0' }}>
                <DotLoader />
              </td>
            </tr>
          ) : rows.map((s) => {
            const stage = stageMeta(s.status);
            const isWeakMatch = s.weak_match === true;
            const isRejected = s.status === 'Price Rejected' || s.status === 'Rejected';
            const isChecked = selectedIds.has(s.id);
            const isCollatedPartial = s.status === 'Unapproved' && s.collated_match === true;
            const isSubmissionsPartial = s.status === 'Unapproved' && s.submissions_match === true;
            const isPerfectMatch = s.perfect_match_at_submit === true;
            const isWithdrawn = !!s.deleted_at;
            const isUnitLess = s.unit_less === true;
            const isOpen = openId === s.id;
            // Row tint priority:
            //   1. Perfect match                    → red
            //   2. Submissions match (incl. both)   → purple (another CP — stronger signal)
            //   3. Collated match                   → yellow
            //   4. Withdrawn / unit-less unapproved → yellow
            // Row tint → a theme-aware class (was inline light hex, which glared
            // in dark mode). Light: soft tint; dark: faint hue of the same colour.
            const matchClass = isPerfectMatch ? 'match-perfect'
              : isSubmissionsPartial ? 'match-submissions'
                : isCollatedPartial ? 'match-collated'
                  : (isWithdrawn || (isUnitLess && s.status === 'Unapproved')) ? 'match-collated'
                    : '';
            const handleClick = () => {
              if (bulkMode) onToggleSelect?.(s.id);
              else setOpenId(isOpen ? null : s.id);
            };
            return (
              <Fragment key={s.id}>
                <tr
                  className={`inv-row ${matchClass} ${isOpen ? 'inv-row-open' : ''} ${isWeakMatch ? 'weak-match' : ''} ${isChecked ? 'inv-row-selected' : ''}`}
                  onClick={handleClick}
                  title={isWeakMatch ? 'Weak society match during import — verify' : undefined}
                >
                  {bulkMode && (
                    <td className="inv-td-sel" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => onToggleSelect?.(s.id)}
                      />
                    </td>
                  )}
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                    {s.public_id || '—'}
                    {isPerfectMatch && (
                      <span style={{
                        display: 'inline-block', marginLeft: 6, padding: '1px 6px',
                        fontSize: 9, fontWeight: 700, color: '#991b1b',
                        background: '#fee2e2', borderRadius: 3, letterSpacing: 0.3,
                        cursor: 'pointer',
                      }} title="Perfect match — click to see the matched record(s)"
                        onClick={(e) => { e.stopPropagation(); setMatchModalItems(s.match_details || []); }}>
                        PERFECT
                      </span>
                    )}
                    {isWithdrawn && (
                      <span style={{
                        display: 'inline-block', marginLeft: 6, padding: '1px 6px',
                        fontSize: 9, fontWeight: 700, color: '#92400e',
                        background: '#fef3c7', borderRadius: 3, letterSpacing: 0.3,
                      }} title={s.withdraw_reason === 'cp_withdrawn' ? 'CP withdrew this submission' : 'Soft-deleted'}>
                        WITHDRAWN
                      </span>
                    )}
                    {s.forms_uid && (
                      <span style={{
                        display: 'inline-block', marginLeft: 6, padding: '1px 6px',
                        fontSize: 9, fontWeight: 700, color: '#065F46',
                        background: '#ECFDF5', borderRadius: 3, letterSpacing: 0.3,
                      }} title={`Visit scheduled · ${formatDateOnly(s.scheduled_date)} ${formatTime12(s.scheduled_time)} · ${s.field_exec_name || ''} · UID ${s.forms_uid}`}>
                        <IconCalendar size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />{s.forms_uid}
                      </span>
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {isWeakMatch && <span style={{ color: 'var(--red-fg)', marginRight: 6 }}>⚠</span>}
                    {s.society_name}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{s.city || '—'}</td>
                  <td>
                    {[s.tower && s.unit_no ? `${s.tower}-${s.unit_no}` : (s.tower || s.unit_no || '—'), s.floor && `F${s.floor}`]
                      .filter(Boolean).join(' · ')}
                  </td>
                  <td>{[s.bhk && formatBhk(s.bhk), s.sqft ? `${s.sqft} sqft` : null].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="val-orange" style={{ fontWeight: 600 }}>{formatPrice(s.asking_price)}</td>
                  {(() => {
                    const oh = formatOhPrice(s);
                    return (
                      <td
                        style={{ fontWeight: 600, color: oh ? oh.color : 'var(--green-fg)', whiteSpace: 'nowrap' }}
                        title={oh ? oh.tooltip : 'Openhouse price (society + area match)'}
                      >
                        {oh
                          ? (oh.sub ? `${oh.display} · ${oh.sub}` : oh.display)
                          : '—'}
                      </td>
                    );
                  })()}
                  <td>
                    {s.cp_name}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.cp_code}</div>
                    {s.submitted_by_name && (
                      <div
                        title={`Submitted by ${s.submitted_by_name} on behalf of ${s.cp_name}`}
                        style={{
                          marginTop: 3, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', display: 'inline-block', padding: '1px 6px',
                          background: 'var(--brand-soft)', color: 'var(--brand-strong)',
                          borderRadius: 3, fontSize: 10, fontWeight: 600, letterSpacing: 0.2,
                        }}
                      >
                        ✏ via {s.submitted_by_name.split(' ')[0]}
                      </div>
                    )}
                  </td>
                  <td>
                    {/* Flex-wrap + gap so the status pill and match flags get
                        breathing room and drop to the next line instead of
                        clustering. Match flags reuse the theme-aware board-chip
                        classes (were inline light hex → broken in dark). */}
                    <div className="status-cell">
                      <span
                        className={`status-pill ${isRejected ? 'is-rejected' : ''}`}
                        style={{ '--sb': stage.bg, '--sc': stage.fg || stage.color, '--sc2': stage.color }}
                      >
                        {stageLabel(s.status)}{s.status_reason ? ` (${s.status_reason})` : ''}
                      </span>
                      {isCollatedPartial && (
                        <span
                          className="board-chip board-chip-collated"
                          style={{ cursor: 'pointer' }}
                          title="Partial match from external inventory — click to see the matched listing(s)"
                          onClick={(e) => { e.stopPropagation(); setMatchModalItems(s.match_details || []); }}
                        >
                          Collated match
                        </span>
                      )}
                      {isSubmissionsPartial && (
                        <span
                          className="board-chip board-chip-submissions"
                          style={{ cursor: 'pointer' }}
                          title="Partial match from another CP's submission — click to see the matched record(s)"
                          onClick={(e) => { e.stopPropagation(); setMatchModalItems(s.match_details || []); }}
                        >
                          Submissions match
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{timeAgo(s.submitted_at)}</td>
                </tr>
                {isOpen && !bulkMode && (
                  <tr className="expand-row">
                    <td colSpan={colCount}>
                      <ExpandPanel id={s.id} canAct={canAct} onChanged={patchRow} onOpenSubmission={onOpenSubmission} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Infinite scroll. Paginate the selected stages (multi-select), or fan
          out across every stage that still has rows when nothing is selected. */}
      {(() => {
        const candidates = statusFilter.length > 0 ? statusFilter : Object.keys(hasMoreByStage);
        const stagesWithMore = candidates.filter((k) => hasMoreByStage[k]);
        const anyLoading = stagesWithMore.some((k) => loadingByStage[k]);
        return (
          <TableLoadMoreSentinel
            hasMore={stagesWithMore.length > 0}
            loading={anyLoading}
            onVisible={() => stagesWithMore.forEach((stage) => onLoadMore?.(stage))}
          />
        );
      })()}
    </div>
    <MatchDetailsModal
      open={matchModalItems !== null}
      items={matchModalItems || []}
      onClose={() => setMatchModalItems(null)}
      onOpenSubmission={onOpenSubmission}
      title="Matched records"
    />
    </>
  );
}
