import { useEffect, useState } from 'react';

import { api, ApiError } from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import DuplicateCard from './DuplicateCard';
import ForceCreateWarning from './ForceCreateWarning';
import NoUnitDetailsWarning from './NoUnitDetailsWarning';

const BHK_OPTIONS = ['2 BHK', '3 BHK', '4 BHK'];
const CITY_OPTIONS = ['Gurgaon', 'Noida', 'Ghaziabad'];

// Floor dropdown order: Ground, Top, 1..50. Stored as VARCHAR — legacy values
// ("B1", "LG", etc.) remain valid in the DB; new submissions pick from this list.
const FLOOR_OPTIONS = [
  'Ground',
  'Top',
  ...Array.from({ length: 50 }, (_, i) => String(i + 1)),
];

export default function Step1({ form, setForm, onAdvance, onAbandon, mode = 'cp', targetCp = null }) {
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

  const [checking, setChecking] = useState(false);
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
  // Step 1 only collects property identification. Pricing/occupancy moved to Step 2.
  const hasBaseRequired =
    !!form.society?.id &&
    !!form.bhk &&
    !!(form.floor && form.floor.trim()) &&
    !!form.sqft && form.sqft.length > 0;

  const hasUnitDetails =
    !!(form.tower && form.tower.trim()) &&
    !!(form.unitNo && form.unitNo.trim());

  const canContinue = hasBaseRequired && hasUnitDetails && !checking;
  const canContinueWithoutUnit = hasBaseRequired && !checking;

  // Persist the path the user took (force_create / skip_unit_details) on the
  // form so Step 2's actual submit carries the same flags into createSubmission.
  const advanceWith = ({ forceCreate = false, skipUnit = false } = {}) => {
    setForm((f) => ({
      ...f,
      forceCreate: !!forceCreate,
      skipUnitDetails: !!skipUnit,
    }));
    onAdvance();
  };

  // ---------- CONTINUE WITH unit details — runs dup check ONLY ----------
  const handleContinue = async () => {
    if (!canContinue) return;
    setApiError('');
    setDupResult(null);
    setChecking(true);
    try {
      const dup = await api.checkDuplicate({
        society_id: form.society.id,
        bhk: form.bhk || null,
        tower: form.tower || null,
        unit_no: form.unitNo || null,
        floor: form.floor || null,
      });
      if (dup && dup.block) {
        setDupResult(dup);
        return;
      }
      // Clean — clear any prior force_create / skip flags and advance.
      advanceWith();
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Could not check duplicates. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  // ---------- CONTINUE WITHOUT unit details — opens popup ----------
  const handleSubmitWithoutUnit = () => setShowNoUnitWarning(true);
  const handleNoUnitContinue = () => {
    setShowNoUnitWarning(false);
    // No dup check possible without tower/unit — let the user enter
    // pricing on Step 2; the create call there carries skip_unit_details=true.
    advanceWith({ skipUnit: true });
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
    // User chose to override the dup-block — record it on the form so Step 2's
    // createSubmission posts force_create=true, then advance to pricing.
    advanceWith({ forceCreate: true });
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
                  {BHK_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
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

        </>
      )}

      {apiError && <div className="error-text" style={{ marginTop: 12 }}>{apiError}</div>}

      {form.society && (
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          {/* "Continue without unit details" hidden once both tower AND unit_no are
              entered — the normal Continue path runs the dup check and works the
              same way. */}
          {!hasUnitDetails && (
            <button
              type="button"
              onClick={handleSubmitWithoutUnit}
              disabled={!canContinueWithoutUnit}
              style={{
                flex: 1,
                padding: '14px 16px',
                borderRadius: 12,
                border: '1.5px solid var(--oh-orange)',
                background: '#fff',
                color: 'var(--oh-orange)',
                fontSize: 14,
                fontWeight: 600,
                cursor: canContinueWithoutUnit ? 'pointer' : 'not-allowed',
                opacity: canContinueWithoutUnit ? 1 : 0.5,
                fontFamily: 'inherit',
              }}
            >
              Continue without unit details
            </button>
          )}
          <button
            type="button"
            className="primary-btn"
            onClick={handleContinue}
            disabled={!canContinue}
            style={{ flex: 1, marginTop: 0 }}
          >
            {checking ? <><span className="spinner" />Checking…</> : 'Continue'}
          </button>
        </div>
      )}
    </div>
  );
}