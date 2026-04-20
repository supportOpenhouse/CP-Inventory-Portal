import { useEffect, useState } from 'react';

import { api, ApiError } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import DuplicateCard from './DuplicateCard';

const BHK_OPTIONS = ['2 BHK', '3 BHK', '4 BHK'];

// Keep floor options as free-text — different societies use different formats
// (e.g. "G", "B1", "LG"). If you want dropdown later, spec can be added.

export default function Step1({ form, setForm, onNext, onAbandon }) {
  // ---- society search ----
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  // ---- duplicate check state ----
  const [checking, setChecking] = useState(false);
  const [dupResult, setDupResult] = useState(null);    // block=true: "already exists"
  const [dupWarning, setDupWarning] = useState(null);  // block=false: soft floor warning
  const [apiError, setApiError] = useState('');

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
    setDupWarning(null);
    setDupResult(null);
  };

  // Required: society + bhk + floor
  const canContinue =
    !!form.society?.id &&
    !!form.bhk &&
    !!(form.floor && form.floor.trim()) &&
    !checking;

  const runDuplicateCheck = async () => {
    setApiError('');
    setDupResult(null);
    setDupWarning(null);
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
        // "Already exists" — hard stop with Contact RM + Edit
        setDupResult(result);
      } else if (result.match_level === 'partial') {
        setDupWarning(result);
      } else {
        onNext();
      }
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Check failed. Try again.');
    } finally {
      setChecking(false);
    }
  };

  const handleProceedAnyway = () => {
    setDupWarning(null);
    onNext();
  };

  const handleEdit = () => {
    // Dismiss dupResult, leave form filled so user can tweak
    setDupResult(null);
  };

  // Hard block view — "already exists", no Continue Anyway
  if (dupResult) {
    return (
      <div className="form-section">
        <DuplicateCard
          result={dupResult}
          onEdit={handleEdit}
          onAbandon={onAbandon}
        />
      </div>
    );
  }

  return (
    <div className="form-section">
      {/* Soft warning for floor-level partial match */}
      {dupWarning && (
        <div className="dup-warning-card">
          <div className="dup-warning-title">⚠ Possible duplicate</div>
          <div className="dup-warning-message">{dupWarning.message}</div>
          <div className="dup-warning-actions">
            <button
              className="secondary-btn"
              onClick={() => setDupWarning(null)}
              type="button"
            >
              Edit details
            </button>
            <button
              className="primary-btn"
              onClick={handleProceedAnyway}
              type="button"
            >
              Continue anyway
            </button>
          </div>
        </div>
      )}

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

      {/* Unit Info — shown once society is selected */}
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

          {/* Row 2: Tower + Unit No */}
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

          {/* Row 3: Area */}
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
            <span className="required-star">*</span> are required. Tower, Unit No, and Area help match against Openhouse inventory.
          </div>
        </div>
      )}

      {apiError && (
        <div className="error-text" style={{ marginTop: 12 }}>{apiError}</div>
      )}

      <button
        className="primary-btn"
        onClick={runDuplicateCheck}
        disabled={!canContinue}
        style={{ marginTop: 20 }}
      >
        {checking ? <><span className="spinner" />Checking…</> : 'Check & Continue'}
      </button>
    </div>
  );
}
