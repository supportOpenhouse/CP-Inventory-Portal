/**
 * Photos step — placeholder for v1.
 * Per product decision, photo upload is deferred. CPs share photos with their RM over WhatsApp.
 */
export default function Step3({ onNext, onBack }) {
  return (
    <div className="form-section">
      <div className="form-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }}>📸</div>
        <div className="form-card-title" style={{ marginBottom: 8 }}>
          Photos — coming soon
        </div>
        <p style={{ fontSize: 13, color: 'var(--oh-gray)', lineHeight: 1.5 }}>
          Photo uploads will be available in a future update. For now, please share
          unit photos with your RM over WhatsApp.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="secondary-btn" onClick={onBack}>Back</button>
        <button className="primary-btn" onClick={onNext}>Skip &amp; Continue</button>
      </div>
    </div>
  );
}
