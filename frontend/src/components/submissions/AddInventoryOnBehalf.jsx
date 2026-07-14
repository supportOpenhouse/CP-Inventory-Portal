import { useEffect, useState } from 'react';

import Step1 from '../../cp/AddUnit/Step1';
import CpSelector from '../CpSelector.jsx';
import { IconClose } from '../icons.jsx';

/**
 * Popup for RM/Manager/Admin to submit a listing on behalf of a CP.
 *
 * Ported from CP-Inventory-Portal's `screens/Admin/AddInventoryOnBehalf.jsx`
 * — SAME three-step logic (city → CP → form), but presented as a modal
 * instead of a full-screen subview, and restyled with this app's tokens:
 *   1. Pick a city  (Noida / Gurgaon / Ghaziabad).
 *   2. Pick a CP    (any active CP in that city, ignoring the staff member's
 *                    own scope — CpSelector already handles the city-restrict).
 *   3. Fill the form (reuses AddUnit/Step1 with mode="staff", which posts to
 *                     /admin/submissions/on-behalf with target_cp_id).
 *
 * Props:
 *   onClose:   () => void   — dismiss the popup.
 *   onCreated: () => void   — fired after a successful submit (parent reloads).
 */
const CITIES = ['Noida', 'Gurgaon', 'Ghaziabad'];

const EMPTY_FORM = {
  city: '', society: null, tower: '', unitNo: '', sqft: '', bhk: '', floor: '',
  occupancyStatus: 'Vacant', askPrice: '', photos: [], sellerName: '', sellerPhone: '',
  forceCreate: false, skipUnitDetails: false,
};

export default function AddInventoryOnBehalf({ onClose, onCreated }) {
  const [city, setCity] = useState('');
  const [targetCp, setTargetCp] = useState(null);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Switching city resets the picked CP — they could be from a different city,
  // so force a re-pick rather than leave the form pointed at a mismatched CP.
  const changeCity = (next) => {
    if (next === city) return;
    setCity(next);
    setTargetCp(null);
  };

  const addAnother = () => {
    setResult(null);
    setForm(EMPTY_FORM);      // fresh listing; keep the same city + CP picked.
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head-row">
          <h3 style={{ marginBottom: 0 }}>
            Add Inventory{' '}
            <span className="muted" style={{ fontWeight: 400 }}>(on behalf of CP)</span>
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>

        {result ? (
          <div style={{ textAlign: 'center', padding: '24px 8px 8px' }}>
            <div style={{
              width: 64, height: 64, margin: '0 auto', borderRadius: '50%',
              background: result.status === 'Unapproved' ? 'var(--amber)' : 'var(--oh-green)',
              color: '#fff', fontSize: 34, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✓</div>
            <h3 style={{ marginTop: 16, marginBottom: 4 }}>
              {result.status === 'Unapproved' ? 'Submitted for review' : 'Inventory added'}
            </h3>
            <div className="muted" style={{ fontSize: 14 }}>
              {result.public_id || `#${result.id}`}
              {result.status ? <> · {result.status}</> : null}
              {targetCp ? <> · for {targetCp.name || targetCp.phone}</> : null}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 22 }}>
              <button type="button" className="btn-ghost" onClick={addAnother}>Add another</button>
              <button type="button" className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            {/* Step 1: city */}
            <div className="field-lbl" style={{ marginBottom: 6 }}>City</div>
            <div className="city-tabs">
              {CITIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`tab${city === c ? ' tab-active' : ''}`}
                  onClick={() => changeCity(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            {!city && (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Pick the city first — the CP search will only show CPs from that city.
              </div>
            )}

            {/* Step 2: CP */}
            {city && (
              <div style={{ marginTop: 16 }}>
                {targetCp ? (
                  <div className="obh-cp-card">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="field-lbl">CP</div>
                      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{targetCp.name || '(no name)'}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
                        <span style={{ fontFamily: 'monospace' }}>{targetCp.phone || '—'}</span>
                        {targetCp.cp_code ? <span> · {targetCp.cp_code}</span> : null}
                        {targetCp.city ? <span> · {targetCp.city}</span> : null}
                        {targetCp.company ? <span> · {targetCp.company}</span> : null}
                      </div>
                    </div>
                    <button type="button" className="btn-ghost" onClick={() => setTargetCp(null)}>Change CP</button>
                  </div>
                ) : (
                  <>
                    <div className="field-lbl" style={{ marginBottom: 6 }}>Pick CP</div>
                    <CpSelector city={city} onSelect={setTargetCp} />
                  </>
                )}
              </div>
            )}

            {/* Step 3: the listing form */}
            {city && targetCp ? (
              <div style={{ marginTop: 20, borderTop: '1px solid var(--hairline)', paddingTop: 16 }}>
                <Step1
                  form={form}
                  setForm={setForm}
                  onSubmitted={(r) => { setResult(r); onCreated?.(); }}
                  onAbandon={onClose}
                  mode="staff"
                  targetCp={targetCp}
                />
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 13, textAlign: 'center', padding: '20px 8px 4px' }}>
                {!city
                  ? 'Pick a city above to start.'
                  : 'Pick a CP above to start entering inventory details.'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
