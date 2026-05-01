import { useState } from 'react';

import Step1 from './Step1';
import SuccessScreen from './SuccessScreen';

// Single-step flow: all fields on Step 1, single Submit.

export default function AddUnit({ onDone }) {
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
    askPrice: '',      // user enters in LAKHS; stored to DB in rupees
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
          <button className="back-btn" onClick={onDone}>←</button>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Add Unit</span>
        </div>
      </div>

      <Step1
        form={form}
        setForm={setForm}
        onSubmitted={setSubmittedResult}
        onAbandon={onDone}
      />
    </div>
  );
}
