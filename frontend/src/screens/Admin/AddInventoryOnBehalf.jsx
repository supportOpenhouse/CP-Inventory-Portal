import { useState } from 'react';

import Step1 from '../AddUnit/Step1';
import SuccessScreen from '../AddUnit/SuccessScreen';
import CpSelector from './CpSelector';

/**
 * Full-screen flow for RM/Manager/Admin to submit a listing on behalf of a CP.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ ← Back to admin     Add Inventory (on behalf of CP)      │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ ┌────────────────────────────────────────────────────┐   │
 *   │ │ CP selector (sticky-ish at top of scroll area)     │   │
 *   │ └────────────────────────────────────────────────────┘   │
 *   │ ┌────────────────────────────────────────────────────┐   │
 *   │ │ Step1 (existing AddUnit form, with mode="staff")   │   │
 *   │ │   only rendered once a CP is picked                │   │
 *   │ └────────────────────────────────────────────────────┘   │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Props:
 *   onClose: () => void  // back to admin board (called from header back-btn,
 *                        // and after SuccessScreen onDone)
 */
export default function AddInventoryOnBehalf({ onClose }) {
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
    exitFacing: '',
    balconyFacing: '',
    view: '',
    parking: '',
    features: [],
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
      <div className="header" style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid #eee' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="back-btn" onClick={onClose}>←</button>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            Add Inventory <span style={{ fontWeight: 400, color: '#888' }}>(on behalf of CP)</span>
          </span>
        </div>
      </div>

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        <CpSelector value={targetCp} onChange={handleChangeCp} />
      </div>

      {targetCp ? (
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
          Pick a CP above to start entering inventory details.
        </div>
      )}
    </div>
  );
}
