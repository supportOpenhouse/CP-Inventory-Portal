/**
 * Shown when a submission hits a duplicate signal that warrants showing
 * the "Contact RM" page instead of dropping the CP back to their dashboard.
 *
 * Three variants today:
 *   1. Perfect match (match_level==='exact' && block===true)
 *      → Red "ALREADY IN INVENTORY" badge, banner "This unit is already with Openhouse"
 *      → No Edit/Add anyway buttons (the unit is already there)
 *
 *   2. Unit-less + collated match (unit_less_collated===true)
 *      → Yellow "SIMILAR MATCH" badge, banner "Similar Unit exists with Openhouse"
 *      → No Edit/Add anyway buttons (the row is already created in DB)
 *
 *   3. Other duplicates (weak match, partial, etc.)
 *      → Same red banner as variant 1 (existing behavior)
 *      → Edit/Add anyway buttons shown so CP can override
 *
 * Props:
 *   result       — { match_level, block, message, details, unit_less_collated? }
 *   onEdit       — called when user wants to go back and modify their entry
 *   onForceCreate — called when user wants to submit anyway
 */
export default function DuplicateCard({ result, onEdit, onForceCreate }) {
  const d = result.details || {};
  const rmPhone = d.rm_phone;
  const rmName = d.rm_name;

  const isPerfectMatch = result?.match_level === 'exact' && result?.block === true;
  const isUnitLessCollated = result?.unit_less_collated === true;

  // Pick badge + title + body styling based on variant
  let badgeText, badgeClass, bannerTitle, bannerClass;
  if (isUnitLessCollated) {
    badgeText = 'SIMILAR MATCH';
    badgeClass = 'dup-card-badge-similar';
    bannerTitle = 'Similar Unit exists\nwith Openhouse';
    bannerClass = 'dup-card-banner-similar';
  } else {
    badgeText = 'ALREADY IN INVENTORY';
    badgeClass = 'dup-card-badge-exact';
    bannerTitle = result.banner_title || 'This unit is already\nwith Openhouse';
    bannerClass = '';
  }

  // Edit / Add anyway buttons only for "soft" duplicates — perfect match and
  // unit-less collated are treated as "already done" so we hide them.
  const hideActionButtons = isPerfectMatch || isUnitLessCollated;

  // Inline styles for the unit-less-collated yellow variant (the existing
  // .dup-card-badge-exact class is red). Keeping inline so we don't have to
  // add CSS — this component is rendered in only a few places.
  const similarBadgeStyle = isUnitLessCollated
    ? {
        background: '#FCD34D',
        color: '#78350F',
        fontWeight: 700,
        letterSpacing: '0.5px',
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: 11,
      }
    : undefined;

  const similarBannerStyle = isUnitLessCollated
    ? { background: 'linear-gradient(135deg, #fef3c7 0%, #fcd34d 60%, #fbbf24 100%)', color: '#78350F' }
    : undefined;

  return (
    <div className="dup-card dup-card-exact">
      <div className="dup-card-banner" style={similarBannerStyle}>
        <span className={`dup-card-badge ${badgeClass}`} style={similarBadgeStyle}>
          {badgeText}
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

        {!hideActionButtons && (
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
        )}
      </div>
    </div>
  );
}
