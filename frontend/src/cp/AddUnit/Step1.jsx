import { useEffect, useState } from 'react';

import { api, ApiError } from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatPrice } from '../../format';
import DuplicateCard from './DuplicateCard';
import ForceCreateWarning from './ForceCreateWarning';
import NoUnitDetailsWarning from './NoUnitDetailsWarning';

// Values are numeric (the DB `bhk` column is numeric); the label adds "BHK".
const BHK_OPTIONS = ['2', '2.5', '3', '3.5', '4'];
const CITY_OPTIONS = ['Gurgaon', 'Noida', 'Ghaziabad'];

// Floor dropdown order: Top, Ground, 1..50. Stored as VARCHAR — legacy values
// ("B1", "LG", etc.) remain valid in the DB; new submissions pick from this list.
const FLOOR_OPTIONS = [
  'Top',
  'Ground',
  ...Array.from({ length: 50 }, (_, i) => String(i + 1)),
];

function lakhsToRupees(lakhs) {
  const n = parseFloat(lakhs);
  if (!isFinite(n)) return null;
  return Math.round(n * 100000);
}

export default function Step1({ form, setForm, onSubmitted, onAbandon, mode = 'cp', targetCp = null }) {
  const { user } = useAuth();

  // In staff mode (RM/manager/admin submitting on behalf of a CP), the
  // city default comes from the target CP, not the staff member.
  const cityForDefault = mode === 'staff' ? (targetCp?.city || '') : (user?.city || '');
  const defaultCity = CITY_OPTIONS.includes(cityForDefault) ? cityForDefault : CITY_OPTIONS[0];
  const [city, setCity] = useState(form.city || defaultCity);

  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  const [submitting, setSubmitting] = useState(false);
  const [dupResult, setDupResult] = useState(null);
  const [showForceWarning, setShowForceWarning] = useState(false);
  const [showNoUnitWarning, setShowNoUnitWarning] = useState(false);
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    if (!dropdownOpen || debouncedSearch.length < 2) {
      setSearchResults([]);
      return;
    }
    let alive = true;
    setSearchLoading(true);
    api
      .searchSocieties(debouncedSearch, 15, city)
      .then((data) => alive && setSearchResults(data.societies || []))
      .catch(() => alive && setSearchResults([]))
      .finally(() => alive && setSearchLoading(false));
    return () => {
      alive = false;
    };
  }, [debouncedSearch, dropdownOpen, city]);

  const resetDeps = () => ({
    tower: '', unitNo: '', sqft: '', bhk: '', floor: '',
    occupancyStatus: 'Vacant', askPrice: '',
    forceCreate: false, skipUnitDetails: false,
  });

  const handleCityChange = (newCity) => {
    setCity(newCity);
    setForm({ ...form, city: newCity, society: null, ...resetDeps() });
    setSearch('');
    setSearchResults([]);
  };

  const selectSociety = (s) => {
    setForm({ ...form, city, society: s, ...resetDeps() });
    setSearch('');
    setDropdownOpen(false);
    setDupResult(null);
    setShowForceWarning(false);
    setShowNoUnitWarning(false);
  };

  // ----- validation -----
  // Single-step flow: all required fields validated here before Submit.
  const hasBaseRequired =
    !!form.society?.id &&
    !!form.bhk &&
    !!(form.floor && form.floor.trim()) &&
    !!form.sqft && form.sqft.length > 0 &&
    !!form.askPrice;

  const hasUnitDetails =
    !!(form.tower && form.tower.trim()) &&
    !!(form.unitNo && form.unitNo.trim());

  const canSubmit = hasBaseRequired && hasUnitDetails && !submitting;
  const canSubmitWithoutUnit = hasBaseRequired && !submitting;

  const buildPayload = (opts = {}) => ({
    society: form.society.name,
    society_name: form.society.name,
    city: form.society.city,
    tower: opts.skipUnit ? null : (form.tower || null),
    unit_no: opts.skipUnit ? null : (form.unitNo || null),
    floor: form.floor || null,
    sqft: form.sqft ? parseInt(form.sqft) : null,
    bhk: form.bhk || null,
    occupancy_status: form.occupancyStatus || null,
    asking_price: lakhsToRupees(form.askPrice),
    force_create: !!opts.forceCreate,
    skip_unit_details: !!opts.skipUnit,
  });

  // ---------- SUBMIT WITH unit details (runs dup check server-side) ----------
  const handleSubmit = async ({ forceCreate = false, skipUnit = false } = {}) => {
    setApiError('');
    setDupResult(null);
    setSubmitting(true);
    try {
      const payload = buildPayload({ forceCreate, skipUnit });
      const result = mode === 'staff'
        ? await api.adminCreateSubmissionOnBehalf({ ...payload, target_cp_id: targetCp?.id })
        : await api.createSubmission(payload);
      // Backend may return 201 but ask the frontend to show a Contact RM
      // page anyway (e.g. unit-less + collated match — row IS created so admin
      // sees it, but CP gets a "Similar match" message instead of going back
      // to the dashboard). DuplicateCard handles the rendering.
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
        setDupResult(err.data.duplicate);
      } else {
        setApiError(err instanceof ApiError ? err.message : 'Submission failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- SUBMIT WITHOUT unit details — opens popup ----------
  const handleSubmitWithoutUnit = () => setShowNoUnitWarning(true);
  const handleNoUnitContinue = () => {
    setShowNoUnitWarning(false);
    handleSubmit({ skipUnit: true });
  };
  const handleNoUnitBack = () => setShowNoUnitWarning(false);

  // ---------- DUPLICATE -> Add anyway ----------
  const handleEdit = () => {
    setDupResult(null);
    setShowForceWarning(false);
  };
  const handleForceCreateClick = () => setShowForceWarning(true);
  const handleForceCreateConfirm = () => {
    setShowForceWarning(false);
    setDupResult(null);
    handleSubmit({ forceCreate: true });
  };
  const handleForceCreateCancel = () => setShowForceWarning(false);

  // ---------- Popups ----------
  if (showForceWarning) {
    return <ForceCreateWarning onConfirm={handleForceCreateConfirm} onCancel={handleForceCreateCancel} />;
  }
  if (showNoUnitWarning) {
    return <NoUnitDetailsWarning onContinue={handleNoUnitContinue} onBack={handleNoUnitBack} />;
  }
  if (dupResult) {
    return (
      <div className="form-section">
        <DuplicateCard result={dupResult} onEdit={handleEdit} onForceCreate={handleForceCreateClick} />
      </div>
    );
  }

  const askPriceRupees = lakhsToRupees(form.askPrice);

  // ---------- FORM ----------
  return (
    <div className="form-section">
      {/* City dropdown */}
      <div className="form-card" style={{ paddingBottom: 12 }}>
        <div className="form-card-title" style={{ marginBottom: 8 }}>
          City <span className="required-star">*</span>
        </div>
        <select
          value={city}
          onChange={(e) => handleCityChange(e.target.value)}
          className="input-field"
          style={{ padding: '10px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          {CITY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Society search with chevron affordance */}
      <div className="form-card">
        <div className="form-card-title">
          Society <span className="required-star">*</span>
        </div>
        <div className="society-search-wrap" style={{ position: 'relative' }}>
          <input
            className="input-field"
            placeholder={`Search societies in ${city}...`}
            value={form.society?.name || search}
            onChange={(e) => {
              setSearch(e.target.value);
              setDropdownOpen(true);
              if (form.society) {
                setForm({ ...form, society: null, ...resetDeps() });
              }
            }}
            onFocus={() => { if (!form.society) setDropdownOpen(true); }}
            style={{ paddingRight: 36 }}
          />
          {/* Dropdown chevron */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              right: 12, top: '50%', transform: 'translateY(-50%)',
              pointerEvents: 'none',
              color: 'var(--oh-gray)',
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            ▾
          </span>
          {dropdownOpen && search.length >= 2 && (
            <div className="society-dropdown">
              {searchLoading ? (
                <div className="society-loading">Searching…</div>
              ) : searchResults.length === 0 ? (
                <div className="society-loading">No matches</div>
              ) : (
                searchResults.map((s) => (
                  <div key={s.id} className="society-option" onClick={() => selectSociety(s)}>
                    <span>{s.name}</span>
                    <span className="society-sector">{s.locality || s.city}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        {form.society?.locality && (
          <div className="optional-hint">📍 {form.society.locality} · {form.society.city}</div>
        )}
      </div>

      {form.society && (
        <>
          {/* Unit Info: BHK/Floor, Area, Tower/Unit */}
          <div className="form-card">
            <div className="form-card-title">Unit Info</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div className="input-label">BHK <span className="required-star">*</span></div>
                <select
                  className="input-field"
                  value={form.bhk}
                  onChange={(e) => setForm({ ...form, bhk: e.target.value })}
                >
                  <option value="">Select...</option>
                  {BHK_OPTIONS.map((b) => <option key={b} value={b}>{b} BHK</option>)}
                </select>
              </div>
              <div>
                <div className="input-label">Floor <span className="required-star">*</span></div>
                <select
                  className="input-field"
                  value={form.floor}
                  onChange={(e) => setForm({ ...form, floor: e.target.value })}
                >
                  <option value="">Select...</option>
                  {FLOOR_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>

            {/* Area moved up, now mandatory */}
            <div style={{ marginTop: 12 }}>
              <div className="input-label">Area (sqft) <span className="required-star">*</span></div>
              <input
                className="input-field"
                inputMode="numeric"
                placeholder="e.g. 1200"
                value={form.sqft}
                onChange={(e) => setForm({ ...form, sqft: e.target.value.replace(/\D/g, '') })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div>
                <div className="input-label">Tower <span className="required-star">*</span></div>
                <input
                  className="input-field"
                  placeholder="e.g. A2"
                  value={form.tower}
                  onChange={(e) => {
                    // Restrict to letters, numbers, spaces — strip everything else as user types.
                    const sanitized = (e.target.value || '').replace(/[^a-zA-Z0-9 ]/g, '');
                    setForm({ ...form, tower: sanitized });
                  }}
                />
              </div>
              <div>
                <div className="input-label">Unit No <span className="required-star">*</span></div>
                <input
                  className="input-field"
                  placeholder="e.g. 101"
                  value={form.unitNo}
                  onChange={(e) => {
                    // Same restriction as Tower: letters, numbers, spaces only
                    const sanitized = (e.target.value || '').replace(/[^a-zA-Z0-9 ]/g, '');
                    setForm({ ...form, unitNo: sanitized });
                  }}
                />
              </div>
            </div>

            <div className="optional-hint" style={{ marginTop: 10 }}>
              <span className="required-star">*</span> are mandatory
            </div>
          </div>

          {/* Occupancy & Pricing card */}
          <div className="form-card">
            <div className="form-card-title">Occupancy & Pricing</div>

            <div className="input-label">Occupancy Status <span className="required-star">*</span></div>
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

            <div className="input-label">Asking Price (in lakhs) <span className="required-star">*</span></div>
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
        </>
      )}

      {apiError && <div className="error-text" style={{ marginTop: 12 }}>{apiError}</div>}

      {form.society && (
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          {/* "Submit without unit details" hidden once both tower AND unit_no are
              entered — that path becomes pointless since a normal Submit will work. */}
          {!hasUnitDetails && (
            <button
              type="button"
              onClick={handleSubmitWithoutUnit}
              disabled={!canSubmitWithoutUnit}
              style={{
                flex: 1,
                padding: '14px 16px',
                borderRadius: 12,
                border: '1.5px solid var(--oh-orange)',
                background: '#fff',
                color: 'var(--oh-orange)',
                fontSize: 14,
                fontWeight: 600,
                cursor: canSubmitWithoutUnit ? 'pointer' : 'not-allowed',
                opacity: canSubmitWithoutUnit ? 1 : 0.5,
                fontFamily: 'inherit',
              }}
            >
              Submit without unit details
            </button>
          )}
          <button
            type="button"
            className="primary-btn"
            onClick={() => handleSubmit()}
            disabled={!canSubmit}
            style={{ flex: 1, marginTop: 0 }}
          >
            {submitting ? <><span className="spinner" />Submitting…</> : 'Submit'}
          </button>
        </div>
      )}
    </div>
  );
}
