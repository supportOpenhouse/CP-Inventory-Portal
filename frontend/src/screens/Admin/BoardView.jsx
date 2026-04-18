import { formatPrice, STAGES, timeAgo } from '../../format';

export default function BoardView({ submissions, loading, selectedId, onSelect }) {
  if (loading) {
    return (
      <div className="admin-board">
        {STAGES.map((s) => (
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
      {STAGES.map((stage) => {
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

            {colSubs.length === 0 && (
              <div className="col-empty">No units</div>
            )}

            {colSubs.map((s) => {
              const missingCore = !s.asking_price || !s.seller_name;
              const isWeakMatch = s.weak_match === true;
              return (
                <div
                  key={s.id}
                  className={`board-card ${selectedId === s.id ? 'active' : ''} ${isWeakMatch ? 'weak-match' : ''}`}
                  onClick={() => onSelect(s.id)}
                  title={isWeakMatch ? 'Society name was a weak match during import — verify' : undefined}
                >
                  {missingCore && !isWeakMatch && (
                    <span className="board-card-flag" title="Missing asking price or seller info" />
                  )}
                  {isWeakMatch && (
                    <span className="board-card-weak-badge" title="Weak society match — verify the listing">⚠</span>
                  )}
                  <div className="board-card-society">{s.society_name}</div>
                  <div className="board-card-city">{s.city || ''}</div>
                  <div className="board-card-meta">
                    {[s.tower && s.unit_no ? `${s.tower}-${s.unit_no}` : (s.tower || s.unit_no), s.floor && `F${s.floor}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <div className="board-card-chips">
                    {s.bhk && (
                      <span
                        className="board-chip"
                        style={{ background: stage.bg, color: stage.color }}
                      >
                        {s.bhk}
                      </span>
                    )}
                    {s.sqft ? (
                      <span className="board-chip board-chip-plain">{s.sqft} sqft</span>
                    ) : null}
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