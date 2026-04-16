/**
 * Shows the result of /api/check-duplicate.
 * No internal inventory fields are displayed — just society name, city, and a generic message.
 *
 * Props:
 *   result     — { match_level, block, message, details: { society, city } }
 *   onBack     — called when user clicks the back button
 *   backLabel  — button label; defaults to "Go back" (Step 1 style); Step 4 uses "Return to Dashboard"
 */
export default function DuplicateCard({ result, onBack, backLabel = 'Go back' }) {
  const isExact = result.match_level === 'exact';
  const d = result.details || {};

  return (
    <div className={`dup-card ${isExact ? 'dup-card-exact' : 'dup-card-partial'}`}>
      <div className="dup-card-banner">
        <span className={`dup-card-badge ${isExact ? 'dup-card-badge-exact' : 'dup-card-badge-partial'}`}>
          {isExact ? 'ALREADY IN INVENTORY' : 'SIMILAR UNITS FOUND'}
        </span>
        <div className="dup-card-banner-text">
          {isExact ? 'This unit is already\nwith Openhouse' : 'Similar units already\nwith Openhouse'}
        </div>
      </div>

      <div className="dup-card-body">
        <div className="dup-card-name">{d.society || '—'}</div>
        {d.city && <div className="dup-card-location">📍 {d.city}</div>}

        <div className="dup-card-message">{result.message}</div>

        <button className="primary-btn" onClick={onBack}>{backLabel}</button>
      </div>
    </div>
  );
}