/**
 * Shown after a successful submission. CP sees submission ID + button to return to dashboard.
 * When onDone is called, parent unmounts AddUnit → Dashboard remounts → fetches fresh submissions.
 */
export default function SuccessScreen({ submissionId, onDone }) {
  return (
    <div className="app-shell">
      <div style={{ padding: '80px 20px 40px', textAlign: 'center' }}>
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'var(--oh-green)',
            color: '#fff',
            fontSize: 42,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 6px 20px rgba(16,185,129,0.3)',
          }}
        >
          ✓
        </div>
        <h1
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 28,
            color: 'var(--oh-charcoal)',
            marginBottom: 8,
          }}
        >
          Submitted!
        </h1>
        <p style={{ fontSize: 14, color: 'var(--oh-gray)', lineHeight: 1.5, marginBottom: 6 }}>
          Your unit has been received for evaluation.<br />
          Our team will get back to you within 48 hours.
        </p>
        <p style={{ fontSize: 13, color: 'var(--oh-gray)', marginTop: 16 }}>
          Submission ID: <strong style={{ color: 'var(--oh-charcoal)' }}>#{submissionId}</strong>
        </p>
      </div>

      <div style={{ padding: '0 20px' }}>
        <button className="primary-btn" onClick={onDone}>Back to Dashboard</button>
      </div>
    </div>
  );
}
