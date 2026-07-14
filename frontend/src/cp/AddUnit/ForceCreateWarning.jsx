/**
 * Warning screen shown after CP opts to submit a unit that hit a duplicate.
 * Explains that admin review is required before it enters active inventory.
 *
 * Props:
 *   onConfirm — user confirms; parent sets forceCreate=true and continues to Step 2
 *   onCancel  — user goes back; parent shows DuplicateCard again
 */
export default function ForceCreateWarning({ onConfirm, onCancel }) {
  return (
    <div className="form-section">
      <div className="dup-card dup-card-exact">
        <div className="dup-card-banner" style={{ background: '#b8860b' }}>
          <span className="dup-card-badge dup-card-badge-exact" style={{ background: '#fff', color: '#b8860b' }}>
            ADMIN REVIEW REQUIRED
          </span>
          <div className="dup-card-banner-text" style={{ whiteSpace: 'pre-line' }}>
            Your listing will be{'\n'}reviewed by our team
          </div>
        </div>

        <div className="dup-card-body">
          <div className="dup-card-message" style={{ lineHeight: 1.5 }}>
            This unit appears to already be with Openhouse. If you still want to submit it, an admin will review the duplicate and decide whether to approve or reject.
          </div>

          <div
            className="dup-card-message"
            style={{ marginTop: 14, fontWeight: 500 }}
          >
            What happens next:
          </div>
          <ul style={{ margin: '6px 0 16px 20px', padding: 0, lineHeight: 1.6, fontSize: 14 }}>
            <li>You'll get a Listing ID right away</li>
            <li>Status will show as <strong>Pending Review</strong> on your Dashboard</li>
            <li>Admin will approve or reject after reviewing</li>
            <li>You'll be notified of the decision</li>
          </ul>

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button
              type="button"
              className="secondary-btn"
              onClick={onCancel}
              style={{ flex: 1 }}
            >
              Go back
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={onConfirm}
              style={{ flex: 1 }}
            >
              Yes, submit for review
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
