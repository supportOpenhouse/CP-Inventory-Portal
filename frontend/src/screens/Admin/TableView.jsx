import { formatPrice, stageMeta, timeAgo } from '../../format';

export default function TableView({
  submissions, loading, selectedId, onSelect,
  bulkMode = false, selectedIds = new Set(), onToggleSelect, onToggleAll,
}) {
  if (loading) {
    return <div className="admin-table-loading">Loading submissions…</div>;
  }
  if (submissions.length === 0) {
    return <div className="admin-table-loading">No submissions match.</div>;
  }

  const allChecked = bulkMode && submissions.length > 0 && submissions.every((s) => selectedIds.has(s.id));
  const someChecked = bulkMode && submissions.some((s) => selectedIds.has(s.id));

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
            <th>Listing ID</th>
            <th>Society</th>
            <th>City</th>
            <th>Unit</th>
            <th>Config</th>
            <th>Asking</th>
            <th>Closing</th>
            <th>CP</th>
            <th>Status</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {submissions.map((s) => {
            const stage = stageMeta(s.status);
            const isWeakMatch = s.weak_match === true;
            const isRejected = s.status === 'Rejected';
            const isChecked = selectedIds.has(s.id);
            const handleClick = () => {
              if (bulkMode) onToggleSelect?.(s.id);
              else onSelect(s.id);
            };
            return (
              <tr
                key={s.id}
                className={`${selectedId === s.id ? 'active' : ''} ${isWeakMatch ? 'weak-match' : ''} ${isChecked ? 'bulk-selected' : ''}`}
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
                <td>{formatPrice(s.closing_price)}</td>
                <td>
                  {s.cp_name}
                  <div style={{ fontSize: 11, color: '#999' }}>{s.cp_code}</div>
                </td>
                <td>
                  <span
                    className={`status-pill ${isRejected ? 'is-rejected' : ''}`}
                    style={{ background: stage.bg, color: stage.color }}
                  >
                    {s.status}
                  </span>
                </td>
                <td style={{ color: '#999' }}>{timeAgo(s.submitted_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}