/**
 * Popup shown when a CP clicks "Submit without unit details" on Step 1.
 * Warns them that providing unit details helps register the unit in their name.
 *
 * Props:
 *   onContinue — proceeds without unit details (will be created as Unapproved)
 *   onBack     — goes back to the form so CP can enter tower/unit
 */
export default function NoUnitDetailsWarning({ onContinue, onBack }) {
  return (
    <div className="form-section">
      <div className="dup-card dup-card-exact">
        <div className="dup-card-banner" style={{ background: '#b8860b' }}>
          <span
            className="dup-card-badge dup-card-badge-exact"
            style={{ background: '#fff', color: '#b8860b' }}
          >
            PLEASE NOTE
          </span>
          <div
            className="dup-card-banner-text"
            style={{ whiteSpace: 'pre-line' }}
          >
            Providing unit details{'\n'}helps register it in your name
          </div>
        </div>

        <div className="dup-card-body">
          <div className="dup-card-message" style={{ lineHeight: 1.5 }}>
            Without tower and unit number, this listing will be flagged for admin review before it enters active inventory. Providing exact details helps register this unit in your name faster.
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button
              type="button"
              onClick={onContinue}
              style={{
                flex: 1,
                padding: '14px 16px',
                borderRadius: 12,
                border: '1.5px solid var(--oh-orange)',
                background: '#fff',
                color: 'var(--oh-orange)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Continue without unit details
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={onBack}
              style={{ flex: 1, marginTop: 0 }}
            >
              Enter unit details
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
