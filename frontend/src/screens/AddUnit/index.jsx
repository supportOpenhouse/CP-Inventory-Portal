import { useState } from 'react';

import Step1 from './Step1';
import Step4 from './Step4';
import SuccessScreen from './SuccessScreen';

// Steps 2 (More Details) and 3 (Photos) are temporarily disabled.
// The files are kept in the repo; re-enable by restoring the routing below.

const STEP_LABELS = {
  1: 'Unit Details',
  2: 'Registry & Pricing',
};

export default function AddUnit({ onDone }) {
  // Step is now 1 or 2 (which maps to the original Step4 "Registry & Pricing" component)
  const [step, setStep] = useState(1);
  const [submittedResult, setSubmittedResult] = useState(null);
  const [form, setForm] = useState({
    city: '',
    society: null,
    tower: '',
    unitNo: '',
    sqft: '',
    bhk: '',
    floor: '',
    // Step 2 & 3 fields retained for back-compat with the DB; unused in flow.
    exitFacing: '',
    balconyFacing: '',
    view: '',
    parking: '',
    features: [],
    registryStatus: 'Registered',
    askPrice: '',      // user enters in LAKHS; stored to DB in rupees
    closingPrice: '',  // user enters in LAKHS; stored to DB in rupees
    photos: [],
    sellerName: '',
    sellerPhone: '',
    // Flags set by Step1
    forceCreate: false,       // CP clicked "Add anyway" after duplicate
    skipUnitDetails: false,   // CP clicked "Continue without unit details"
  });

  if (submittedResult) {
    return (
      <SuccessScreen
        submissionId={submittedResult.id}
        publicId={submittedResult.public_id}
        status={submittedResult.status}
        onDone={onDone}
      />
    );
  }

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
    else onDone();
  };

  return (
    <div className="app-shell">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="back-btn" onClick={handleBack}>←</button>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Add Unit</span>
        </div>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
          Step {step}/2
        </span>
      </div>

      <div className="progress-bar">
        {[1, 2].map((i) => (
          <div
            key={i}
            className={`progress-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
          />
        ))}
      </div>

      <div className="step-label"><strong>{STEP_LABELS[step]}</strong></div>

      {step === 1 && (
        <Step1 form={form} setForm={setForm} onNext={() => setStep(2)} onAbandon={onDone} />
      )}
      {step === 2 && (
        <Step4
          form={form}
          setForm={setForm}
          onBack={() => setStep(1)}
          onSubmitted={setSubmittedResult}
          onAbandon={onDone}
        />
      )}
    </div>
  );
}
