const FACING_OPTIONS = [
  'North', 'South', 'East', 'West',
  'North-East', 'North-West', 'South-East', 'South-West',
];
const VIEW_OPTIONS = [
  'Society View', 'Park View', 'Road View',
  'Garden View', 'Pool View', 'External View',
];
const FEATURE_OPTIONS = [
  'Puja Room', 'Study Room', 'Servant Room', 'Store Room',
];
const PARKING_OPTIONS = [
  '1 Open',
  '1 Closed',
  '2 Open',
  '2 Closed',
  '1 Open & 1 Closed',
  'No Parking',
];

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
      {/* Card 1: Extra Rooms */}
      <div className="form-card">
        <div className="form-card-title">Extra Rooms</div>
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
      </div>

      {/* Card 2: Orientation & View */}
      <div className="form-card">
        <div className="form-card-title">Orientation & View</div>
        <div className="input-label">Exit Facing (Vastu)</div>
        <select
          className="select-field"
          value={form.exitFacing}
          onChange={(e) => setForm({ ...form, exitFacing: e.target.value })}
        >
          <option value="">Select</option>
          {FACING_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>

        <div className="input-label" style={{ marginTop: 12 }}>
          Balcony Facing (Sunlight)
        </div>
        <select
          className="select-field"
          value={form.balconyFacing}
          onChange={(e) => setForm({ ...form, balconyFacing: e.target.value })}
        >
          <option value="">Select</option>
          {FACING_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>

        <div className="input-label" style={{ marginTop: 12 }}>Balcony View</div>
        <select
          className="select-field"
          value={form.view}
          onChange={(e) => setForm({ ...form, view: e.target.value })}
        >
          <option value="">Select</option>
          {VIEW_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {/* Card 3: Parking */}
      <div className="form-card">
        <div className="form-card-title">Parking</div>
        <div className="input-label">Parking</div>
        <select
          className="select-field"
          value={form.parking || ''}
          onChange={(e) => setForm({ ...form, parking: e.target.value })}
        >
          <option value="">Select</option>
          {PARKING_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="secondary-btn" onClick={onBack}>Back</button>
        <button className="primary-btn" onClick={onNext}>Continue</button>
      </div>
    </div>
  );
}
