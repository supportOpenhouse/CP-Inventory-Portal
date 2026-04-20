import { useEffect, useState } from 'react';

import { api, ApiError } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import DuplicateCard from './DuplicateCard';

const BHK_OPTIONS = ['1 BHK', '2 BHK', '3 BHK', '4 BHK', '5 BHK'];

export default function Step1({ form, setForm, onNext }) {
  // ---- society search state ----
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  // ---- duplicate check state ----
  const [checking, setChecking] = useState(false);
  const [dupResult, setDupResult] = useState(null);
  const [apiError, setApiError] = useState('');

  // Society search (debounced). Fires only when dropdown is open + 2+ chars.
  useEffect(() => {
    if (!dropdownOpen || debouncedSearch.length < 2) {
      setSearchResults([]);
      return;
    }
    let alive = true;
    setSearchLoading(true);
    api
      .searchSocieties(debouncedSearch, 15)
      .then((data) => alive && setSearchResults(data.societies || []))
      .catch(() => alive && setSearchResults([]))
      .finally(() => alive && setSearchLoading(false));
    return () => {
      alive = false;
    };
  }, [debouncedSearch, dropdownOpen]);

  const selectSociety = (s) => {
    setForm({ ...form, society: s, tower: '', unitNo: '', sqft: '', bhk: '', floor: '' });
    setSearch('');
    setDropdownOpen(false);
  };

  // Required: society + bhk + floor (per product spec)
  const canContinue =
    !!form.society?.id &&
    !!form.bhk &&
    !!(form.floor && form.floor.trim()) &&
    !checking;

  const handleContinue = async () => {
    setApiError('');
    setDupResult(null);
    setChecking(true);
    try {
      const result = await api.checkDuplicate({
        society_id: form.society.id,
        tower: form.tower || null,
        unit_no: form.unitNo || null,
        floor: form.floor || null,
      });
      if (result.block) {
        setDupResult(result);
      } else {
        onNext();
      }
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Check failed. Try again.');
    } finally {
      setChecking(false);
    }
  };

  // If blocking duplicate, show just the card + back button
  if (dupResult) {
    return (
      <div className="form-section">
        <DuplicateCard result={dupResult} onBack={() => setDupResult(null)} />
      </div>
    );
  }

  return (
    <div className="form-section">
      {/* Society */}
      <div className="form-card">
        <div className="form-card-title">
          Society <span className="required-star">*</span>
        </div>
        <div className="society-search-wrap">
          <input
            className="input-field"
            placeholder="Search society name..."
            value={form.society?.name || search}
            onChange={(e) => {
              setSearch(e.target.value);
              setDropdownOpen(true);
              if (form.society) {
                setForm({ ...form, society: null, tower: '', unitNo: '', sqft: '', bhk: '', floor: '' });
              }
            }}
            onFocus={() => {
              if (!form.society) setDropdownOpen(true);
            }}
          />
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

      {/* Unit Info — only show once a society is selected */}
      {form.society && (
        <div className="form-card">
          <div className="form-card-title">Unit Info</div>

          {/* Row 1: BHK + Floor (both required) */}
          <div className="form-row" style={{ marginBottom: 12 }}>
            <div>
              <div className="input-label">
                BHK <span className="required-star">*</span>
              </div>
              <select
                className="select-field"
                value={form.bhk}
                onChange={(e) => setForm({ ...form, bhk: e.target.value })}
              >
                <option value="">Select</option>
                {BHK_OPTIONS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="input-label">
                Floor <span className="required-star">*</span>
              </div>
              <input
                className="input-field"
                placeholder="e.g. 7, G, B1"
                value={form.floor}
                onChange={(e) => setForm({ ...form, floor: e.target.value })}
              />
            </div>
          </div>

          {/* Row 2: Tower + Unit No (optional) */}
          <div className="form-row" style={{ marginBottom: 12 }}>
            <div>
              <div className="input-label">Tower</div>
              <input
                className="input-field"
                placeholder="e.g. A2"
                value={form.tower}
                onChange={(e) => setForm({ ...form, tower: e.target.value })}
              />
            </div>
            <div>
              <div className="input-label">Unit No</div>
              <input
                className="input-field"
                placeholder="e.g. 101"
                value={form.unitNo}
                onChange={(e) => setForm({ ...form, unitNo: e.target.value })}
              />
            </div>
          </div>

          {/* Row 3: Area (optional, full width) */}
          <div>
            <div className="input-label">Area (sqft)</div>
            <input
              className="input-field"
              inputMode="numeric"
              placeholder="e.g. 1200"
              value={form.sqft}
              onChange={(e) => setForm({ ...form, sqft: e.target.value.replace(/\D/g, '') })}
            />
          </div>

          <div className="optional-hint">
            <span className="required-star">*</span> are required. Tower, Unit No, and Area are optional but help us match against Openhouse inventory.
          </div>
        </div>
      )}

      {apiError && (
        <div className="error-text" style={{ marginTop: 12 }}>{apiError}</div>
      )}

      <button
        className="primary-btn"
        onClick={handleContinue}
        disabled={!canContinue}
        style={{ marginTop: 20 }}
      >
        {checking ? <><span className="spinner" />Checking…</> : 'Check & Continue'}
      </button>
    </div>
  );
}