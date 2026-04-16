import { useState } from 'react';

import Step1 from './Step1';

const STEP_LABELS = {
  1: 'Unit Details',
  2: 'More Details',
  3: 'Photos',
  4: 'Pricing & Submit',
};

/* Placeholder for Steps 2/3/4 — filled in Step 2.4 */
function PlaceholderStep({ n, onBack, onDone }) {
  return (
    <div className="form-section">
      <div className="form-card">
        <div className="form-card-title">Step {n} — coming in 2.4</div>
        <p style={{ fontSize: 13, color: 'var(--oh-gray)', lineHeight: 1.6 }}>
          {n === 2 && 'More details form (floor, furnishing, facings, parking, extras, registry) lands in the next step.'}
          {n === 3 && 'Photos step — skipped for v1. This placeholder will stay as "Coming soon".'}
          {n === 4 && 'Pricing + seller details + final submit lands in the next step.'}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="secondary-btn" onClick={onBack}>Back</button>
        <button className="primary-btn" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

export default function AddUnit({ onDone }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    society: null,
    tower: '',
    unitNo: '',
    sqft: '',
    bhk: '',
    floor: '',
    furnishing: '',
    exitFacing: '',
    balconyFacing: '',
    view: '',
    parking: '',
    features: [],
    registryStatus: 'Registered',
    askPrice: '',
    closingPrice: '',
    sellerName: '',
    sellerPhone: '',
  });

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
        <Step1 form={form} setForm={setForm} onNext={() => setStep(2)} />
      )}
      {step === 2 && <PlaceholderStep n={2} onBack={() => setStep(1)} onDone={onDone} />}
      {step === 3 && <PlaceholderStep n={3} onBack={() => setStep(2)} onDone={onDone} />}
      {step === 4 && <PlaceholderStep n={4} onBack={() => setStep(3)} onDone={onDone} />}
    </div>
  );
}
