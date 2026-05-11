import { useState } from 'react';

import Step1 from '../AddUnit/Step1';
import SuccessScreen from '../AddUnit/SuccessScreen';
import CpSelector from './CpSelector';

const CITIES = ['Noida', 'Gurgaon', 'Ghaziabad'];

/**
 * Full-screen flow for RM/Manager/Admin to submit a listing on behalf of a CP.
 *
 * Three steps:
 *   1. Pick a city  (Noida / Gurgaon / Ghaziabad).
 *   2. Pick a CP    (searches all active CPs in that city, regardless of
 *                    the staff member's personal CP scope).
 *   3. Fill the form (reuses AddUnit/Step1 with mode="staff").
 *
 * Props:
 *   onClose: () => void  // back to admin board (called from header back-btn,
 *                        // and after SuccessScreen onDone)
 */
export default function AddInventoryOnBehalf({ onClose }) {
  const [city, setCity] = useState('');
  const [targetCp, setTargetCp] = useState(null);
  const [submittedResult, setSubmittedResult] = useState(null);
  const [form, setForm] = useState({
    city: '',
    society: null,
    tower: '',
    unitNo: '',
    sqft: '',
    bhk: '',
    floor: '',
    occupancyStatus: 'Vacant',
    askPrice: '',
    photos: [],
    sellerName: '',
    sellerPhone: '',
    forceCreate: false,
    skipUnitDetails: false,
  });

  // After a successful submit, show the same SuccessScreen the CP flow uses,
  // then `onClose` returns to the admin board.
  if (submittedResult) {
    return (
      <SuccessScreen
        submissionId={submittedResult.id}
        publicId={submittedResult.public_id}
        status={submittedResult.status}
        onDone={onClose}
      />
    );
  }

  // Switching city resets the picked CP — they could be from a different
  // city, and we'd rather force a re-pick than leave the form pointed at
  // a now-mismatched CP.
  const handleChangeCity = (next) => {
    if (next === city) return;
    setCity(next);
    setTargetCp(null);
  };

  // When the user changes the CP, preserve EVERYTHING else in the form.
  // Resetting society would force a re-pick on the new CP, which triggers
  // selectSociety -> resetDeps() in Step1 and wipes BHK/floor/etc. The
  // common case is "I picked the wrong CP" — keep what they typed.
  const handleChangeCp = (cp) => {
    setTargetCp(cp);
  };

  return (
    <div className="app-shell">
      {/* Custom header — NOT the global .header class, which is mobile/CP-side
          dark gradient with white text. Admin desktop view needs a light header
          with dark text so the back button is visible. */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#fff', borderBottom: '1px solid #eee',
        padding: '12px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          onClick={onClose}
          type="button"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#fff', border: '1px solid #ddd',
            borderRadius: 6, padding: '6px 12px',
            color: '#222', fontSize: 14, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          ← Back
        </button>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#222' }}>
          Add Inventory{' '}
          <span style={{ fontWeight: 400, color: '#888' }}>(on behalf of CP)</span>
        </span>
      </div>

      {/* Step 1: city. Sticky card at the top so it's always visible while
          the user is choosing a CP. */}
      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        <div style={{
          padding: '12px 16px', background: '#fff',
          border: '1px solid #e5e5e5', borderRadius: 8,
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
            City
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CITIES.map((c) => {
              const active = city === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleChangeCity(c)}
                  style={{
                    padding: '8px 16px',
                    border: `1px solid ${active ? '#FF6B2B' : '#ccc'}`,
                    background: active ? '#FF6B2B' : '#fff',
                    color: active ? '#fff' : '#222',
                    borderRadius: 6,
                    fontSize: 14, fontWeight: active ? 600 : 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>
          {!city && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
              Pick the city first — the CP search will only show CPs from that city.
            </div>
          )}
        </div>

        {/* Step 2: CP. Only shown once a city is picked. */}
        {city && (
          <CpSelector value={targetCp} onChange={handleChangeCp} city={city} />
        )}
      </div>

      {/* Step 3: the listing form. Only shown once a CP is picked. */}
      {city && targetCp ? (
        <Step1
          form={form}
          setForm={setForm}
          onSubmitted={setSubmittedResult}
          onAbandon={onClose}
          mode="staff"
          targetCp={targetCp}
        />
      ) : (
        <div style={{ padding: 16, maxWidth: 720, margin: '0 auto', color: '#888', fontSize: 13, textAlign: 'center' }}>
          {!city
            ? 'Pick a city above to start.'
            : 'Pick a CP above to start entering inventory details.'}
        </div>
      )}
    </div>
  );
}
