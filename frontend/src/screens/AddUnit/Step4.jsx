import { useState } from 'react';

import { api, ApiError } from '../../api';
import DuplicateCard from './DuplicateCard';

function formatPrice(val) {
  const n = parseInt(val);
  if (!n || isNaN(n)) return '';
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + ' Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + ' L';
  return '₹' + n.toLocaleString('en-IN');
}

function buildParkingString(form) {
  const closed = parseInt(form.coveredParking) || 0;
  const open = parseInt(form.openParking) || 0;
  const parts = [];
  if (closed > 0) parts.push(`${closed} Closed`);
  if (open > 0) parts.push(`${open} Open`);
  return parts.join(' & ') || null;
}

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
        parking: buildParkingString(form),
        extra_rooms: form.features || [],
        registry_status: form.registryStatus || null,
        asking_price: form.askPrice ? parseInt(form.askPrice) : null,
        closing_price: form.closingPrice ? parseInt(form.closingPrice) : null,
        seller_name: form.sellerName || null,
        seller_phone: form.sellerPhone || null,
        photos: form.photos || [],
      };

      const result = await api.createSubmission(payload);
      onSubmitted(result.submission_id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data?.duplicate) {
        // Server-side duplicate check caught a match we didn't catch at Step 1
        // (e.g., floor-level partial match that only appears now)
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
          onBack={onAbandon}
          backLabel="Return to Dashboard"
        />
      </div>
    );
  }

  return (
    <div className="form-section">
      <div className="form-card">
        <div className="form-card-title">Pricing</div>

        <div className="input-label">Asking price (₹)</div>
        <input
          className="input-field"
          inputMode="numeric"
          placeholder="e.g. 9500000"
          value={form.askPrice}
          onChange={(e) => setForm({ ...form, askPrice: e.target.value.replace(/\D/g, '') })}
        />
        {form.askPrice && <div className="optional-hint">{formatPrice(form.askPrice)}</div>}

        <div className="input-label" style={{ marginTop: 14 }}>
          Closing price (₹) — what seller will accept
        </div>
        <input
          className="input-field"
          inputMode="numeric"
          placeholder="Optional"
          value={form.closingPrice}
          onChange={(e) => setForm({ ...form, closingPrice: e.target.value.replace(/\D/g, '') })}
        />
        {form.closingPrice && <div className="optional-hint">{formatPrice(form.closingPrice)}</div>}
      </div>

      <div className="form-card">
        <div className="form-card-title">Seller contact (optional)</div>
        <div className="input-label">Name</div>
        <input
          className="input-field"
          placeholder="Seller name"
          value={form.sellerName}
          onChange={(e) => setForm({ ...form, sellerName: e.target.value })}
        />
        <div className="input-label" style={{ marginTop: 12 }}>Phone</div>
        <input
          className="input-field"
          type="tel"
          inputMode="numeric"
          placeholder="10-digit mobile"
          value={form.sellerPhone}
          maxLength={15}
          onChange={(e) => setForm({ ...form, sellerPhone: e.target.value })}
        />
      </div>

      <div
        className="form-card"
        style={{ background: 'var(--oh-orange-light)', borderColor: 'var(--oh-orange)' }}
      >
        <div className="form-card-title" style={{ color: 'var(--oh-orange)' }}>
          Ready to submit
        </div>
        <p style={{ fontSize: 13, color: 'var(--oh-charcoal)', lineHeight: 1.5 }}>
          Our team will review this unit within 48 hours and share an offer.
        </p>
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
