import { useEffect, useRef } from 'react';

import { formatPrice, formatAcqPrice, formatDateOnly, formatTime12, STAGES, timeAgo } from '../../format';
import AgingStrip from '../../components/AgingStrip';
import { timerFor } from '../../timer';

/**
 * Infinite-scroll sentinel rendered at the bottom of each kanban column.
 * Uses IntersectionObserver to fire `onVisible` when the sentinel scrolls
 * within `rootMargin` of the viewport. The 200px margin pre-fetches the
 * next page before the user actually hits the bottom, so scrolling feels
 * continuous instead of stutter-then-load.
 *
 * Renders nothing when there's nothing more to load — the parent column
 * just ends. The "Loading…" line shows while a fetch is in flight so the
 * user gets feedback during the load.
 */
function LoadMoreSentinel({ hasMore, loading, onVisible }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!hasMore || loading) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisible();
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, onVisible]);

  if (!hasMore && !loading) return null;
  return (
    <div ref={ref} style={{ padding: '10px 4px', textAlign: 'center', fontSize: 11, color: '#999' }}>
      {loading ? 'Loading more…' : ''}
    </div>
  );
}

export default function BoardView({
  submissions, loading, selectedId, onSelect,
  bulkMode = false, selectedIds = new Set(), onToggleSelect,
  isAdmin = false,
  isStaff = false,
  hasMoreByStage = {},
  loadingByStage = {},
  onLoadMore,
}) {
  // Staff (admin + manager + RM) see all stages including Unapproved
  const visibleStages = STAGES.filter((s) => isStaff || isAdmin || !s.adminOnly);

  if (loading) {
    return (
      <div className="admin-board">
        {visibleStages.map((s) => (
          <div className="board-column" key={s.key}>
            <div className="col-header">
              <span className="col-dot" style={{ background: s.color }} />
              <span className="col-title">{s.key}</span>
            </div>
            <div className="board-card-skel" />
            <div className="board-card-skel" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="admin-board">
      {visibleStages.map((stage) => {
        const colSubs = submissions.filter((s) => s.status === stage.key);
        const isRejectedCol = stage.key === 'Price Rejected' || stage.key === 'Duplicate Rejected';
        return (
          <div
            className={`board-column ${isRejectedCol ? 'is-rejected' : ''}`}
            key={stage.key}
          >
            <div className="col-header">
              <span className="col-dot" style={{ background: stage.color }} />
              <span className="col-title">{stage.key}</span>
              <span className="col-count">{colSubs.length}</span>
            </div>

            {colSubs.length === 0 && <div className="col-empty">No units</div>}

            {colSubs.map((s) => {
              const missingCore = !s.asking_price || !s.seller_name;
              const isWeakMatch = s.weak_match === true;
              const isChecked = selectedIds.has(s.id);
              const isCollatedPartial = s.status === 'Unapproved' && s.collated_match === true;
              const isSubmissionsPartial = s.status === 'Unapproved' && s.submissions_match === true;
              // New flags: perfect-match overrides yellow; withdrawn = soft yellow tint
              const isPerfectMatch = s.perfect_match_at_submit === true;
              const isWithdrawn = !!s.deleted_at;
              const isUnitLess = s.unit_less === true;
              // Style priority:
              //   1. Perfect match     → red (highest signal)
              //   2. Both collated AND submissions match → split background (yellow + purple)
              //   3. Submissions only  → purple
              //   4. Collated only / withdrawn / unit-less → yellow
              const cardOverlayStyle = isPerfectMatch
                ? { background: '#fef2f2', border: '1.5px solid #f87171' }
                : (isCollatedPartial && isSubmissionsPartial)
                  ? {
                      background: 'linear-gradient(135deg, #fffbeb 0%, #fffbeb 50%, #f5f3ff 50%, #f5f3ff 100%)',
                      border: '1.5px solid #c4b5fd',  // purple wins border (stronger signal: another CP)
                    }
                  : isSubmissionsPartial
                    ? { background: '#f5f3ff', border: '1.5px solid #c4b5fd' }
                    : (isWithdrawn || (isUnitLess && s.status === 'Unapproved'))
                      ? { background: '#fffbeb', border: '1.5px solid #fcd34d' }
                      : undefined;
              const handleClick = (e) => {
                if (bulkMode) {
                  e.stopPropagation();
                  onToggleSelect?.(s.id);
                } else {
                  onSelect(s.id);
                }
              };
              const acq = formatAcqPrice(s.acq_price_lakhs, s.acq_sqft, s.sqft);
              // Pull the value out of the helper's display string and pick a
              // label. The helper returns "Acq ₹X" for an exact-sqft match
              // and "Acq ~₹X (Y sqft)" for a suggested price (sqft differs).
              // We render the label separately, so strip the "Acq " prefix
              // and the "(Y sqft)" suffix off the value and surface them in
              // the label instead.
              let acqLabel = null;
              let acqValue = null;
              let acqIsSuggested = false;
              if (acq) {
                acqIsSuggested = acq.display.includes('~');
                let v = acq.display.replace(/^Acq\s+/, '');
                const sqftMatch = v.match(/^(.*?)\s*\((\d+)\s*sqft\)\s*$/);
                if (sqftMatch) {
                  v = sqftMatch[1];
                  acqLabel = `Suggested · ${sqftMatch[2]} sqft`;
                } else {
                  acqLabel = acqIsSuggested ? 'Suggested' : 'Openhouse acq';
                }
                acqValue = v;
              }

              const towerUnit = s.tower && s.unit_no
                ? `${s.tower}-${s.unit_no}`
                : (s.tower || s.unit_no || null);
              const metaParts = [towerUnit, s.floor && `F${s.floor}`].filter(Boolean);
              const showFlag = missingCore && !isWeakMatch;

              // Ageing border (dashed red ≤7d, solid red >7d). Skipped when
              // another overlay (perfect-match red / partial purple/yellow /
              // withdrawn) is already painting the card — otherwise the
              // borders fight and the result looks like a bug.
              const timer = !cardOverlayStyle ? timerFor(s) : null;
              const agingCardClass = !timer
                ? ''
                : (timer.overdue ? 'is-aging-overdue' : 'is-aging-soon');

              return (
                <div
                  key={s.id}
                  className={`board-card ${selectedId === s.id ? 'active' : ''} ${isWeakMatch ? 'weak-match' : ''} ${isChecked ? 'bulk-selected' : ''} ${agingCardClass}`}
                  style={cardOverlayStyle}
                  onClick={handleClick}
                  title={isWeakMatch ? 'Society name was a weak match during import — verify' : undefined}
                >
                  {bulkMode && (
                    <input
                      type="checkbox"
                      className="board-card-checkbox"
                      checked={isChecked}
                      readOnly
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}

                  {/* Header — society (left) + city/public_id (right). The
                      bulk checkbox is absolutely positioned at top-right, so
                      pad the corner away from it when bulkMode is on. */}
                  <div
                    className="board-card-head"
                    style={bulkMode ? { paddingRight: 22 } : undefined}
                  >
                    <div className="board-card-society">{s.society_name}</div>
                    <div className="board-card-corner">
                      {s.city && (
                        <div className="board-card-city-text">
                          {s.city}
                          {showFlag && (
                            <span
                              className="board-card-flag"
                              title="Missing asking price or seller info"
                            />
                          )}
                        </div>
                      )}
                      {s.public_id && <div className="board-card-pubid-text">{s.public_id}</div>}
                    </div>
                  </div>

                  {metaParts.length > 0 && (
                    <div className="board-card-meta">{metaParts.join(' · ')}</div>
                  )}

                  <div className="board-card-chips">
                    {s.bhk && (
                      <span
                        className="board-chip"
                        style={{ background: stage.bg, color: stage.color }}
                      >
                        {s.bhk}
                      </span>
                    )}
                    {s.sqft ? <span className="board-chip board-chip-sqft">{s.sqft} sqft</span> : null}
                    {isCollatedPartial && (
                      <span
                        className="board-chip board-chip-collated"
                        title="Partial match from collated_data — society + BHK + floor matched an external-scraper listing; tower/unit couldn't be verified"
                      >
                        Collated match
                      </span>
                    )}
                    {isSubmissionsPartial && (
                      <span
                        className="board-chip board-chip-submissions"
                        title="Partial match from submissions table — society + BHK + floor matched another CP's submission; tower/unit couldn't be verified"
                      >
                        Submissions match
                      </span>
                    )}
                    {isWeakMatch && (
                      <span
                        className="board-chip board-chip-weak"
                        title="Weak society match — verify"
                      >
                        ⚠ weak match
                      </span>
                    )}
                  </div>

                  {s.scheduled_date && (
                    <div className="board-card-schedule">
                      📅 {formatDateOnly(s.scheduled_date)}
                      {s.scheduled_time ? ` · ${formatTime12(s.scheduled_time)}` : ''}
                      {s.field_exec_name ? ` · ${s.field_exec_name}` : ''}
                    </div>
                  )}

                  <div className="board-card-divider" />

                  <div className={`board-card-prices${acq ? '' : ' solo'}`}>
                    <div>
                      <div className="board-card-price-label">Asking</div>
                      <div className="board-card-price-value asking">{formatPrice(s.asking_price)}</div>
                    </div>
                    {acq && (
                      <div title={acq.tooltip}>
                        <div className="board-card-price-label">{acqLabel}</div>
                        <div className={`board-card-price-value ${acqIsSuggested ? 'acq-suggested' : 'acq'}`}>
                          {acqValue}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="board-card-footer">
                    <span className="board-card-date">
                      {timeAgo(s.submitted_at)} · {s.cp_name}
                    </span>
                    {s.submitted_by_name && (
                      <span
                        className="board-card-onbehalf"
                        title={`Submitted by ${s.submitted_by_name} on behalf of ${s.cp_name}`}
                      >
                        ✏ via {s.submitted_by_name.split(' ')[0]}
                      </span>
                    )}
                  </div>

                  <AgingStrip submission={s} placement="card-bottom" />
                </div>
              );
            })}

            {/* Per-column infinite-scroll sentinel. Each kanban column
                paginates independently — when the user scrolls down and
                this stage's column runs out of loaded rows, the
                IntersectionObserver fires onLoadMore for THIS stage only
                (status=stage&offset=N on the wire). */}
            <LoadMoreSentinel
              hasMore={!!hasMoreByStage[stage.key]}
              loading={!!loadingByStage[stage.key]}
              onVisible={() => onLoadMore?.(stage.key)}
            />
          </div>
        );
      })}
    </div>
  );
}