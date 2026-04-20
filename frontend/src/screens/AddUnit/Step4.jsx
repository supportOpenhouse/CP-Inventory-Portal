import { useState } from 'react';

import { api, ApiError } from '../../api';
import { formatIndianNumber, formatPrice } from '../../format';
import DuplicateCard from './DuplicateCard';

export default function Step4({ form, setForm, onBack, onSubmitted, onAbandon }) {
  const [submitting, setSubmitting] = useState(false);
  const [dupResult, setDupResult] = useState(null);
  const [apiError, setApiError] = useState('');

  const handleSubmit = async () => {
    setApiError('');
    setDupResult(null);
    setSubmitting(true);

    try {
      const payload = {
        society_id: form.society.id,
        society_name: form.society.name,
        tower: form.tower || null,
        unit_no: form.unitNo || null,
        floor: form.floor || null,
        sqft: form.sqft ? parseInt(form.sqft) : null,
        bhk: form.bhk || null,
        furnishing: form.furnishing || null,
        exit_facing: form.exitFacing || null,
        balcony_facing: form.balconyFacing || null,
        balcony_view: form.view || null,
        parking: form.parking || null,
        extra_rooms: form.features || [],
        registry_status: form.registryStatus || null,
        asking_price: form.askPrice ? parseInt(form.askPrice) : null,
        closing_price: form.closingPrice ? parseInt(form.closingPrice) : null,
        seller_name: form.sellerName || null,
        seller_phone: form.sellerPhone || null,
        photos: form.photos || [],
      };

      const result = await api.createSubmission(payload);
      onSubmitted({ id: result.submission_id, public_id: result.public_id });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data?.duplicate) {
        setDupResult(err.data.duplicate);
      } else {
        setApiError(err instanceof ApiError ? err.message : 'Submission failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (dupResult) {
    return (
      <div className="form-section">
        <DuplicateCard
          result={dupResult}
          onAbandon={onAbandon}
          onEdit={() => setDupResult(null)}
        />
      </div>
    );
  }

  return (
    <div className="form-section">
      <div className="form-card">
        <div className="form-card-title">Registry & Pricing</div>

        <div className="input-label">Registry Status</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          {['Registered', 'Unregistered'].map((status) => {
            const active = form.registryStatus === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setForm({ ...form, registryStatus: status })}
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: `1.5px solid ${active ? 'var(--oh-orange)' : 'var(--oh-border)'}`,
                  background: active ? 'var(--oh-orange-light)' : '#fff',
                  color: active ? 'var(--oh-orange)' : 'var(--oh-charcoal)',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {status}
              </button>
            );
          })}
        </div>

        <div className="input-label">Asking Price (₹)</div>
        <input
          className="input-field"
          inputMode="numeric"
          placeholder="e.g. 95,00,000"
          value={formatIndianNumber(form.askPrice)}
          onChange={(e) => setForm({ ...form, askPrice: e.target.value.replace(/\D/g, '') })}
        />
        {form.askPrice && <div className="optional-hint">{formatPrice(form.askPrice)}</div>}

        <div className="input-label" style={{ marginTop: 14 }}>
          Tentative Closing Price (₹)
        </div>
        <input
          className="input-field"
          inputMode="numeric"
          placeholder="What seller will accept"
          value={formatIndianNumber(form.closingPrice)}
          onChange={(e) => setForm({ ...form, closingPrice: e.target.value.replace(/\D/g, '') })}
        />
        {form.closingPrice && <div className="optional-hint">{formatPrice(form.closingPrice)}</div>}
      </div>

      {apiError && <div className="error-text" style={{ marginTop: 12 }}>{apiError}</div>}

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="secondary-btn" onClick={onBack} disabled={submitting}>Back</button>
        <button className="primary-btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? <><span className="spinner" />Submitting…</> : 'Submit Unit'}
        </button>
      </div>
    </div>
  );
}
