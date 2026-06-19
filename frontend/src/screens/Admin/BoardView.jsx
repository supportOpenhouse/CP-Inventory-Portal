import { useEffect, useRef, useState } from 'react';

import { formatPrice, formatOhPrice, formatDateOnly, formatTime12, STAGES, timeAgo } from '../../format';
import AgingStrip from '../../components/AgingStrip';
import MatchDetailsModal from '../../components/MatchDetailsModal';
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
  isViewer = false,
  statusFilter = '',
  hasMoreByStage = {},
  loadingByStage = {},
  onLoadMore,
}) {
<<<<<<< Updated upstream
  // Staff (admin + manager + RM) and viewers see all stages including
  // Unapproved. Matches the counts panel filter at the top of Admin/index.jsx
  // so the board columns line up with the stage counts shown above.
=======
  // Match-details modal: null = closed; an array = the matched records to show
  // (set when a Perfect / Collated / Submissions badge is clicked).
  const [matchModalItems, setMatchModalItems] = useState(null);

  // Staff (admin + manager + RM) see all stages including Unapproved.
>>>>>>> Stashed changes
  // When a status filter is active, collapse to just that stage's column:
  // the reload only fetches that stage, and rendering the other (empty)
  // columns would re-fire their load-more sentinels — which fetch each
  // stage independently and refill the board, defeating the filter.
  const visibleStages = STAGES
    .filter((s) => isStaff || isViewer || !s.adminOnly)
    .filter((s) => !statusFilter || s.key === statusFilter);

  if (loading) {
    return (
      <div className="admin-board">
        {visibleStages.map((s) => (
          <div className="board-column" key={s.key}>
            <div className="col-header">
              <span className="col-dot" style={{ background: s.color }} />
              <span className="col-title">{s.label || s.key}</span>
            </div>
            <div className="board-card-skel" />
            <div className="board-card-skel" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
    <div className="admin-board">
      {visibleStages.map((stage) => {
        const colSubs = submissions.filter((s) => s.status === stage.key);
        const isRejectedCol = stage.key === 'Price Rejected' || stage.key === 'Rejected';
        return (
          <div
            className={`board-column ${isRejectedCol ? 'is-rejected' : ''}`}
            key={stage.key}
          >
            <div className="col-header">
              <span className="col-dot" style={{ background: stage.color }} />
              <span className="col-title">{stage.label || stage.key}</span>
              <span className="col-count">{colSubs.length}</span>
            </div>

            {colSubs.length === 0 && <div className="col-empty">No units</div>}

            {colSubs.map((s) => {
              const missingCore = !s.asking_price || !s.seller_name;
              const isWeakMatch = s.weak_match === true;
              const isChecked = selectedIds.has(s.id);
              const isCollatedPartial = s.status === 'Unapproved' && s.collated_match === true;
              const isSubmissionsPartial = s.status === 'Unapproved' && s.submissions_match === true;
              // perfect-match → red overlay (highest signal).
              const isPerfectMatch = s.perfect_match_at_submit === true;
              // Card currently in Unapproved that was moved here from another
              // stage (admin demotion) — moved_from_status holds the just-
              // previous stage. Null when the card was created as Unapproved.
              const movedFromStage = (s.status === 'Unapproved' && s.moved_from_status)
                ? s.moved_from_status
                : null;
              // Style priority:
              //   1. Perfect match                       → red (highest signal)
              //   2. Submissions match (incl. both)      → purple (another CP — stronger signal)
              //   3. Collated match                      → yellow
              //   4. Moved into Unapproved from a stage  → blue (provenance flag)
              const cardOverlayStyle = isPerfectMatch
                ? { background: '#fef2f2', border: '1.5px solid #f87171' }
                : isSubmissionsPartial
                  ? { background: '#f5f3ff', border: '1.5px solid #c4b5fd' }
                  : isCollatedPartial
                    ? { background: '#fffbeb', border: '1.5px solid #fcd34d' }
                    : movedFromStage
                      ? { background: '#eff6ff', border: '1.5px solid #93c5fd' }
                      : undefined;
              const handleClick = (e) => {
                if (bulkMode) {
                  e.stopPropagation();
                  onToggleSelect?.(s.id);
                } else {
                  onSelect(s.id);
                }
              };
              // Openhouse price chip: green formatted price on a confident
              // match, brown "Check Price" + a reason sub-text otherwise. null
              // when pricing data is unavailable (renders nothing).
              const oh = formatOhPrice(s);

              // Counter offer — shown on the card next to the asking price
              // whenever one has been sent. Colour mirrors the detail panel:
              // amber pending / green accepted / red rejected / indigo once
              // the broker counters back. For a broker counter we surface the
              // broker's price (broker_counter_price), not our own.
              const counterStatus = s.counter_offer_status || null;
              const isBrokerCounter = counterStatus === 'broker_countered';
              const counterColor = counterStatus === 'pending' ? '#E8A838'
                : counterStatus === 'accepted' ? '#10B981'
                  : counterStatus === 'rejected' ? '#DC2626'
                    : '#6366F1';
              const counterLabel = isBrokerCounter ? 'Counter Offer' : `Counter · ${counterStatus}`;
              const counterPrice = isBrokerCounter ? s.broker_counter_price : s.counter_offer_price;

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
                    {isPerfectMatch && (
                      <span
                        className="board-chip board-chip-perfect"
                        style={{ cursor: 'pointer' }}
                        title="Perfect match — click to see the matched record(s)"
                        onClick={(e) => { e.stopPropagation(); setMatchModalItems(s.match_details || []); }}
                      >
                        Perfect match
                      </span>
                    )}
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
                    {movedFromStage && (
                      <span
                        className="board-chip board-chip-moved"
                        title={`Moved into Unapproved from ${movedFromStage}`}
                      >
                        Moved from {movedFromStage}
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

                  {/* Status sub-category (status_reason) — staff-only.
                      Rendered as a pill matching the "Moved from …" chip
                      style (rounded, 1px border), coloured by status:
                      orange for Offer ("Offer Given") and Closure, red for
                      Price Rejected / Rejected. Hidden otherwise. */}
                  {s.status_reason
                    && (s.status === 'Offer'
                        || s.status === 'Closure'
                        || s.status === 'Price Rejected'
                        || s.status === 'Rejected') && (() => {
                    const isOffer = s.status === 'Offer' || s.status === 'Closure';
                    return (
                      <span
                        style={{
                          display: 'inline-block',
                          marginTop: 6,
                          fontSize: 10,
                          padding: '3px 8px',
                          borderRadius: 4,
                          fontWeight: 600,
                          letterSpacing: 0.2,
                          lineHeight: 1.5,
                          color:      isOffer ? '#FF6B2B' : '#B91C1C',
                          background: isOffer ? '#FFF3ED' : '#FEE2E2',
                          border:     `1px solid ${isOffer ? '#FED7AA' : '#FCA5A5'}`,
                        }}
                        title="Sub-category — staff only, not shown to CPs"
                      >
                        {s.status_reason}
                      </span>
                    );
                  })()}

                  <div className="board-card-divider" />

                  <div className={`board-card-prices${oh || counterStatus ? '' : ' solo'}`}>
                    <div>
                      <div className="board-card-price-label">Asking</div>
                      <div className="board-card-price-value asking">{formatPrice(s.asking_price)}</div>
                    </div>
                    {counterStatus && (
                      <div>
                        <div className="board-card-price-label">{counterLabel}</div>
                        <div className="board-card-price-value" style={{ color: counterColor }}>
                          {formatPrice(counterPrice)}
                        </div>
                        <div
                          style={{ fontSize: 9.5, fontWeight: 600, color: '#999', marginTop: 3 }}
                          title="Counter offers — sent by us · countered back by the CP"
                        >
                          Sent {s.counter_offers_sent || 0} · CP {s.cp_counter_offers || 0}
                        </div>
                      </div>
                    )}
                    {oh && (
                      <div title={oh.tooltip}>
                        <div className="board-card-price-label">OH Price</div>
                        <div className="board-card-price-value" style={{ color: oh.color }}>
                          {oh.display}
                        </div>
                        {oh.sub && (
                          <div style={{ fontSize: 9.5, fontWeight: 600, color: oh.color, marginTop: 3 }}>
                            {oh.sub}
                          </div>
                        )}
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
    <MatchDetailsModal
      open={matchModalItems !== null}
      items={matchModalItems || []}
      onClose={() => setMatchModalItems(null)}
      onOpenSubmission={onSelect}
      title="Matched records"
    />
    </>
  );
}