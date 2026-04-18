import { formatPrice, stageMeta, timeAgo } from '../../format';

export default function TableView({ submissions, loading, selectedId, onSelect }) {
  if (loading) {
    return <div className="admin-table-loading">Loading submissions…</div>;
  }
  if (submissions.length === 0) {
    return <div className="admin-table-loading">No submissions match.</div>;
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
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
            return (
              <tr
                key={s.id}
                className={`${selectedId === s.id ? 'active' : ''} ${isWeakMatch ? 'weak-match' : ''}`}
                onClick={() => onSelect(s.id)}
                title={isWeakMatch ? 'Weak society match during import — verify' : undefined}
              >
                <td style={{ fontWeight: 600 }}>
                  {isWeakMatch && <span style={{ color: '#DC2626', marginRight: 6 }}>⚠</span>}
                  {s.society_name}
                </td>
                <td style={{ color: '#888' }}>{s.city || '—'}</td>
                <td>
                  {[s.tower && s.unit_no ? `${s.tower}-${s.unit_no}` : (s.tower || s.unit_no || '—'), s.floor && `F${s.floor}`]
                    .filter(Boolean)
                    .join(' · ')}
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