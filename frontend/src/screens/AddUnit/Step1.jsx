import { useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../../api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import DuplicateCard from './DuplicateCard';

const GENERIC_BHK_OPTIONS = ['1 BHK', '2 BHK', '3 BHK', '4 BHK', '5 BHK'];

function getUnitSuffix(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 2 ? digits.slice(-2) : '';
}

function normalizeConfig(c) {
  // "2BHK" / "2 BHK" / "2bhk" -> "2 BHK"
  const m = c.trim().match(/(\d+\.?\d*)\s*BHK/i);
  return m ? `${m[1]} BHK` : c.trim();
}

export default function Step1({ form, setForm, onNext }) {
  // ---- society search state ----
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  // ---- inventory (towers/configs) for selected society ----
  const [inventory, setInventory] = useState(null); // { society, towers: {A1:{01:2480}}, configs: [...] }
  const [inventoryLoading, setInventoryLoading] = useState(false);

  // ---- duplicate check state ----
  const [checking, setChecking] = useState(false);
  const [dupResult, setDupResult] = useState(null);
  const [apiError, setApiError] = useState('');

  // Society search (debounced). Only fires if dropdown is open + 2+ chars.
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

  const selectSociety = async (s) => {
    setForm({ ...form, society: s, tower: '', unitNo: '', sqft: '', bhk: '' });
    setSearch('');
    setDropdownOpen(false);
    setInventory(null);
    setInventoryLoading(true);
    try {
      const data = await api.getSocietyInventory(s.id);
      setInventory(data);
    } catch {
      setInventory({ society: s, towers: {}, configs: [] });
    } finally {
      setInventoryLoading(false);
    }
  };

  // Auto-fill sqft when tower + unitNo change (if data exists in inventory)
  useEffect(() => {
    if (!inventory || !form.tower || !form.unitNo) return;
    const tower = inventory.towers?.[form.tower];
    if (!tower) return;
    const suffix = getUnitSuffix(form.unitNo);
    if (!suffix) return;
    const area = tower[suffix];
    if (area && String(area) !== form.sqft) {
      setForm((f) => ({ ...f, sqft: String(area) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.tower, form.unitNo, inventory]);

  const availableTowers = useMemo(() => {
    if (!inventory?.towers) return [];
    return Object.keys(inventory.towers).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [inventory]);

  const bhkOptions = useMemo(() => {
    if (inventory?.configs?.length) {
      return inventory.configs.map(normalizeConfig);
    }
    return GENERIC_BHK_OPTIONS;
  }, [inventory]);

  const canContinue = !!form.society?.id && !checking;

  const handleContinue = async () => {
    setApiError('');
    setDupResult(null);
    setChecking(true);
    try {
      const result = await api.checkDuplicate({
        society_id: form.society.id,
        tower: form.tower || null,
        unit_no: form.unitNo || null,
        // floor is collected in Step 2; skipped here
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
        <DuplicateCard
          result={dupResult}
          onBack={() => {
            setDupResult(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="form-section">
      {/* Society */}
      <div className="form-card">
        <div className="form-card-title">Society</div>
        <div className="society-search-wrap">
          <input
            className="input-field"
            placeholder="Search society name..."
            value={form.society?.name || search}
            onChange={(e) => {
              setSearch(e.target.value);
              setDropdownOpen(true);
              if (form.society) {
                setForm({ ...form, society: null, tower: '', unitNo: '', sqft: '', bhk: '' });
                setInventory(null);
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
          <div className="form-card-title">
            Unit Info
            {inventoryLoading && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--oh-gray)' }}>loading inventory…</span>}
          </div>

          <div className="form-row" style={{ marginBottom: 12 }}>
            <div>
              <div className="input-label">Tower</div>
              {availableTowers.length > 0 ? (
                <select
                  className="select-field"
                  value={form.tower}
                  onChange={(e) => setForm({ ...form, tower: e.target.value, unitNo: '', sqft: '' })}
                >
                  <option value="">Select</option>
                  {availableTowers.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="input-field"
                  placeholder="e.g. A2"
                  value={form.tower}
                  onChange={(e) => setForm({ ...form, tower: e.target.value })}
                />
              )}
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

          <div className="form-row">
            <div>
              <div className="input-label">Area (sqft)</div>
              <input
                className="input-field"
                inputMode="numeric"
                placeholder="e.g. 1200"
                value={form.sqft}
                onChange={(e) => setForm({ ...form, sqft: e.target.value.replace(/\D/g, '') })}
              />
              {form.sqft && form.tower && form.unitNo && inventory?.towers?.[form.tower]?.[getUnitSuffix(form.unitNo)] === parseInt(form.sqft) && (
                <div className="auto-fill-hint">✓ Auto-filled from property database</div>
              )}
            </div>
            <div>
              <div className="input-label">BHK</div>
              <select
                className="select-field"
                value={form.bhk}
                onChange={(e) => setForm({ ...form, bhk: e.target.value })}
              >
                <option value="">Select</option>
                {bhkOptions.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="optional-hint">
            All fields except society are optional. Fill what you know — we'll check for duplicates against Openhouse inventory.
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
