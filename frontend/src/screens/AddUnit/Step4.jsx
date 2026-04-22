import { useState } from 'react';

import { api, ApiError } from '../../api';
import { formatPrice } from '../../format';
import DuplicateCard from './DuplicateCard';

/**
 * Pricing inputs are in LAKHS. The user types "95" meaning ₹95 lakhs.
 * We store as rupees (multiply by 1,00,000) in the payload.
 * The hint below the input shows the formatted Cr/Lakh representation.
 */
function lakhsToRupees(lakhs) {
  const n = parseFloat(lakhs);
  if (!isFinite(n)) return null;
  return Math.round(n * 100000);
}

export default function Step4({ form, setForm, onBack, onSubmitted, onAbandon }) {
  const [submitting, setSubmitting] = useState(false);
  const [dupResult, setDupResult] = useState(null);
  const [apiError, setApiError] = useState('');

  // Has CP provided tower + unit_no? If yes, submit as normal (Submitted). If no, Unapproved.
  const hasUnitDetails =
    !!(form.tower && form.tower.trim()) &&
    !!(form.unitNo && form.unitNo.trim()) &&
    !form.skipUnitDetails;

  // Submit button label reflects the destination status
  const submitLabel = hasUnitDetails ? 'Submit' : 'Submit for approval';

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
        // Convert lakhs input -> rupees before sending
        asking_price: lakhsToRupees(form.askPrice),
        closing_price: lakhsToRupees(form.closingPrice),
        seller_name: form.sellerName || null,
        seller_phone: form.sellerPhone || null,
        photos: form.photos || [],
        // Step1 flags
        force_create: !!form.forceCreate,
        skip_unit_details: !!form.skipUnitDetails,
      };

      const result = await api.createSubmission(payload);
      onSubmitted({
        id: result.submission_id,
        public_id: result.public_id,
        status: result.status,
      });
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

  const handleForceCreateFromStep4 = async () => {
    setForm({ ...form, forceCreate: true });
    setDupResult(null);
    setTimeout(handleSubmit, 0);
  };

  if (dupResult) {
    return (
      <div className="form-section">
        <DuplicateCard
          result={dupResult}
          onForceCreate={handleForceCreateFromStep4}
          onEdit={() => setDupResult(null)}
        />
      </div>
    );
  }

  const askPriceRupees = lakhsToRupees(form.askPrice);
  const closingPriceRupees = lakhsToRupees(form.closingPrice);

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

        <div className="input-label">Asking Price (in lakhs)</div>
        <input
          className="input-field"
          inputMode="decimal"
          placeholder="e.g. 95"
          value={form.askPrice}
          onChange={(e) => setForm({ ...form, askPrice: e.target.value.replace(/[^0-9.]/g, '') })}
        />
        {askPriceRupees ? (
          <div className="optional-hint">{formatPrice(askPriceRupees)}</div>
        ) : (
          <div className="optional-hint" style={{ color: 'var(--oh-gray)' }}>
            Enter in lakhs (e.g. 95 = ₹95 lakhs; 150 = ₹1.5 Cr)
          </div>
        )}

        <div className="input-label" style={{ marginTop: 14 }}>
          Tentative Closing Price (in lakhs)
        </div>
        <input
          className="input-field"
          inputMode="decimal"
          placeholder="e.g. 92"
          value={form.closingPrice}
          onChange={(e) => setForm({ ...form, closingPrice: e.target.value.replace(/[^0-9.]/g, '') })}
        />
        {closingPriceRupees ? (
          <div className="optional-hint">{formatPrice(closingPriceRupees)}</div>
        ) : (
          <div className="optional-hint" style={{ color: 'var(--oh-gray)' }}>
            What seller will accept
          </div>
        )}
      </div>

      {apiError && <div className="error-text" style={{ marginTop: 12 }}>{apiError}</div>}

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="secondary-btn" onClick={onBack} disabled={submitting}>Back</button>
        <button className="primary-btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? <><span className="spinner" />Submitting…</> : submitLabel}
        </button>
      </div>
    </div>
  );
}
