import { useEffect, useState } from 'react';

import { api, ApiError } from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import DuplicateCard from './DuplicateCard';
import ForceCreateWarning from './ForceCreateWarning';
import NoUnitDetailsWarning from './NoUnitDetailsWarning';

const BHK_OPTIONS = ['2 BHK', '3 BHK', '4 BHK'];
const CITY_OPTIONS = ['Gurgaon', 'Noida', 'Ghaziabad'];

export default function Step1({ form, setForm, onNext, onAbandon }) {
  const { user } = useAuth();

  const defaultCity = CITY_OPTIONS.includes(user?.city) ? user.city : CITY_OPTIONS[0];
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

  const handleCityChange = (newCity) => {
    setCity(newCity);
    setForm({
      ...form,
      city: newCity,
      society: null,
      tower: '',
      unitNo: '',
      sqft: '',
      bhk: '',
      floor: '',
      forceCreate: false,
      skipUnitDetails: false,
    });
    setSearch('');
    setSearchResults([]);
  };

  const selectSociety = (s) => {
    setForm({
      ...form,
      city,
      society: s,
      tower: '',
      unitNo: '',
      sqft: '',
      bhk: '',
      floor: '',
      forceCreate: false,
      skipUnitDetails: false,
    });
    setSearch('');
    setDropdownOpen(false);
    setDupResult(null);
    setShowForceWarning(false);
    setShowNoUnitWarning(false);
  };

  const canSubmit =
    !!form.society?.id &&
    !!form.bhk &&
    !!(form.floor && form.floor.trim()) &&
    !!(form.tower && form.tower.trim()) &&
    !!(form.unitNo && form.unitNo.trim()) &&
    !checking;

  const canSubmitWithoutUnit =
    !!form.society?.id &&
    !!form.bhk &&
    !!(form.floor && form.floor.trim()) &&
    !checking;

  const handleSubmit = async () => {
    setApiError('');
    setDupResult(null);
    setChecking(true);
    try {
      const result = await api.checkDuplicate({
        society_id: form.society.id,
        bhk: form.bhk || null,
        tower: form.tower || null,
        unit_no: form.unitNo || null,
        floor: form.floor || null,
      });
      if (result.block) {
        setDupResult(result);
      } else {
        setForm({ ...form, city, forceCreate: false, skipUnitDetails: false });
        onNext();
      }
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Check failed. Try again.');
    } finally {
      setChecking(false);
    }
  };

  const handleSubmitWithoutUnit = () => setShowNoUnitWarning(true);

  const handleNoUnitContinue = () => {
    setForm({ ...form, city, skipUnitDetails: true, forceCreate: false });
    setShowNoUnitWarning(false);
    onNext();
  };

  const handleNoUnitBack = () => setShowNoUnitWarning(false);

  const handleEdit = () => {
    setDupResult(null);
    setShowForceWarning(false);
  };

  const handleForceCreateClick = () => setShowForceWarning(true);
  const handleForceCreateConfirm = () => {
    setForm({ ...form, city, forceCreate: true, skipUnitDetails: false });
    setDupResult(null);
    setShowForceWarning(false);
    onNext();
  };
  const handleForceCreateCancel = () => setShowForceWarning(false);

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
          {CITY_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Society search */}
      <div className="form-card">
        <div className="form-card-title">
          Society <span className="required-star">*</span>
        </div>
        <div className="society-search-wrap">
          <input
            type="text"
            className="input-field"
            placeholder={form.society ? form.society.name : `Search societies in ${city}...`}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
          />
          {dropdownOpen && (searchLoading || searchResults.length > 0) && (
            <div className="society-dropdown">
              {searchLoading && <div className="society-dropdown-item">Searching…</div>}
              {!searchLoading && searchResults.length === 0 && debouncedSearch.length >= 2 && (
                <div className="society-dropdown-item" style={{ color: 'var(--oh-gray)' }}>
                  No societies match
                </div>
              )}
              {!searchLoading && searchResults.map((s) => (
                <div key={s.id} className="society-dropdown-item" onClick={() => selectSociety(s)}>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--oh-gray)' }}>
                    {s.locality ? `${s.locality} · ` : ''}{s.city}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {form.society && (
          <div className="optional-hint" style={{ marginTop: 8, color: 'var(--oh-charcoal)' }}>
            📍 Selected: <strong>{form.society.name}</strong>
            {form.society.locality ? ` (${form.society.locality})` : ''}
          </div>
        )}
      </div>

      {form.society && (
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
              <input
                className="input-field"
                placeholder="e.g. 7"
                value={form.floor}
                onChange={(e) => setForm({ ...form, floor: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div>
              <div className="input-label">Tower <span className="required-star">*</span></div>
              <input
                className="input-field"
                placeholder="e.g. A2"
                value={form.tower}
                onChange={(e) => setForm({ ...form, tower: e.target.value })}
              />
            </div>
            <div>
              <div className="input-label">Unit No <span className="required-star">*</span></div>
              <input
                className="input-field"
                placeholder="e.g. 101"
                value={form.unitNo}
                onChange={(e) => setForm({ ...form, unitNo: e.target.value })}
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="input-label">Area (sqft)</div>
            <input
              className="input-field"
              inputMode="numeric"
              placeholder="e.g. 1200"
              value={form.sqft}
              onChange={(e) => setForm({ ...form, sqft: e.target.value.replace(/\D/g, '') })}
            />
          </div>

          <div className="optional-hint" style={{ marginTop: 10 }}>
            <span className="required-star">*</span> are mandatory
          </div>
        </div>
      )}

      {apiError && <div className="error-text" style={{ marginTop: 12 }}>{apiError}</div>}

      {form.society && (
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
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
          <button
            type="button"
            className="primary-btn"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{ flex: 1, marginTop: 0 }}
          >
            {checking ? <><span className="spinner" />Checking…</> : 'Submit'}
          </button>
        </div>
      )}
    </div>
  );
}
