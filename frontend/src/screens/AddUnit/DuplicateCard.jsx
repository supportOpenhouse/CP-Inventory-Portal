/**
 * Shown when a submission hits a HARD-BLOCK duplicate ("already exists").
 * Soft-match warnings are rendered inline in Step1 as a yellow banner, not here.
 *
 * Props:
 *   result   — { match_level, block, message, details: { society, city, rm_name?, rm_phone? } }
 *   onEdit   — called when user wants to go back and modify their entry (e.g. change tower/unit)
 *   onAbandon — called when user wants to leave the Add Unit flow entirely
 */
export default function DuplicateCard({ result, onEdit, onAbandon }) {
  const d = result.details || {};
  const rmPhone = d.rm_phone;
  const rmName = d.rm_name;

  return (
    <div className="dup-card dup-card-exact">
      <div className="dup-card-banner">
        <span className="dup-card-badge dup-card-badge-exact">
          ALREADY IN INVENTORY
        </span>
        <div className="dup-card-banner-text">
          This unit is already{'\n'}with Openhouse
        </div>
      </div>

      <div className="dup-card-body">
        <div className="dup-card-name">{d.society || '—'}</div>
        {d.city && <div className="dup-card-location">📍 {d.city}</div>}

        <div className="dup-card-message">{result.message}</div>

        {/* Contact RM row — only shown if we have an RM phone */}
        {rmPhone && (
          <div className="dup-card-rm">
            <div className="dup-card-rm-label">Your Openhouse RM</div>
            <div className="dup-card-rm-name">{rmName || '—'}</div>
            <a
              href={`tel:${rmPhone.replace(/\s/g, '')}`}
              className="primary-btn"
              style={{
                display: 'block',
                textAlign: 'center',
                textDecoration: 'none',
                marginTop: 10,
              }}
            >
              📞 Contact RM {rmPhone ? `(${rmPhone})` : ''}
            </a>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          {onEdit && (
            <button
              type="button"
              className="secondary-btn"
              onClick={onEdit}
              style={{ flex: 1 }}
            >
              Edit details
            </button>
          )}
          {onAbandon && (
            <button
              type="button"
              className="secondary-btn"
              onClick={onAbandon}
              style={{ flex: 1 }}
            >
              Back to Dashboard
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
