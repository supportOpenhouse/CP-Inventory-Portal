/**
 * Renders the result of /api/check-duplicate.
 * Props:
 *   result  — the API response: { match_level, block, message, details }
 *   onBack  — called when user clicks "Go back"
 */
export default function DuplicateCard({ result, onBack }) {
  const isExact = result.match_level === 'exact';
  const d = result.details || {};

  const details = [];
  if (d.tower) details.push({ label: 'Tower', value: d.tower });
  if (d.unit_no) details.push({ label: 'Unit', value: d.unit_no });
  if (d.floor != null) details.push({ label: 'Floor', value: d.floor });
  if (d.configuration) details.push({ label: 'Config', value: d.configuration });
  if (d.area_sqft) details.push({ label: 'Area', value: `${d.area_sqft} sqft` });
  if (d.registry_status) details.push({ label: 'Registry', value: d.registry_status });
  if (d.matched_count) details.push({ label: 'Matched units', value: d.matched_count });

  return (
    <div className={`dup-card ${isExact ? 'dup-card-exact' : 'dup-card-partial'}`}>
      <div className="dup-card-banner">
        <span className={`dup-card-badge ${isExact ? 'dup-card-badge-exact' : 'dup-card-badge-partial'}`}>
          {isExact ? 'EXACT MATCH' : 'PARTIAL MATCH'}
        </span>
        <div className="dup-card-banner-text">
          {isExact ? 'This unit is already\nwith Openhouse' : 'Similar units already\nwith Openhouse'}
        </div>
      </div>

      <div className="dup-card-body">
        <div className="dup-card-name">{d.society || '—'}</div>
        {d.city && <div className="dup-card-location">📍 {d.city}</div>}

        <div className="dup-card-message">{result.message}</div>

        {details.length > 0 && (
          <div className="dup-card-details">
            {details.map((item) => (
              <div key={item.label} className="dup-card-detail">
                <div className="dup-card-detail-label">{item.label}</div>
                <div className="dup-card-detail-value">{item.value}</div>
              </div>
            ))}
          </div>
        )}

        <button className="primary-btn" onClick={onBack}>Go back</button>
      </div>
    </div>
  );
}
