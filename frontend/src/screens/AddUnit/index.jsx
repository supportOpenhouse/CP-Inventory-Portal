import { useState } from 'react';

import Step1 from './Step1';
import Step2 from './Step2';
import SuccessScreen from './SuccessScreen';

// Two-step flow:
//   Step 1: property identification (society, tower, unit, BHK, floor, area)
//           + duplicate check. User must clear the dup check before advancing.
//   Step 2: occupancy + pricing (asking, closing) + actual submit.

export default function AddUnit({ onDone }) {
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
    askPrice: '',       // user enters in LAKHS; stored to DB in rupees
    photos: [],
    sellerName: '',
    sellerPhone: '',
    forceCreate: false,
    skipUnitDetails: false,
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

  return (
    <div className="app-shell">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="back-btn"
            onClick={() => (step === 2 ? setStep(1) : onDone())}
          >
            ←
          </button>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            Add Unit · Step {step} of 2
          </span>
        </div>
      </div>

      {step === 1 ? (
        <Step1
          form={form}
          setForm={setForm}
          onAdvance={() => setStep(2)}
          onAbandon={onDone}
        />
      ) : (
        <Step2
          form={form}
          setForm={setForm}
          onBack={() => setStep(1)}
          onSubmitted={setSubmittedResult}
        />
      )}
    </div>
  );
}
