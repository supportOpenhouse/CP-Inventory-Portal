/**
 * Shown when a submission hits a HARD-BLOCK duplicate ("already exists").
 * Soft-match warnings are rendered inline in Step1 as a yellow banner, not here.
 *
 * Props:
 *   result       — { match_level, block, message, details: { society, city, rm_name?, rm_phone? } }
 *   onEdit       — called when user wants to go back and modify their entry (e.g. change tower/unit)
 *   onForceCreate — called when user wants to submit anyway (opens warning screen in parent)
 */
export default function DuplicateCard({ result, onEdit, onForceCreate }) {
  const d = result.details || {};
  const rmPhone = d.rm_phone;
  const rmName = d.rm_name;
  const bannerTitle = result.banner_title || 'This unit is already\nwith Openhouse';

  return (
    <div className="dup-card dup-card-exact">
      <div className="dup-card-banner">
        <span className="dup-card-badge dup-card-badge-exact">
          ALREADY IN INVENTORY
        </span>
        <div className="dup-card-banner-text" style={{ whiteSpace: 'pre-line' }}>
          {bannerTitle}
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

        {/* For perfect-match (exact + block), the listing is already with us — CP can
            only Contact RM. Edit/Add-anyway buttons would be misleading, so hide them. */}
        {(() => {
          const isPerfectMatch = result?.match_level === 'exact' && result?.block === true;
          if (isPerfectMatch) return null;
          return (
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
              {onForceCreate && (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={onForceCreate}
                  style={{ flex: 1 }}
                >
                  Add anyway
                </button>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}