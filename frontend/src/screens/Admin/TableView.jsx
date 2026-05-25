import { useEffect, useMemo, useRef, useState } from 'react';

import { formatPrice, formatAcqPrice, formatDateOnly, formatTime12, stageMeta, timeAgo } from '../../format';

/**
 * Bottom-of-table infinite-scroll sentinel. Two modes:
 *
 *   - Filtered (statusFilter set): paginates that single stage. `hasMore`
 *     and `loading` come straight from `hasMoreByStage[statusFilter]` /
 *     `loadingByStage[statusFilter]`; `onVisible` fires
 *     `onLoadMore(statusFilter)`.
 *
 *   - Unfiltered: the table mixes every stage. The backend paginates per
 *     stage, so when the sentinel fires we fan out and call
 *     `onLoadMore(stage)` for every stage that still has more rows. The
 *     parent's `loadMoreStage` is per-stage idempotent (gated on
 *     `loadingByStage[stage]`), so re-firing while a load is in flight
 *     is safe. `hasMore` is "any stage has more"; `loading` is "any
 *     stage is currently loading".
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
    <div ref={ref} style={{ padding: '14px 0', textAlign: 'center', fontSize: 12, color: '#999' }}>
      {loading ? 'Loading more…' : ''}
    </div>
  );
}

// How to extract the sort key for each column.
// All accessors return primitives (number or string) so compare is predictable.
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

// Compact sort glyph. Active state uses solid small triangle. Idle state
// uses a subtle chevron so headers don't look noisy on narrow screens.
function SortIcon({ state }) {
  const active = !!state;
  const glyph = state === 'asc' ? '▲' : state === 'desc' ? '▼' : '⌄';
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        marginLeft: 3,
        fontSize: active ? 9 : 10,
        color: active ? '#222' : '#CCC',
        lineHeight: 1,
        verticalAlign: 'middle',
      }}
    >
      {glyph}
    </span>
  );
}

export default function TableView({
  submissions, loading, selectedId, onSelect,
  bulkMode = false, selectedIds = new Set(), onToggleSelect, onToggleAll,
  isAdmin = false,
  isStaff = false,
  statusFilter = '',
  hasMoreByStage = {},
  loadingByStage = {},
  onLoadMore,
}) {
  // { key, dir }  dir = 'asc' | 'desc'. Default: newest submissions first.
  const [sort, setSort] = useState({ key: 'submitted', dir: 'desc' });

  const toggleSort = (key) => {
    setSort((s) => {
      if (s.key !== key) return { key, dir: 'asc' };
      if (s.dir === 'asc') return { key, dir: 'desc' };
      return { key: 'submitted', dir: 'desc' };
    });
  };

  // Sort is wrapped in try/catch — if any single row crashes the accessor
  // (e.g. a malformed date), we fall back to the original order instead of
  // rendering an empty table. This was the cause of a prior bug where a
  // single row was returned by the API but the table rendered blank.
  const sorted = useMemo(() => {
    try {
      const acc = SORT_ACCESSORS[sort.key] || SORT_ACCESSORS.submitted;
      const copy = [...(submissions || [])];
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
      return [...(submissions || [])];
    }
  }, [submissions, sort]);

  if (loading) {
    return <div className="admin-table-loading">Loading submissions…</div>;
  }
  if (!submissions || submissions.length === 0) {
    return <div className="admin-table-loading">No submissions match.</div>;
  }

  const allChecked = bulkMode && submissions.length > 0 && submissions.every((s) => selectedIds.has(s.id));
  const someChecked = bulkMode && submissions.some((s) => selectedIds.has(s.id));

  const TH = ({ sortKey, children, style }) => {
    const state = sort.key === sortKey ? sort.dir : null;
    return (
      <th
        onClick={() => toggleSort(sortKey)}
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
        title={`Sort by ${typeof children === 'string' ? children : sortKey}`}
      >
        {children}
        <SortIcon state={state} />
      </th>
    );
  };

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {bulkMode && (
              <th style={{ width: 34 }}>
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
            <th style={{ whiteSpace: 'nowrap' }} title="Openhouse acquisition price">Acq</th>
            <TH sortKey="cp">CP</TH>
            <TH sortKey="status">Status</TH>
            <TH sortKey="submitted">Submitted</TH>
          </tr>
        </thead>
        <tbody>
          {(sorted && sorted.length > 0 ? sorted : submissions).map((s) => {
            const stage = stageMeta(s.status);
            const isWeakMatch = s.weak_match === true;
            const isRejected = s.status === 'Price Rejected' || s.status === 'Rejected';
            const isChecked = selectedIds.has(s.id);
            const isCollatedPartial = s.status === 'Unapproved' && s.collated_match === true;
            const isSubmissionsPartial = s.status === 'Unapproved' && s.submissions_match === true;
            const isPerfectMatch = s.perfect_match_at_submit === true;
            const isWithdrawn = !!s.deleted_at;
            const isUnitLess = s.unit_less === true;
            // Row tint priority:
            //   1. Perfect match                    → red
            //   2. Submissions match (incl. both)   → purple (another CP — stronger signal)
            //   3. Collated match                   → yellow
            //   4. Withdrawn / unit-less unapproved → yellow
            const rowStyle = isPerfectMatch
              ? { background: '#fef2f2' }
              : isSubmissionsPartial
                ? { background: '#f5f3ff' }
                : isCollatedPartial
                  ? { background: '#fffbeb' }
                  : (isWithdrawn || (isUnitLess && s.status === 'Unapproved'))
                    ? { background: '#fffbeb' }
                    : undefined;
            const handleClick = () => {
              if (bulkMode) onToggleSelect?.(s.id);
              else onSelect(s.id);
            };
            return (
              <tr
                key={s.id}
                className={`${selectedId === s.id ? 'active' : ''} ${isWeakMatch ? 'weak-match' : ''} ${isChecked ? 'bulk-selected' : ''}`}
                style={rowStyle}
                onClick={handleClick}
                title={isWeakMatch ? 'Weak society match during import — verify' : undefined}
              >
                {bulkMode && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggleSelect?.(s.id)}
                    />
                  </td>
                )}
                <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#555', fontWeight: 600 }}>
                  {s.public_id || '—'}
                  {isPerfectMatch && (
                    <span style={{
                      display: 'inline-block', marginLeft: 6, padding: '1px 6px',
                      fontSize: 9, fontWeight: 700, color: '#991b1b',
                      background: '#fee2e2', borderRadius: 3, letterSpacing: 0.3,
                    }} title="Detected as duplicate of an existing listing at submit time">
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
                      📅 {s.forms_uid}
                    </span>
                  )}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {isWeakMatch && <span style={{ color: '#DC2626', marginRight: 6 }}>⚠</span>}
                  {s.society_name}
                </td>
                <td style={{ color: '#888' }}>{s.city || '—'}</td>
                <td>
                  {[s.tower && s.unit_no ? `${s.tower}-${s.unit_no}` : (s.tower || s.unit_no || '—'), s.floor && `F${s.floor}`]
                    .filter(Boolean).join(' · ')}
                </td>
                <td>{[s.bhk, s.sqft ? `${s.sqft} sqft` : null].filter(Boolean).join(' · ') || '—'}</td>
                <td style={{ fontWeight: 600, color: '#FF6B2B' }}>{formatPrice(s.asking_price)}</td>
                {(() => {
                  const acq = formatAcqPrice(s.acq_price_lakhs, s.acq_sqft, s.sqft);
                  return (
                    <td
                      style={{ fontWeight: 600, color: '#16a34a', whiteSpace: 'nowrap' }}
                      title={acq ? acq.tooltip : 'Openhouse acquisition price'}
                    >
                      {acq ? acq.display : '—'}
                    </td>
                  );
                })()}
                <td>
                  {s.cp_name}
                  <div style={{ fontSize: 11, color: '#999' }}>{s.cp_code}</div>
                  {s.submitted_by_name && (
                    <div
                      title={`Submitted by ${s.submitted_by_name} on behalf of ${s.cp_name}`}
                      style={{
                        marginTop: 3,
                        maxWidth: 160,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'inline-block',
                        padding: '1px 6px',
                        background: '#FFF3ED',
                        color: '#FF6B2B',
                        borderRadius: 3,
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: 0.2,
                      }}
                    >
                      ✏ via {s.submitted_by_name.split(' ')[0]}
                    </div>
                  )}
                </td>
                <td>
                  <span
                    className={`status-pill ${isRejected ? 'is-rejected' : ''}`}
                    style={{ background: stage.bg, color: stage.color }}
                  >
                    {s.status}{s.status_reason ? ` (${s.status_reason})` : ''}
                  </span>
                  {isCollatedPartial && (
                    <span
                      title="Partial match from collated_data — society + BHK + floor matched an external-scraper listing; tower/unit couldn't be verified"
                      style={{
                        marginLeft: 6,
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: 600,
                        background: '#FEF3C7',
                        color: '#92400E',
                        border: '1px solid #FCD34D',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Collated match
                    </span>
                  )}
                  {isSubmissionsPartial && (
                    <span
                      title="Partial match from submissions table — society + BHK + floor matched another CP's submission; tower/unit couldn't be verified"
                      style={{
                        marginLeft: 6,
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: 600,
                        background: '#EDE9FE',
                        color: '#5B21B6',
                        border: '1px solid #C4B5FD',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Submissions match
                    </span>
                  )}
                </td>
                <td style={{ color: '#999' }}>{timeAgo(s.submitted_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Infinite scroll. Filtered → paginate the one selected stage.
          Unfiltered → fan out across every stage that still has rows.
          See the sentinel component's docstring for the rationale. */}
      {statusFilter ? (
        <TableLoadMoreSentinel
          hasMore={!!hasMoreByStage[statusFilter]}
          loading={!!loadingByStage[statusFilter]}
          onVisible={() => onLoadMore?.(statusFilter)}
        />
      ) : (() => {
        const stagesWithMore = Object.keys(hasMoreByStage).filter((k) => hasMoreByStage[k]);
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
  );
}