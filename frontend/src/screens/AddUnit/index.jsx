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
  4: 'Pricing & Submit',
};

export default function AddUnit({ onDone }) {
  const [step, setStep] = useState(1);
  const [submittedId, setSubmittedId] = useState(null);
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
    coveredParking: '',
    openParking: '',
    features: [],
    registryStatus: 'Registered',
    askPrice: '',
    closingPrice: '',
    sellerName: '',
    sellerPhone: '',
  });

  if (submittedId) {
    return <SuccessScreen submissionId={submittedId} onDone={onDone} />;
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
        <Step1 form={form} setForm={setForm} onNext={() => setStep(2)} />
      )}
      {step === 2 && (
        <Step2 form={form} setForm={setForm} onNext={() => setStep(3)} onBack={() => setStep(1)} />
      )}
      {step === 3 && (
        <Step3 onNext={() => setStep(4)} onBack={() => setStep(2)} />
      )}
      {step === 4 && (
        <Step4
          form={form}
          setForm={setForm}
          onBack={() => setStep(3)}
          onSubmitted={setSubmittedId}
          onAbandon={onDone}
        />
      )}
    </div>
  );
}