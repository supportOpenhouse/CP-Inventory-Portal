import { formatPrice, STAGES, timeAgo } from '../../format';

export default function BoardView({
  submissions, loading, selectedId, onSelect,
  bulkMode = false, selectedIds = new Set(), onToggleSelect,
  isAdmin = false,
  isStaff = false,
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
        const isRejectedCol = stage.key === 'Rejected';
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
              const handleClick = (e) => {
                if (bulkMode) {
                  e.stopPropagation();
                  onToggleSelect?.(s.id);
                } else {
                  onSelect(s.id);
                }
              };
              return (
                <div
                  key={s.id}
                  className={`board-card ${selectedId === s.id ? 'active' : ''} ${isWeakMatch ? 'weak-match' : ''} ${isChecked ? 'bulk-selected' : ''}`}
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
                  {missingCore && !isWeakMatch && !bulkMode && (
                    <span className="board-card-flag" title="Missing asking price or seller info" />
                  )}
                  {isWeakMatch && !bulkMode && (
                    <span className="board-card-weak-badge" title="Weak society match — verify">⚠</span>
                  )}
                  <div className="board-card-society">{s.society_name}</div>
                  <div className="board-card-corner">
                    {s.city && <div className="board-card-city-text">{s.city}</div>}
                    {s.public_id && <div className="board-card-pubid-text">{s.public_id}</div>}
                  </div>
                  <div className="board-card-meta">
                    {[s.tower && s.unit_no ? `${s.tower}-${s.unit_no}` : (s.tower || s.unit_no), s.floor && `F${s.floor}`]
                      .filter(Boolean).join(' · ')}
                  </div>
                  <div className="board-card-chips">
                    {s.bhk && (
                      <span className="board-chip" style={{ background: stage.bg, color: stage.color }}>{s.bhk}</span>
                    )}
                    {s.sqft ? <span className="board-chip board-chip-plain">{s.sqft} sqft</span> : null}
                    {isCollatedPartial && (
                      <span
                        className="board-chip"
                        title="Partial match from collated_data — society + BHK + floor matched an external-scraper listing; tower/unit couldn't be verified"
                        style={{
                          background: '#FEF3C7',
                          color: '#92400E',
                          border: '1px solid #FCD34D',
                        }}
                      >
                        Collated match
                      </span>
                    )}
                  </div>
                  <div className="board-card-bottom">
                    <span className="board-card-price">{formatPrice(s.asking_price)}</span>
                    <span className="board-card-date">
                      {timeAgo(s.submitted_at)} · {s.cp_name}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}