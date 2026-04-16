const FURNISHING_OPTIONS = ['Unfurnished', 'Semi-Furnished', 'Fully Furnished'];
const FACING_OPTIONS = [
  'North', 'South', 'East', 'West',
  'North-East', 'North-West', 'South-East', 'South-West',
];
const VIEW_OPTIONS = [
  'Society View', 'Park View', 'Road View',
  'Garden View', 'Pool View', 'External View',
];
const FEATURE_OPTIONS = [
  'Puja Room', 'Study Room', 'Servant Room', 'Store Room', 'Dry Balcony',
];
const REGISTRY_OPTIONS = ['Registered', 'Unregistered'];

export default function Step2({ form, setForm, onNext, onBack }) {
  const toggleFeature = (feat) => {
    const current = form.features || [];
    const next = current.includes(feat)
      ? current.filter((f) => f !== feat)
      : [...current, feat];
    setForm({ ...form, features: next });
  };

  return (
    <div className="form-section">
      <div className="form-card">
        <div className="form-card-title">Floor & Furnishing</div>
        <div className="form-row" style={{ marginBottom: 12 }}>
          <div>
            <div className="input-label">Floor</div>
            <input
              className="input-field"
              placeholder="e.g. 7, G, B1"
              value={form.floor}
              onChange={(e) => setForm({ ...form, floor: e.target.value })}
            />
          </div>
          <div>
            <div className="input-label">Furnishing</div>
            <select
              className="select-field"
              value={form.furnishing}
              onChange={(e) => setForm({ ...form, furnishing: e.target.value })}
            >
              <option value="">Select</option>
              {FURNISHING_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        <div className="input-label">Registry status</div>
        <select
          className="select-field"
          value={form.registryStatus}
          onChange={(e) => setForm({ ...form, registryStatus: e.target.value })}
        >
          {REGISTRY_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="form-card">
        <div className="form-card-title">Facings & View</div>
        <div className="form-row" style={{ marginBottom: 12 }}>
          <div>
            <div className="input-label">Exit facing</div>
            <select
              className="select-field"
              value={form.exitFacing}
              onChange={(e) => setForm({ ...form, exitFacing: e.target.value })}
            >
              <option value="">Select</option>
              {FACING_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <div className="input-label">Balcony facing</div>
            <select
              className="select-field"
              value={form.balconyFacing}
              onChange={(e) => setForm({ ...form, balconyFacing: e.target.value })}
            >
              <option value="">Select</option>
              {FACING_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        <div className="input-label">View from balcony</div>
        <select
          className="select-field"
          value={form.view}
          onChange={(e) => setForm({ ...form, view: e.target.value })}
        >
          <option value="">Select</option>
          {VIEW_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      <div className="form-card">
        <div className="form-card-title">Parking</div>
        <div className="form-row">
          <div>
            <div className="input-label">Covered</div>
            <input
              className="input-field"
              inputMode="numeric"
              placeholder="0"
              value={form.coveredParking || ''}
              onChange={(e) =>
                setForm({ ...form, coveredParking: e.target.value.replace(/\D/g, '') })
              }
            />
          </div>
          <div>
            <div className="input-label">Open</div>
            <input
              className="input-field"
              inputMode="numeric"
              placeholder="0"
              value={form.openParking || ''}
              onChange={(e) =>
                setForm({ ...form, openParking: e.target.value.replace(/\D/g, '') })
              }
            />
          </div>
        </div>
      </div>

      <div className="form-card">
        <div className="form-card-title">Extra rooms / features</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {FEATURE_OPTIONS.map((feat) => {
            const active = (form.features || []).includes(feat);
            return (
              <button
                key={feat}
                type="button"
                onClick={() => toggleFeature(feat)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 20,
                  border: `1.5px solid ${active ? 'var(--oh-orange)' : 'var(--oh-border)'}`,
                  background: active ? 'var(--oh-orange-light)' : '#fff',
                  color: active ? 'var(--oh-orange)' : 'var(--oh-charcoal)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {feat}
              </button>
            );
          })}
        </div>
        <div className="optional-hint">All fields on this step are optional.</div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="secondary-btn" onClick={onBack}>Back</button>
        <button className="primary-btn" onClick={onNext}>Continue</button>
      </div>
    </div>
  );
}
