/**
 * Detailed filter modal for the Submissions page (P3.4).
 *
 * Built from Direct Inventory's `components/FilterPanel.jsx` shell (`.modal
 * .filter-modal`, 2-col `.filter-grid`, two-state form-vs-applied, Reset/
 * Cancel/Apply footer) with CP-specific filter blocks instead of Direct's
 * inventory ones.
 *
 * Two kinds of filters live here:
 *  - Server-backed (BHK, Stage, RM, Date submitted) — these map to
 *    Submissions.jsx's `bhk` / `statusFilter` / `rmFilter` / `dateFrom` /
 *    `dateTo` state, which feeds `api.adminListSubmissions` on the wire.
 *  - Client-only refinements (Match type, Missing info, Asking price range,
 *    OH Price, Rejected reason) — CP's admin API has no server params for
 *    these, so they're returned via `onApply` and the page post-filters the
 *    already-loaded rows before rendering (see Submissions.jsx's
 *    `clientFilteredSubmissions`).
 *
 * `onApply(applied)` fires once, with every field flattened into one object;
 * the caller is responsible for both updating its own state AND closing the
 * modal (mirrors Direct's `FilterPanel` contract — Apply doesn't self-close).
 */
import { useEffect, useState } from 'react';
import { STAGES, REJECTED_REASONS } from '../../format';
import { IconClose } from '../icons.jsx';
import SearchableMultiSelect from '../SearchableMultiSelect.jsx';

// Standard BHK configurations offered as single-select pills. CP stores `bhk`
// as free-text ("2 BHK", "2.5 BHK", …) and the backend filter matches on the
// leading digit run, so plain numbers here are enough.
const BHK_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

const MATCH_TYPE_OPTIONS = [
  { key: 'perfect', label: 'Perfect' },
  { key: 'collated', label: 'Collated' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'weak', label: 'Weak' },
];

const MISSING_INFO_OPTIONS = [
  { key: 'no_asking_price', label: 'No asking price' },
  { key: 'no_seller', label: 'No seller' },
];

const DATE_PRESETS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This Week'],
  ['this_month', 'This Month'], ['custom', 'Custom'],
];

// YYYY-MM-DD for "today + offsetDays", pinned to IST to match the rest of
// the app's timezone policy (format.js formatters all display in IST).
function istDateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function presetRange(name) {
  if (name === 'today') { const s = istDateStr(0); return { from: s, to: s }; }
  if (name === 'yesterday') { const s = istDateStr(-1); return { from: s, to: s }; }
  if (name === 'this_week') {
    const dow = (new Date().getDay() + 6) % 7; // Mon=0 .. Sun=6
    return { from: istDateStr(-dow), to: istDateStr(0) };
  }
  if (name === 'this_month') {
    const domIndex = new Date().getDate() - 1; // days since the 1st
    return { from: istDateStr(-domIndex), to: istDateStr(0) };
  }
  return { from: '', to: '' };
}

const EMPTY = {
  bhk: '', statusFilter: [], rmIds: [],
  dateFrom: '', dateTo: '', datePreset: '',
  matchTypes: [], missingInfo: [], priceMin: '', priceMax: '', ohPrice: '',
  rejectReasons: [],
};

function seedForm(initial = {}) {
  const dateFrom = initial.dateFrom || '';
  const dateTo = initial.dateTo || '';
  return {
    ...EMPTY,
    ...initial,
    dateFrom,
    dateTo,
    // We don't track which preset produced a date range, so any currently-
    // applied range reopens as "Custom" (with the from/to inputs visible and
    // pre-filled) rather than guessing a matching preset button to highlight.
    datePreset: (dateFrom || dateTo) ? 'custom' : '',
    rmIds: initial.rmFilter ? [String(initial.rmFilter)] : [],
    matchTypes: Array.isArray(initial.matchTypes) ? initial.matchTypes : [],
    missingInfo: Array.isArray(initial.missingInfo) ? initial.missingInfo : [],
    rejectReasons: Array.isArray(initial.rejectReasons) ? initial.rejectReasons : [],
  };
}

export default function FilterModal({
  open, initial = {}, rms = [], canFilterRm = false, isStaff = false, isViewer = false,
  onApply, onClose,
}) {
  const [f, setF] = useState(() => seedForm(initial));

  // The modal stays mounted the whole time (only `open` toggles), so it
  // won't naturally re-seed from `initial` on a second open — re-sync the
  // form from the page's currently-applied filters every time it opens.
  // This also catches statusFilter changes made outside the modal (the
  // stage-count pills below the toolbar set it directly).
  useEffect(() => {
    if (open) setF(seedForm(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function set(k, v) { setF((p) => ({ ...p, [k]: v })); }

  function toggleBhk(n) {
    const s = String(n);
    setF((p) => ({ ...p, bhk: p.bhk === s ? '' : s }));
  }
  function toggleStage(key) {
    setF((p) => ({
      ...p,
      statusFilter: p.statusFilter.includes(key)
        ? p.statusFilter.filter((k) => k !== key)
        : [...p.statusFilter, key],
    }));
  }
  function toggleInArray(key, arrKey) {
    setF((p) => ({
      ...p,
      [arrKey]: p[arrKey].includes(key) ? p[arrKey].filter((x) => x !== key) : [...p[arrKey], key],
    }));
  }
  function toggleOhPrice(v) {
    setF((p) => ({ ...p, ohPrice: p.ohPrice === v ? '' : v }));
  }
  function applyDatePreset(name) {
    setF((p) => {
      if (name === 'custom') return { ...p, datePreset: p.datePreset === 'custom' ? '' : 'custom' };
      if (p.datePreset === name) return { ...p, datePreset: '', dateFrom: '', dateTo: '' };
      const { from, to } = presetRange(name);
      return { ...p, datePreset: name, dateFrom: from, dateTo: to };
    });
  }

  function reset() { setF(EMPTY); }

  function apply() {
    // Backend's rm_id filter only accepts a single RM at a time — when
    // multiple are checked in the multiselect, the first one wins.
    onApply({
      bhk: f.bhk,
      statusFilter: f.statusFilter,
      rmFilter: f.rmIds[0] || '',
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
      matchTypes: f.matchTypes,
      missingInfo: f.missingInfo,
      priceMin: f.priceMin,
      priceMax: f.priceMax,
      ohPrice: f.ohPrice,
      rejectReasons: f.rejectReasons,
    });
  }

  const visibleStages = STAGES.filter((s) => isStaff || isViewer || !s.adminOnly);
  const showRejectReasons = f.statusFilter.includes('Rejected');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal filter-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head-row">
          <h3>Filters</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>

        <div className="filter-grid">
          <div className="filter-block">
            <label>BHK</label>
            <div className="bhk-pills">
              {BHK_OPTIONS.map((n) => (
                <button key={n} type="button" className={f.bhk === String(n) ? 'pill pill-on' : 'pill'} onClick={() => toggleBhk(n)}>
                  {n} BHK
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <label>Stage</label>
            <div className="bhk-pills">
              {visibleStages.map((s) => (
                <button key={s.key} type="button" className={f.statusFilter.includes(s.key) ? 'pill pill-on' : 'pill'} onClick={() => toggleStage(s.key)}>
                  {s.label || s.key}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <label>Match type</label>
            <div className="bhk-pills">
              {MATCH_TYPE_OPTIONS.map((o) => (
                <button key={o.key} type="button" className={f.matchTypes.includes(o.key) ? 'pill pill-on' : 'pill'} onClick={() => toggleInArray(o.key, 'matchTypes')}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <label>Missing info</label>
            <div className="bhk-pills">
              {MISSING_INFO_OPTIONS.map((o) => (
                <button key={o.key} type="button" className={f.missingInfo.includes(o.key) ? 'pill pill-on' : 'pill'} onClick={() => toggleInArray(o.key, 'missingInfo')}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <label>Asking price (₹)</label>
            <div className="range-row">
              <input type="number" placeholder="min" value={f.priceMin} onChange={(e) => set('priceMin', e.target.value)} />
              <span className="muted">to</span>
              <input type="number" placeholder="max" value={f.priceMax} onChange={(e) => set('priceMax', e.target.value)} />
            </div>
          </div>

          <div className="filter-block">
            <label>OH Price</label>
            <div className="bhk-pills">
              <button type="button" className={f.ohPrice === 'has' ? 'pill pill-on' : 'pill'} onClick={() => toggleOhPrice('has')}>Has OH Price</button>
              <button type="button" className={f.ohPrice === 'check' ? 'pill pill-on' : 'pill'} onClick={() => toggleOhPrice('check')}>Check Price</button>
            </div>
          </div>

          {canFilterRm && (
            <div className="filter-block">
              <label>RM</label>
              <SearchableMultiSelect
                options={rms.map((r) => ({ value: String(r.id), label: r.name || r.email }))}
                value={f.rmIds}
                onChange={(v) => set('rmIds', v)}
                placeholder="Pick RM…"
              />
            </div>
          )}

          {showRejectReasons && (
            <div className="filter-block" style={{ gridColumn: '1 / -1' }}>
              <label>Rejected reason</label>
              <div className="bhk-pills">
                {REJECTED_REASONS.map((r) => (
                  <button key={r} type="button" className={f.rejectReasons.includes(r) ? 'pill pill-on' : 'pill'} onClick={() => toggleInArray(r, 'rejectReasons')}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="filter-block" style={{ gridColumn: '1 / -1' }}>
            <label>Date submitted</label>
            <div className="preset-grid-3">
              {DATE_PRESETS.map(([k, lbl]) => (
                <button key={k} type="button" className={f.datePreset === k ? 'pill pill-on' : 'pill'} onClick={() => applyDatePreset(k)}>{lbl}</button>
              ))}
            </div>
            {f.datePreset === 'custom' && (
              <div className="range-row" style={{ marginTop: 8 }}>
                <input type="date" value={f.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} />
                <span className="muted">to</span>
                <input type="date" value={f.dateTo} onChange={(e) => set('dateTo', e.target.value)} />
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={reset}>Reset</button>
          <span style={{ flex: 1 }} />
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={apply}>Apply</button>
        </div>
      </div>
    </div>
  );
}
