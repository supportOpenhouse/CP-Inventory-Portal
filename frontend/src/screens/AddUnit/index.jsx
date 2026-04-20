import { useState } from 'react';

import Step1 from './Step1';
import Step2 from './Step2';
import Step3 from './Step3';
import Step4 from './Step4';
import SuccessScreen from './SuccessScreen';

const STEP_LABELS = {
  1: 'Unit Details',
  2: 'More Details',
  3: 'Photos',
  4: 'Registry & Pricing',
};

export default function AddUnit({ onDone }) {
  const [step, setStep] = useState(1);
  const [submittedResult, setSubmittedResult] = useState(null); // { id, public_id }
  const [form, setForm] = useState({
    society: null,
    tower: '',
    unitNo: '',
    sqft: '',
    bhk: '',
    floor: '',
    // Removed: furnishing (per new spec, not collected in Step 2 anymore)
    exitFacing: '',
    balconyFacing: '',
    view: '',
    // Parking is now a single string choice rather than counts
    parking: '',
    features: [],
    registryStatus: 'Registered',
    askPrice: '',
    closingPrice: '',
    photos: [],
    // Seller contact fields retained in form state for back-compat,
    // even though they're no longer collected on Step 4.
    sellerName: '',
    sellerPhone: '',
  });

  if (submittedResult) {
    return (
      <SuccessScreen
        submissionId={submittedResult.id}
        publicId={submittedResult.public_id}
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
          Step {step}/4
        </span>
      </div>

      <div className="progress-bar">
        {[1, 2, 3, 4].map((i) => (
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
        <Step2 form={form} setForm={setForm} onNext={() => setStep(3)} onBack={() => setStep(1)} />
      )}
      {step === 3 && (
        <Step3 form={form} setForm={setForm} onNext={() => setStep(4)} onBack={() => setStep(2)} />
      )}
      {step === 4 && (
        <Step4
          form={form}
          setForm={setForm}
          onBack={() => setStep(3)}
          onSubmitted={setSubmittedResult}
          onAbandon={onDone}
        />
      )}
    </div>
  );
}
