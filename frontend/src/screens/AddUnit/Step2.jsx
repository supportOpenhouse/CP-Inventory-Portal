import { useState } from 'react';

import { api, ApiError } from '../../api';
import { formatPrice } from '../../format';
import DuplicateCard from './DuplicateCard';

/**
 * Step 2 of the AddUnit flow. Step 1 has already collected property
 * identification + run a /check-duplicate, so by the time we land here the
 * unit is either clean OR the user explicitly chose "Add anyway"
 * (form.forceCreate=true) OR the user opted into the unit-less path
 * (form.skipUnitDetails=true).
 *
 * This step collects occupancy + the two prices and POSTs the actual
 * /submissions create. The backend re-runs the dup check defensively; if
 * something changed between Step 1 and now (race), we surface the same
 * DuplicateCard with an "Add anyway" option that retries with force_create=true.
 *
 * Pricing is entered in LAKHS and converted to rupees on submit.
 *
 * Mode:
 *   'cp'    → POST /submissions
 *   'staff' → POST /admin/submissions/on-behalf with target_cp_id
 */
function lakhsToRupees(lakhs) {
  const n = parseFloat(lakhs);
  if (!isFinite(n)) return null;
  return Math.round(n * 100000);
}

export default function Step2({
  form, setForm, onBack, onSubmitted,
  mode = 'cp', targetCp = null,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [dupResult, setDupResult] = useState(null);
  const [apiError, setApiError] = useState('');

  const askPriceRupees = lakhsToRupees(form.askPrice);

  const canSubmit =
    !!form.occupancyStatus &&
    !!form.askPrice &&
    askPriceRupees != null &&
    !submitting;

  const handleSubmit = async ({ forceCreate = form.forceCreate } = {}) => {
    setApiError('');
    setDupResult(null);
    setSubmitting(true);
    try {
      const skipUnit = !!form.skipUnitDetails;
      const payload = {
        society_id: form.society.id,
        society_name: form.society.name,
        tower: skipUnit ? null : (form.tower || null),
        unit_no: skipUnit ? null : (form.unitNo || null),
        floor: form.floor || null,
        sqft: form.sqft ? parseInt(form.sqft) : null,
        bhk: form.bhk || null,
        occupancy_status: form.occupancyStatus || null,
        asking_price: askPriceRupees,
        force_create: !!forceCreate,
        skip_unit_details: skipUnit,
      };
      const result = mode === 'staff'
        ? await api.adminCreateSubmissionOnBehalf({ ...payload, target_cp_id: targetCp?.id })
        : await api.createSubmission(payload);

      // Backend may return 201 but ask the frontend to render a Contact RM
      // page (unit-less + collated/submissions match — row IS created so admin
      // sees it, but the CP gets a "Similar match" message).
      if (result.show_contact_rm_page && result.duplicate) {
        setDupResult(result.duplicate);
        return;
      }
      onSubmitted({
        id: result.submission_id,
        public_id: result.public_id,
        status: result.status,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data?.duplicate) {
        // Race between Step 1 dup-check and this create — surface the same
        // DuplicateCard so the user can either go back to edit or override.
        setDupResult(err.data.duplicate);
      } else {
        setApiError(err instanceof ApiError ? err.message : 'Submission failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // "Add anyway" from the duplicate card — retry the same payload with force.
  const handleForceCreateFromCard = () => {
    setDupResult(null);
    setForm((f) => ({ ...f, forceCreate: true }));
    handleSubmit({ forceCreate: true });
  };

  if (dupResult) {
    return (
      <div className="form-section">
        <DuplicateCard
          result={dupResult}
          onForceCreate={handleForceCreateFromCard}
          onEdit={() => { setDupResult(null); onBack(); }}
        />
      </div>
    );
  }

  // Submit button label reflects what the backend will do:
  //   - normal flow with unit details → 'Submit'
  //   - skipUnitDetails (no tower/unit) → 'Submit for approval' (lands in Unapproved)
  const submitLabel = form.skipUnitDetails ? 'Submit for approval' : 'Submit';

  return (
    <div className="form-section">
      <div className="form-card">
        <div className="form-card-title">Occupancy & Pricing</div>

        <div className="input-label">
          Occupancy Status <span className="required-star">*</span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          {['Vacant', 'Occupied'].map((status) => {
            const active = form.occupancyStatus === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setForm({ ...form, occupancyStatus: status })}
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

        <div className="input-label">
          Asking Price (in lakhs) <span className="required-star">*</span>
        </div>
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
      </div>

      {apiError && <div className="error-text" style={{ marginTop: 12 }}>{apiError}</div>}

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button
          type="button"
          className="secondary-btn"
          onClick={onBack}
          disabled={submitting}
          style={{ flex: 1 }}
        >
          Back
        </button>
        <button
          type="button"
          className="primary-btn"
          onClick={() => handleSubmit()}
          disabled={!canSubmit}
          style={{ flex: 1, marginTop: 0 }}
        >
          {submitting ? <><span className="spinner" />Submitting…</> : submitLabel}
        </button>
      </div>
    </div>
  );
}
