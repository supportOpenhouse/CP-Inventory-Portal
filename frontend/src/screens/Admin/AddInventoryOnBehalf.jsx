import { useState } from 'react';

import Step1 from '../AddUnit/Step1';
import Step2 from '../AddUnit/Step2';
import SuccessScreen from '../AddUnit/SuccessScreen';
import CpSelector from './CpSelector';

/**
 * Full-screen flow for RM/Manager/Admin to submit a listing on behalf of a CP.
 *
 * Mirrors the CP-side AddUnit two-step flow:
 *   Step 1 (AddUnit/Step1, mode="staff"): property identification + dup-check.
 *   Step 2 (AddUnit/Step2, mode="staff"): occupancy + asking + closing prices,
 *                                         then POSTs adminCreateSubmissionOnBehalf.
 *
 * Both steps only render once a target CP has been picked via CpSelector.
 *
 * Props:
 *   onClose: () => void  // back to admin board (called from header back-btn,
 *                        // and after SuccessScreen onDone)
 */
export default function AddInventoryOnBehalf({ onClose }) {
  const [targetCp, setTargetCp] = useState(null);
  const [submittedResult, setSubmittedResult] = useState(null);
  const [step, setStep] = useState(1);
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

  // When the user changes the CP, preserve EVERYTHING in the form. Reasoning:
  // resetting society would force a re-pick on the new CP, which triggers
  // selectSociety -> resetDeps() in Step1 and wipes BHK/floor/etc. The user's
  // common case is "I picked the wrong CP, want to switch but keep what I
  // typed." If the new CP is in a different city than the currently-selected
  // society, the staff member can change the city tab in Step1 manually.
  const handleChangeCp = (cp) => {
    setTargetCp(cp);
    // Intentionally no setForm here.
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

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        <CpSelector value={targetCp} onChange={handleChangeCp} />
      </div>

      {targetCp ? (
        step === 1 ? (
          <Step1
            form={form}
            setForm={setForm}
            onAdvance={() => setStep(2)}
            onAbandon={onClose}
            mode="staff"
            targetCp={targetCp}
          />
        ) : (
          <Step2
            form={form}
            setForm={setForm}
            onBack={() => setStep(1)}
            onSubmitted={setSubmittedResult}
            mode="staff"
            targetCp={targetCp}
          />
        )
      ) : (
        <div style={{ padding: 16, maxWidth: 720, margin: '0 auto', color: '#888', fontSize: 13, textAlign: 'center' }}>
          Pick a CP above to start entering inventory details.
        </div>
      )}
    </div>
  );
}
