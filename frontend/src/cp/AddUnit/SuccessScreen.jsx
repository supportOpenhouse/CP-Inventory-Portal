/**
 * Shown after a successful submission.
 * Shows the new public_id (OHLGC0001 etc.) as the primary identifier.
 * Falls back to the numeric submission ID if public_id is absent (for old data).
 *
 * When status is 'Unapproved', shows an admin-review message instead of the default.
 */
export default function SuccessScreen({ submissionId, publicId, status, onDone }) {
  const displayId = publicId || `#${submissionId}`;
  const isUnapproved = status === 'Unapproved';

  return (
    <div className="cp-shell">
      <div style={{ padding: '80px 20px 40px', textAlign: 'center' }}>
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: isUnapproved ? '#b8860b' : 'var(--oh-green)',
            color: '#fff',
            fontSize: 42,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: isUnapproved
              ? '0 6px 20px rgba(184,134,11,0.3)'
              : '0 6px 20px rgba(16,185,129,0.3)',
          }}
        >
          {isUnapproved ? '⏳' : '✓'}
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 28,
            color: 'var(--oh-charcoal)',
            marginBottom: 8,
          }}
        >
          {isUnapproved ? 'Pending Review' : 'Submitted!'}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--oh-gray)', lineHeight: 1.5, marginBottom: 20 }}>
          {isUnapproved ? (
            <>
              Your listing is being reviewed.<br />
              You'll be notified in next 24 hours.
            </>
          ) : (
            <>
              Your unit has been received for evaluation.<br />
              Our team will get back to you within 48 hours.
            </>
          )}
        </p>

        <div
          style={{
            display: 'inline-block',
            padding: '14px 22px',
            background: 'var(--oh-bg-warm)',
            border: '1.5px solid var(--oh-border)',
            borderRadius: 12,
            marginTop: 4,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--oh-gray)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 4 }}>
            LISTING ID
          </div>
          <div
            style={{
              fontSize: 24,
              color: 'var(--oh-charcoal)',
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: '1px',
            }}
          >
            {displayId}
          </div>
        </div>
      </div>

      <div style={{ padding: '0 20px' }}>
        <button className="primary-btn" onClick={onDone}>Back to Dashboard</button>
      </div>
    </div>
  );
}
